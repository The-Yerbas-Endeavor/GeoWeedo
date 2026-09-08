import {NextRequest,NextResponse} from 'next/server';
import {adminHasPermission,getAdminFromRequest} from '@/lib/adminAuth';
import {updateGameCampaignStatus,type GameCampaignStatus} from '@/lib/gameSponsorship';

export async function PATCH(request:NextRequest){
 const admin=getAdminFromRequest(request);
 if(!admin)return NextResponse.json({error:'Sign in required.'},{status:401});
 if(!adminHasPermission(admin,'sponsorships.manage'))return NextResponse.json({error:'You do not have permission to manage sponsorships.'},{status:403});
 const body=await request.json().catch(()=>({})),campaignId=String(body.campaignId||'').trim(),status=String(body.status||'') as GameCampaignStatus;
 if(!campaignId||!['active','paused','expired','cancelled'].includes(status))return NextResponse.json({error:'Valid campaign and status are required.'},{status:400});
 try{return NextResponse.json({campaign:updateGameCampaignStatus(campaignId,status)});}catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Could not update campaign.'},{status:400});}
}
