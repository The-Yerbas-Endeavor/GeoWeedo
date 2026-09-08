import {NextRequest,NextResponse} from 'next/server';
import {activeGameCampaign,getGameCampaign,recordGameCampaignEvent,type GameCampaignEventType,type GameCampaignType} from '@/lib/gameSponsorship';
import {getLocationBase,getCommunityProfile} from '@/lib/dispensaryCommunity';
import {getDispensaryLogo} from '@/lib/dispensaryLogo';

export const dynamic='force-dynamic';

function validGame(value:string|null):value is GameCampaignType{return value==='classic'||value==='daily'||value==='hunt';}
function validEvent(value:string):value is GameCampaignEventType{return ['game_impression','game_completed','listing_view','website_click'].includes(value);}

function publicCampaign(campaign:NonNullable<ReturnType<typeof activeGameCampaign>>){
 const location=getLocationBase(campaign.dispensaryId);
 if(!location)return null;
 const profile=getCommunityProfile(campaign.dispensaryId),logo=getDispensaryLogo(campaign.dispensaryId);
 return {
  campaign:{
   id:campaign.id,gameType:campaign.gameType,placement:campaign.placement,
   geographyType:campaign.geographyType,geographyValue:campaign.geographyValue,radiusKm:campaign.radiusKm,
   startsAt:campaign.startsAt,endsAt:campaign.endsAt,title:campaign.title,
  },
  sponsor:{
   id:location.id,name:location.name,city:location.city,region:location.region,country:location.country,
   website:profile?.website||location.website||null,logo:logo?.path||null,profileHref:`/dispensary/${encodeURIComponent(location.id)}`,
  },
 };
}

export async function GET(request:NextRequest){
 const game=request.nextUrl.searchParams.get('game');
 if(!validGame(game))return NextResponse.json({error:'game must be classic, daily, or hunt'},{status:400});
 const campaign=activeGameCampaign(game);
 return NextResponse.json({game,campaign:campaign?publicCampaign(campaign):null},{headers:{'Cache-Control':'no-store'}});
}

export async function POST(request:NextRequest){
 const body=await request.json().catch(()=>({}));
 const campaignId=String(body.campaignId||'').trim(),eventType=String(body.eventType||'').trim();
 if(!campaignId||!validEvent(eventType))return NextResponse.json({error:'Invalid campaign event.'},{status:400});
 const campaign=getGameCampaign(campaignId);
 if(!campaign)return NextResponse.json({ok:true,recorded:false});
 const metadata=body.metadata&&typeof body.metadata==='object'&&!Array.isArray(body.metadata)?body.metadata:{};
 const recorded=recordGameCampaignEvent(campaignId,eventType,metadata);
 return NextResponse.json({ok:true,recorded});
}
