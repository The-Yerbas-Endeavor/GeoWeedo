import { NextResponse } from 'next/server';
import { activeGameCampaign } from '@/lib/gameSponsorship';
import { readApprovedDispensaries } from '@/lib/dispensaryStore';
import { getCommunityProfile } from '@/lib/dispensaryCommunity';
import { getDispensaryLogo } from '@/lib/dispensaryLogo';

export const runtime='nodejs';
export const dynamic='force-dynamic';

function missionStart(campaignId:string,lat:number,lng:number){
  let hash=2166136261;
  for(const char of campaignId){hash^=char.charCodeAt(0);hash=Math.imul(hash,16777619);}
  const unsigned=hash>>>0;
  const bearing=(unsigned%360)*Math.PI/180;
  const distanceKm=.85+((unsigned>>>9)%650)/1000;
  const dLat=(distanceKm/111.32)*Math.cos(bearing);
  const lonScale=Math.max(.2,Math.cos(lat*Math.PI/180));
  const dLng=(distanceKm/(111.32*lonScale))*Math.sin(bearing);
  return {lat:lat+dLat,lng:lng+dLng,distanceKm:Number(distanceKm.toFixed(2))};
}

export async function GET(){
  const campaign=activeGameCampaign('mission');
  if(!campaign)return NextResponse.json({mission:null},{headers:{'Cache-Control':'no-store'}});
  const dispensaries=await readApprovedDispensaries();
  const target=dispensaries.find(item=>item.id===campaign.dispensaryId);
  if(!target?.active||target.gameplayEnabled===false||!target.imageryPhotoId||!Number.isFinite(target.latitude)||!Number.isFinite(target.longitude)){
    return NextResponse.json({mission:null,error:'The active Sponsored Mission target is not gameplay ready.'},{headers:{'Cache-Control':'no-store'}});
  }
  const profile=getCommunityProfile(target.id);
  const logo=getDispensaryLogo(target.id);
  const start=missionStart(campaign.id,target.latitude,target.longitude);
  return NextResponse.json({
    mission:{
      campaignId:campaign.id,
      title:campaign.title||'GeoWeedo Sponsored Mission',
      startsAt:campaign.startsAt,
      endsAt:campaign.endsAt,
      start:{lat:start.lat,lng:start.lng,approxDistanceKm:start.distanceKm},
      target:{lat:target.latitude,lng:target.longitude},
      reveal:{
        id:target.id,
        name:target.name,
        city:target.city,
        region:target.region,
        country:target.country,
        website:profile?.website||target.website||null,
        logo:logo?.path||null,
        profileHref:'/dispensary/'+encodeURIComponent(target.id),
      },
    },
  },{headers:{'Cache-Control':'no-store'}});
}
