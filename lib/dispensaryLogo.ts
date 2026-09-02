import 'server-only';

import crypto from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { getDatabase } from '@/lib/sqlite';
import { getLocationBase } from '@/lib/dispensaryCommunity';

export type DispensaryLogo={locationId:string;path:string;mimeType:string;updatedAt:string};
export type LogoActor={type:'admin'|'owner';id:string};

const logoDir=path.join(process.cwd(),'data','runtime','dispensary-logos');
const MAX_LOGO_BYTES=4*1024*1024;
const MIME_EXT:Record<string,string>={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'};

function ensureSchema(){
 const db=getDatabase();
 db.exec(`CREATE TABLE IF NOT EXISTS dispensary_logos(
  location_id TEXT PRIMARY KEY,
  image_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  updated_by_type TEXT NOT NULL,
  updated_by_id TEXT NOT NULL,
  updated_at TEXT NOT NULL
 );`);
}
function safeFileFromPublicPath(value:string){
 const prefix='/api/dispensary-logo/';
 if(!value.startsWith(prefix))return null;
 const file=value.slice(prefix.length);
 return /^[a-f0-9-]+\.(?:jpg|png|webp)$/i.test(file)?file:null;
}
export function getDispensaryLogo(locationId:string):DispensaryLogo|null{
 ensureSchema();
 const row=getDatabase().prepare('SELECT location_id,image_path,mime_type,updated_at FROM dispensary_logos WHERE location_id=?').get(locationId) as Record<string,unknown>|undefined;
 if(!row)return null;
 return{locationId:String(row.location_id),path:String(row.image_path),mimeType:String(row.mime_type),updatedAt:String(row.updated_at)};
}
export async function saveDispensaryLogo(input:{locationId:string;bytes:Uint8Array;mime:string;actor:LogoActor}){
 ensureSchema();
 if(!getLocationBase(input.locationId))throw new Error('Dispensary not found.');
 const ext=MIME_EXT[input.mime];
 if(!ext)throw new Error('Logo must be a PNG, JPEG, or WebP image.');
 if(input.bytes.byteLength<1)throw new Error('Logo file is empty.');
 if(input.bytes.byteLength>MAX_LOGO_BYTES)throw new Error('Logo must be 4 MB or smaller.');
 const previous=getDispensaryLogo(input.locationId);
 await fs.mkdir(logoDir,{recursive:true});
 const file=`${crypto.randomUUID()}.${ext}`;
 await fs.writeFile(path.join(logoDir,file),input.bytes);
 const publicPath=`/api/dispensary-logo/${file}`,now=new Date().toISOString();
 getDatabase().prepare(`INSERT INTO dispensary_logos(location_id,image_path,mime_type,updated_by_type,updated_by_id,updated_at)
 VALUES(?,?,?,?,?,?) ON CONFLICT(location_id) DO UPDATE SET image_path=excluded.image_path,mime_type=excluded.mime_type,updated_by_type=excluded.updated_by_type,updated_by_id=excluded.updated_by_id,updated_at=excluded.updated_at`).run(input.locationId,publicPath,input.mime,input.actor.type,input.actor.id,now);
 if(previous?.path&&previous.path!==publicPath){const old=safeFileFromPublicPath(previous.path);if(old)await fs.unlink(path.join(logoDir,old)).catch(()=>{});}
 return getDispensaryLogo(input.locationId)!;
}
export async function removeDispensaryLogo(locationId:string){
 ensureSchema();
 const previous=getDispensaryLogo(locationId);
 getDatabase().prepare('DELETE FROM dispensary_logos WHERE location_id=?').run(locationId);
 if(previous?.path){const old=safeFileFromPublicPath(previous.path);if(old)await fs.unlink(path.join(logoDir,old)).catch(()=>{});}
 return Boolean(previous);
}
export async function readDispensaryLogoFile(file:string){
 if(!/^[a-f0-9-]+\.(?:jpg|png|webp)$/i.test(file))return null;
 try{return await fs.readFile(path.join(logoDir,file));}catch{return null;}
}
