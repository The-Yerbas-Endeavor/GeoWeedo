import { NextResponse } from 'next/server';
import { activeGameCampaign } from '@/lib/gameSponsorship';
import { readApprovedDispensaries } from '@/lib/dispensaryStore';

export const runtime='nodejs';
export const dynamic='force-dynamic';

function hashSeed(value:string){
  let hash=2166136261;
  for(const char of value){hash^=char.charCodeAt(0);hash=Math.imul(hash,16777619);}
  return hash>>>0;
}

function missionStart(campaignId:string,lat:number,lng:number,missionDay:string){
  const unsigned=hashSeed(campaignId+':'+missionDay);
  const bearing=(unsigned%360)*Math.PI/180;
  // Roughly 1–2.4 miles from the target. The route rotates daily while the
  // sponsorship is active so repeat visits do not always begin in one place.
  const distanceKm=1.6+((unsigned>>>9)%2300)/1000;
  const dLat=(distanceKm/111.32)*Math.cos(bearing);
  const lonScale=Math.max(.2,Math.cos(lat*Math.PI/180));
  const dLng=(distanceKm/(111.32*lonScale))*Math.sin(bearing);
  const difficulty=distanceKm<2.25?'Easy':distanceKm<3.1?'Medium':'Hard';
  return {lat:lat+dLat,lng:lng+dLng,distanceKm:Number(distanceKm.toFixed(2)),difficulty};
}

export async function GET(){
  const campaign=activeGameCampaign('mission');
  if(!campaign)return NextResponse.json({mission:null},{headers:{'Cache-Control':'no-store'}});

  const dispensaries=await readApprovedDispensaries();
  const target=dispensaries.find(item=>item.id===campaign.dispensaryId);
  if(!target?.active||target.gameplayEnabled===false||!target.imageryPhotoId||!Number.isFinite(target.latitude)||!Number.isFinite(target.longitude)){
    return NextResponse.json({mission:null,error:'The active Sponsored Mission target is not gameplay ready.'},{headers:{'Cache-Control':'no-store'}});
  }

  const missionDay=new Date().toISOString().slice(0,10);
  const start=missionStart(campaign.id,target.latitude,target.longitude,missionDay);

  // Intentionally do not send target coordinates, sponsor identity, profile,
  // website, or logo before the player locks a guess. Those are revealed by
  // /api/missions/guess only after a submitted attempt.
  return NextResponse.json({
    mission:{
      campaignId:campaign.id,
      startsAt:campaign.startsAt,
      endsAt:campaign.endsAt,
      missionDay,
      difficulty:start.difficulty,
      start:{lat:start.lat,lng:start.lng,approxDistanceKm:start.distanceKm},
    },
  },{headers:{'Cache-Control':'no-store'}});
}
