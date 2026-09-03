import { NextResponse } from 'next/server';
import { resolveDispensaryIdentifier } from '@/lib/dispensarySlug';
import { getLocationBase } from '@/lib/dispensaryCommunity';

export const runtime='nodejs';
type Context={params:Promise<{identifier:string}>};

export async function GET(_request:Request,{params}:Context){
 const {identifier}=await params;
 const resolved=resolveDispensaryIdentifier(decodeURIComponent(identifier));
 if(!resolved)return NextResponse.json({error:'Dispensary not found.'},{status:404});
 const location=getLocationBase(resolved.locationId);
 if(!location)return NextResponse.json({error:'Dispensary not found.'},{status:404});
 return NextResponse.json({
  locationId:resolved.locationId,
  slug:resolved.slug,
  location:{
   id:location.id,
   name:location.name,
   latitude:location.latitude,
   longitude:location.longitude,
   city:location.city,
   region:location.region,
   country:location.country,
   approved:location.kind==='dispensary',
   imageryReady:location.kind==='dispensary'&&Boolean(location.verified),
   source:location.dataSource||'GeoWeedo',
  },
 },{headers:{'Cache-Control':'no-store'}});
}
