import { NextResponse } from 'next/server';
import { activeGameCampaign } from '@/lib/gameSponsorship';
import { readApprovedDispensaries } from '@/lib/dispensaryStore';
import { getCommunityProfile } from '@/lib/dispensaryCommunity';
import { getDispensaryLogo } from '@/lib/dispensaryLogo';

export const runtime='nodejs';
export const dynamic='force-dynamic';

type LatLng={lat:number;lng:number};

function distanceKm(a:LatLng,b:LatLng){
  const r=6371.0088,rad=(v:number)=>(v*Math.PI)/180;
  const dLat=rad(b.lat-a.lat),dLng=rad(b.lng-a.lng),lat1=rad(a.lat),lat2=rad(b.lat);
  const h=Math.sin(dLat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLng/2)**2;
  return r*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));
}

function missionScore(km:number,elapsedSeconds:number){
  const distancePoints=Math.round(5000*Math.exp(-km/1.5));
  const timePoints=Math.max(0,1000-Math.floor(elapsedSeconds/3));
  return Math.max(0,Math.min(6000,distancePoints+timePoints));
}

export async function POST(request:Request){
  const body=await request.json().catch(()=>null);
  const campaignId=String(body?.campaignId||'').trim();
  const lat=Number(body?.guess?.lat);
  const lng=Number(body?.guess?.lng);
  const elapsedSeconds=Math.max(1,Math.min(3600,Math.floor(Number(body?.elapsedSeconds)||1)));

  if(!campaignId||!Number.isFinite(lat)||!Number.isFinite(lng)||lat<-90||lat>90||lng<-180||lng>180){
    return NextResponse.json({error:'A valid mission guess is required.'},{status:400,headers:{'Cache-Control':'no-store'}});
  }

  const campaign=activeGameCampaign('mission');
  if(!campaign||campaign.id!==campaignId){
    return NextResponse.json({error:'That Sponsored Mission is no longer active.'},{status:409,headers:{'Cache-Control':'no-store'}});
  }

  const dispensaries=await readApprovedDispensaries();
  const target=dispensaries.find(item=>item.id===campaign.dispensaryId);
  if(!target?.active||target.gameplayEnabled===false||!target.imageryPhotoId||!Number.isFinite(target.latitude)||!Number.isFinite(target.longitude)){
    return NextResponse.json({error:'The Sponsored Mission target is not gameplay ready.'},{status:409,headers:{'Cache-Control':'no-store'}});
  }

  const actual={lat:target.latitude,lng:target.longitude};
  const km=distanceKm({lat,lng},actual);
  const profile=getCommunityProfile(target.id);
  const logo=getDispensaryLogo(target.id);

  return NextResponse.json({
    result:{
      target:actual,
      distanceKm:Number(km.toFixed(6)),
      score:missionScore(km,elapsedSeconds),
      elapsedSeconds,
      campaignTitle:campaign.title||'GeoWeedo Sponsored Mission',
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
