import {NextResponse} from 'next/server';
import {getDatabase} from '@/lib/sqlite';
import {locationOpenState,type Hours} from '@/lib/openHours';

export const runtime='nodejs';
export const dynamic='force-dynamic';

function parseHours(value:unknown):Hours|undefined{if(!value)return undefined;try{const parsed=JSON.parse(String(value));return parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed as Hours:undefined;}catch{return undefined;}}

export async function GET(){
 const db=getDatabase();
 let rows:Array<{id:string;country:string;region:string;hours_json:string|null}>=[];
 try{
  rows=db.prepare(`SELECT d.id,d.country,d.region,p.hours_json FROM dispensaries d LEFT JOIN dispensary_profiles p ON p.location_id=d.id WHERE d.active=1 AND d.verified=1`).all() as typeof rows;
 }catch{
  return NextResponse.json({openIds:[],knownHours:0,openCount:0},{headers:{'Cache-Control':'no-store'}});
 }
 const now=new Date(),openIds:string[]=[];let knownHours=0;
 for(const row of rows){const hours=parseHours(row.hours_json);if(!hours||Object.keys(hours).length===0)continue;knownHours+=1;const result=locationOpenState({country:row.country,region:row.region,hours},now);if(result.state==='open')openIds.push(row.id);}
 return NextResponse.json({openIds,knownHours,openCount:openIds.length,checkedAt:now.toISOString()},{headers:{'Cache-Control':'no-store, max-age=0'}});
}
