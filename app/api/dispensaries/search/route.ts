import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/sqlite';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function GET(request:NextRequest){
  const q=String(request.nextUrl.searchParams.get('q')||'').trim().replace(/[%_]/g,'').slice(0,120);
  const lat=Number(request.nextUrl.searchParams.get('lat'));
  const lng=Number(request.nextUrl.searchParams.get('lng'));
  const nearby=Number.isFinite(lat)&&Number.isFinite(lng)&&lat>=-90&&lat<=90&&lng>=-180&&lng<=180;
  if(!nearby&&q.length<2)return NextResponse.json({dispensaries:[]},{headers:{'Cache-Control':'no-store'}});
  if(nearby){
    const rows=getDatabase().prepare(`
      SELECT id,name,city,region,country,latitude,longitude,
        (3958.7613 * 2 * ASIN(SQRT(
          POWER(SIN((RADIANS(latitude)-RADIANS(?))/2),2) +
          COS(RADIANS(?))*COS(RADIANS(latitude))*POWER(SIN((RADIANS(longitude)-RADIANS(?))/2),2)
        ))) distance_miles
      FROM dispensaries
      WHERE active=1 AND latitude IS NOT NULL AND longitude IS NOT NULL
        AND latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?
      ORDER BY distance_miles ASC
      LIMIT 12
    `).all(lat,lat,lng,lat-1.5,lat+1.5,lng-2,lng+2) as any[];
    return NextResponse.json({dispensaries:rows.map(row=>({
      id:String(row.id),name:String(row.name||'Dispensary'),city:row.city?String(row.city):null,
      region:row.region?String(row.region):null,country:row.country?String(row.country):null,
      latitude:Number(row.latitude),longitude:Number(row.longitude),distanceMiles:Number(row.distance_miles),
    }))},{headers:{'Cache-Control':'no-store'}});
  }
  const like=`%${q}%`;
  const rows=getDatabase().prepare(`
    SELECT id,name,city,region,country,latitude,longitude
    FROM dispensaries
    WHERE active=1 AND (
      name LIKE ? COLLATE NOCASE OR
      COALESCE(city,'') LIKE ? COLLATE NOCASE OR
      COALESCE(region,'') LIKE ? COLLATE NOCASE
    )
    ORDER BY
      CASE WHEN name LIKE ? COLLATE NOCASE THEN 0 ELSE 1 END,
      name COLLATE NOCASE,city COLLATE NOCASE
    LIMIT 24
  `).all(like,like,like,`${q}%`) as any[];

  return NextResponse.json({dispensaries:rows.map(row=>({
    id:String(row.id),
    name:String(row.name||'Dispensary'),
    city:row.city?String(row.city):null,
    region:row.region?String(row.region):null,
    country:row.country?String(row.country):null,
    latitude:row.latitude==null?null:Number(row.latitude),
    longitude:row.longitude==null?null:Number(row.longitude),
  }))},{headers:{'Cache-Control':'no-store'}});
}
