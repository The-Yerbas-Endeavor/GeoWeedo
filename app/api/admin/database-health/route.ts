import { stat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { adminHasPermission, getAdminFromRequest } from '@/lib/adminAuth';
import { getDatabase, getDatabasePath } from '@/lib/sqlite';

export const runtime='nodejs';
export const dynamic='force-dynamic';

const NO_STORE={'Cache-Control':'no-store'};
const CACHE_MS=10*60*1000;

type TableHealth={name:string;rows:number|null;bytes:number|null};
type DatabaseHealth={
  checkedAt:string;
  database:{path:string;bytes:number;walBytes:number;shmBytes:number;tables:number;indexes:number};
  quickCheck:{status:'ok'|'attention'|'unavailable';message:string};
  lastBackup:null|{name:string;bytes:number;modifiedAt:string};
  largestTables:TableHealth[];
};

let cached:{at:number;value:DatabaseHealth}|null=null;
let inFlight:Promise<DatabaseHealth>|null=null;

async function fileSize(file:string){
  try{return Number((await stat(file)).size||0);}catch{return 0;}
}

async function latestBackup(){
  const dirs=[
    path.join(process.cwd(),'data','backups'),
    path.join(path.dirname(path.dirname(getDatabasePath())),'backups'),
  ];
  for(const dir of Array.from(new Set(dirs))){
    try{
      const entries=await readdir(dir,{withFileTypes:true});
      const candidates=[];
      for(const entry of entries){
        if(!entry.isFile()||!/.(sqlite|sqlite3|db)$/i.test(entry.name))continue;
        const full=path.join(dir,entry.name);
        try{
          const info=await stat(full);
          candidates.push({name:entry.name,bytes:Number(info.size||0),modifiedAt:info.mtime.toISOString(),mtime:info.mtimeMs});
        }catch{}
      }
      candidates.sort((a,b)=>b.mtime-a.mtime);
      if(candidates[0]){
        const {mtime,...backup}=candidates[0];
        return backup;
      }
    }catch{}
  }
  return null;
}

function userTableNames(db:ReturnType<typeof getDatabase>){
  return (db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all() as Array<{name:string}>)
    .map(row=>String(row.name||''))
    .filter(Boolean);
}

function largestTableNames(db:ReturnType<typeof getDatabase>,tables:string[]){
  try{
    const rows=db.prepare(`
      SELECT d.name name,SUM(d.pgsize) bytes
      FROM dbstat d
      JOIN sqlite_master m ON m.name=d.name
      WHERE m.type='table' AND d.name NOT LIKE 'sqlite_%'
      GROUP BY d.name
      ORDER BY bytes DESC
      LIMIT 10
    `).all() as Array<{name:string;bytes:number}>;
    if(rows.length)return rows.map(row=>({name:String(row.name),bytes:Number(row.bytes||0)}));
  }catch{}
  return tables.slice(0,10).map(name=>({name,bytes:null}));
}

function safeRowCount(db:ReturnType<typeof getDatabase>,table:string){
  if(!/^[A-Za-z0-9_]+$/.test(table))return null;
  try{return Number((db.prepare(`SELECT COUNT(*) value FROM "${table}"`).get() as {value?:number})?.value||0);}
  catch{return null;}
}

function quickCheck(db:ReturnType<typeof getDatabase>):DatabaseHealth['quickCheck']{
  try{
    const rows=db.prepare('PRAGMA quick_check(1)').all() as Array<Record<string,unknown>>;
    const messages=rows.map(row=>String(Object.values(row)[0]??'')).filter(Boolean);
    if(messages.length===1&&messages[0].toLowerCase()==='ok')return{status:'ok',message:'OK'};
    return{status:'attention',message:messages.join(' · ')||'SQLite reported a consistency issue.'};
  }catch(error){
    const message=error instanceof Error?error.message:'Quick check could not run.';
    return{status:'unavailable',message};
  }
}

async function buildHealth():Promise<DatabaseHealth>{
  const db=getDatabase();
  const dbPath=getDatabasePath();
  const tables=userTableNames(db);
  const tableSizes=largestTableNames(db,tables);
  const largestTables=tableSizes.map(item=>({
    name:item.name,
    bytes:item.bytes,
    rows:safeRowCount(db,item.name),
  }));
  const indexes=Number((db.prepare(`SELECT COUNT(*) value FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_autoindex_%'`).get() as {value?:number})?.value||0);
  const [bytes,walBytes,shmBytes,lastBackup]=await Promise.all([
    fileSize(dbPath),
    fileSize(`${dbPath}-wal`),
    fileSize(`${dbPath}-shm`),
    latestBackup(),
  ]);
  return{
    checkedAt:new Date().toISOString(),
    database:{path:dbPath,bytes,walBytes,shmBytes,tables:tables.length,indexes},
    quickCheck:quickCheck(db),
    lastBackup,
    largestTables,
  };
}

async function getHealth(force=false){
  if(!force&&cached&&Date.now()-cached.at<CACHE_MS)return cached.value;
  if(inFlight)return inFlight;
  inFlight=buildHealth().then(value=>{
    cached={at:Date.now(),value};
    return value;
  }).finally(()=>{inFlight=null;});
  return inFlight;
}

export async function GET(request:NextRequest){
  const admin=getAdminFromRequest(request);
  if(!admin)return NextResponse.json({error:'Unauthorized.'},{status:401,headers:NO_STORE});
  if(!adminHasPermission(admin,'data.manage'))return NextResponse.json({error:'Database health permission denied.'},{status:403,headers:NO_STORE});
  try{
    const force=request.nextUrl.searchParams.get('refresh')==='1';
    return NextResponse.json(await getHealth(force),{headers:NO_STORE});
  }catch(error){
    return NextResponse.json({error:error instanceof Error?error.message:'Could not inspect database health.'},{status:500,headers:NO_STORE});
  }
}
