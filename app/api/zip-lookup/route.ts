import { NextRequest, NextResponse } from 'next/server';

export const runtime='nodejs';
export const dynamic='force-dynamic';

function cleanZip(value:string|null){
  const zip=String(value||'').trim();
  return /^\d{5}(?:-\d{4})?$/.test(zip)?zip.slice(0,5):'';
}

export async function GET(request:NextRequest){
  const zip=cleanZip(request.nextUrl.searchParams.get('zip'));
  if(!zip)return NextResponse.json({error:'Enter a valid 5-digit ZIP code.'},{status:400});
  try{
    const response=await fetch(`https://api.zippopotam.us/us/${encodeURIComponent(zip)}`,{cache:'no-store'});
    if(!response.ok)return NextResponse.json({error:'ZIP code not found.'},{status:404});
    const data=await response.json() as {places?:Array<{'place name'?:string;'state abbreviation'?:string;state?:string;latitude?:string;longitude?:string}>};
    const place=data.places?.[0];
    const city=String(place?.['place name']||'').trim();
    const region=String(place?.['state abbreviation']||place?.state||'').trim();
    const latitude=Number(place?.latitude);
    const longitude=Number(place?.longitude);
    if(!city)return NextResponse.json({error:'ZIP code not found.'},{status:404});
    return NextResponse.json({zip,city,region,latitude:Number.isFinite(latitude)?latitude:null,longitude:Number.isFinite(longitude)?longitude:null},{headers:{'Cache-Control':'no-store'}});
  }catch{
    return NextResponse.json({error:'ZIP lookup is temporarily unavailable.'},{status:502});
  }
}
