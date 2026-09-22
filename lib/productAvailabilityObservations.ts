import { randomUUID } from 'node:crypto';
import { getDatabase } from './sqlite';

export type AvailabilityObservationSource='owner'|'scanner'|'user'|'public_menu'|'brand'|'admin';
export type AvailabilityObservationStatus='seen'|'in_stock'|'carried'|'unavailable';

export type ProductAvailabilityObservation={
  id:string;
  productId:string;
  batchId:string|null;
  dispensaryId:string;
  sourceType:AvailabilityObservationSource;
  sourceReference:string|null;
  availabilityStatus:AvailabilityObservationStatus;
  priceCents:number|null;
  currency:string;
  confidence:'high'|'medium'|'low';
  observedAt:string;
  expiresAt:string|null;
  historical:boolean;
  dispensary:{
    id:string;
    name:string;
    city:string|null;
    region:string|null;
    country:string|null;
    latitude:number|null;
    longitude:number|null;
  };
};

let schemaReady=false;

function tableExists(){
  try{
    return Boolean(getDatabase().prepare("SELECT 1 ok FROM sqlite_master WHERE type='table' AND name='product_availability_observations' LIMIT 1").get());
  }catch{return false;}
}

export function ensureProductAvailabilityObservationSchema(){
  if(schemaReady)return;
  const db=getDatabase();
  if(tableExists()){schemaReady=true;return;}
  db.exec(`
    CREATE TABLE IF NOT EXISTS product_availability_observations (
      id TEXT PRIMARY KEY,
      dispensary_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      batch_id TEXT,
      source_type TEXT NOT NULL,
      source_reference TEXT,
      reported_by_user_id TEXT,
      price_cents INTEGER,
      currency TEXT NOT NULL DEFAULT 'USD',
      availability_status TEXT NOT NULL DEFAULT 'seen',
      confidence TEXT NOT NULL DEFAULT 'medium',
      observed_at TEXT NOT NULL,
      expires_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(dispensary_id) REFERENCES dispensaries(id) ON DELETE CASCADE,
      FOREIGN KEY(product_id) REFERENCES cannabis_products(id) ON DELETE CASCADE,
      FOREIGN KEY(batch_id) REFERENCES cannabis_batches(id) ON DELETE SET NULL,
      FOREIGN KEY(reported_by_user_id) REFERENCES users(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS product_availability_observations_product_idx
      ON product_availability_observations(product_id,observed_at DESC);
    CREATE INDEX IF NOT EXISTS product_availability_observations_dispensary_idx
      ON product_availability_observations(dispensary_id,product_id,observed_at DESC);
    CREATE INDEX IF NOT EXISTS product_availability_observations_expiry_idx
      ON product_availability_observations(expires_at,source_type);
  `);
  schemaReady=true;
}

function ttlDays(source:AvailabilityObservationSource){
  if(source==='public_menu')return 3;
  if(source==='user')return 7;
  if(source==='scanner')return 14;
  if(source==='owner'||source==='brand'||source==='admin')return 30;
  return 7;
}

function confidenceFor(source:AvailabilityObservationSource){
  if(source==='owner'||source==='admin')return 'high' as const;
  if(source==='scanner'||source==='public_menu'||source==='brand')return 'medium' as const;
  return 'low' as const;
}

function expiryFor(source:AvailabilityObservationSource,observedAt:string){
  const date=new Date(observedAt);
  date.setUTCDate(date.getUTCDate()+ttlDays(source));
  return date.toISOString();
}

export function recordProductAvailabilityObservation(input:{
  userId?:string|null;
  dispensaryId:string;
  productId:string;
  batchId?:string|null;
  sourceType:AvailabilityObservationSource;
  sourceReference?:string|null;
  availabilityStatus?:AvailabilityObservationStatus;
  priceCents?:number|null;
  currency?:string|null;
}){
  ensureProductAvailabilityObservationSchema();
  const db=getDatabase();
  const product=db.prepare('SELECT id FROM cannabis_products WHERE id=? LIMIT 1').get(input.productId) as any;
  if(!product)throw new Error('Product not found.');
  const dispensary=db.prepare('SELECT id FROM dispensaries WHERE id=? AND active=1 LIMIT 1').get(input.dispensaryId) as any;
  if(!dispensary)throw new Error('Dispensary not found or inactive.');
  if(input.batchId){
    const batch=db.prepare('SELECT id FROM cannabis_batches WHERE id=? AND product_id=? LIMIT 1').get(input.batchId,input.productId) as any;
    if(!batch)throw new Error('Batch does not belong to this product.');
  }

  const sourceType=input.sourceType;
  const status=input.availabilityStatus||'seen';
  if(!['owner','scanner','user','public_menu','brand','admin'].includes(sourceType))throw new Error('Invalid availability source.');
  if(!['seen','in_stock','carried','unavailable'].includes(status))throw new Error('Invalid availability status.');

  const now=new Date().toISOString();
  const expiresAt=expiryFor(sourceType,now);
  const confidence=confidenceFor(sourceType);
  const userId=input.userId||null;
  const batchId=input.batchId||null;
  const existing=db.prepare(`
    SELECT id FROM product_availability_observations
    WHERE dispensary_id=? AND product_id=? AND source_type=?
      AND COALESCE(reported_by_user_id,'')=COALESCE(?,'')
      AND COALESCE(batch_id,'')=COALESCE(?,'')
    ORDER BY observed_at DESC LIMIT 1
  `).get(input.dispensaryId,input.productId,sourceType,userId,batchId) as any;

  const priceCents=input.priceCents==null?null:Math.max(0,Math.round(Number(input.priceCents)));
  const currency=String(input.currency||'USD').trim().toUpperCase().slice(0,8)||'USD';
  if(existing?.id){
    db.prepare(`
      UPDATE product_availability_observations
      SET source_reference=?,price_cents=?,currency=?,availability_status=?,confidence=?,
          observed_at=?,expires_at=?,updated_at=?
      WHERE id=?
    `).run(input.sourceReference||null,priceCents,currency,status,confidence,now,expiresAt,now,existing.id);
    return String(existing.id);
  }

  const id=`availability-${randomUUID()}`;
  db.prepare(`
    INSERT INTO product_availability_observations
      (id,dispensary_id,product_id,batch_id,source_type,source_reference,reported_by_user_id,
       price_cents,currency,availability_status,confidence,observed_at,expires_at,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(id,input.dispensaryId,input.productId,batchId,sourceType,input.sourceReference||null,userId,
    priceCents,currency,status,confidence,now,expiresAt,now,now);
  return id;
}

export function listProductAvailabilityObservations(productId:string,batchId?:string|null):ProductAvailabilityObservation[]{
  if(!tableExists())return [];
  const db=getDatabase();
  const now=new Date().toISOString();
  const cutoff=new Date(Date.now()-180*86400000).toISOString();
  const rows=db.prepare(`
    SELECT o.*,d.name dispensary_name,d.city,d.region,d.country,d.latitude,d.longitude
    FROM product_availability_observations o
    JOIN dispensaries d ON d.id=o.dispensary_id
    WHERE o.product_id=? AND d.active=1 AND o.observed_at>=?
    ORDER BY
      CASE o.source_type WHEN 'owner' THEN 0 WHEN 'scanner' THEN 1 WHEN 'public_menu' THEN 2 WHEN 'brand' THEN 3 WHEN 'user' THEN 4 ELSE 5 END,
      o.observed_at DESC
    LIMIT 250
  `).all(productId,cutoff) as any[];

  return rows.map(row=>{
    const latitude=row.latitude==null?null:Number(row.latitude);
    const longitude=row.longitude==null?null:Number(row.longitude);
    const historical=String(row.availability_status)==='unavailable'||Boolean(row.expires_at&&String(row.expires_at)<=now);
    return{
      id:String(row.id),
      productId:String(row.product_id),
      batchId:row.batch_id?String(row.batch_id):null,
      dispensaryId:String(row.dispensary_id),
      sourceType:String(row.source_type) as AvailabilityObservationSource,
      sourceReference:row.source_reference?String(row.source_reference):null,
      availabilityStatus:String(row.availability_status) as AvailabilityObservationStatus,
      priceCents:row.price_cents==null?null:Number(row.price_cents),
      currency:String(row.currency||'USD'),
      confidence:['high','medium','low'].includes(String(row.confidence))?row.confidence:'medium',
      observedAt:String(row.observed_at),
      expiresAt:row.expires_at?String(row.expires_at):null,
      historical,
      dispensary:{
        id:String(row.dispensary_id),
        name:String(row.dispensary_name||'Dispensary'),
        city:row.city?String(row.city):null,
        region:row.region?String(row.region):null,
        country:row.country?String(row.country):null,
        latitude:Number.isFinite(latitude as number)?latitude:null,
        longitude:Number.isFinite(longitude as number)?longitude:null,
      },
    };
  }).filter(row=>!batchId||!row.batchId||row.batchId===batchId);
}
