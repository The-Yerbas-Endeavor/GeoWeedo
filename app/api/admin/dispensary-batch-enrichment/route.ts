import {NextRequest,NextResponse} from 'next/server';
import {getAdminFromRequest} from '@/lib/adminAuth';
import {createBatchJob,discoveryConfigured,discoveryProvider,getBatchScopeOptions,listBatchJobs,listReviewQueue,processBatchChunk,reviewQueueItem} from '@/lib/dispensaryBatchEnrichment';

export const dynamic='force-dynamic';

export async function GET(request:NextRequest){const admin=getAdminFromRequest(request);if(!admin)return NextResponse.json({error:'Unauthorized.'},{status:401});const url=new URL(request.url);const reviewStatus=url.searchParams.get('reviewStatus')||'pending';return NextResponse.json({options:getBatchScopeOptions(),jobs:listBatchJobs(15),reviews:listReviewQueue(reviewStatus,100),discoveryConfigured:discoveryConfigured(),discoveryProvider:discoveryProvider()});}

export async function POST(request:NextRequest){const admin=getAdminFromRequest(request);if(!admin)return NextResponse.json({error:'Unauthorized.'},{status:401});const body=await request.json().catch(()=>null);try{if(body?.action==='create'){const job=createBatchJob(admin.id,body.scope||{},body.autoApply!==false);return NextResponse.json({job});}if(body?.action==='process'){if(!body.jobId)return NextResponse.json({error:'jobId is required.'},{status:400});const job=await processBatchChunk(String(body.jobId),admin.id,Number(body.chunkSize||5));return NextResponse.json({job});}return NextResponse.json({error:'Unknown batch action.'},{status:400});}catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Batch operation failed.'},{status:400});}}

export async function PATCH(request:NextRequest){const admin=getAdminFromRequest(request);if(!admin)return NextResponse.json({error:'Unauthorized.'},{status:401});const body=await request.json().catch(()=>null);if(!body?.reviewId||!['approve','reject'].includes(body?.action))return NextResponse.json({error:'reviewId and approve/reject action are required.'},{status:400});try{return NextResponse.json(await reviewQueueItem(String(body.reviewId),body.action,admin.id));}catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Review action failed.'},{status:400});}}
