import { NextResponse } from 'next/server';
import { readApprovedDispensaries } from '@/lib/dispensaryStore';
import { activeSponsorshipMap } from '@/lib/sponsorshipStore';
import { getDispensaryLogo } from '@/lib/dispensaryLogo';

export const runtime='nodejs';
export const dynamic='force-dynamic';

function markerTitle(name:string,city:string,region:string){
 return [name,city,region].filter(Boolean).join(' · ');
}

export async function GET(){
 const [approved,sponsorships]=await Promise.all([
  readApprovedDispensaries(),
  activeSponsorshipMap(),
 ]);
 const logos=approved.flatMap(item=>{
  if(!item.active||!sponsorships.has(item.id))return [];
  const logo=getDispensaryLogo(item.id);
  if(!logo?.path)return [];
  return [{
   locationId:item.id,
   markerTitle:markerTitle(item.name,item.city,item.region),
   logoUrl:logo.path,
  }];
 });
 return NextResponse.json({logos},{headers:{'Cache-Control':'no-store'}});
}
