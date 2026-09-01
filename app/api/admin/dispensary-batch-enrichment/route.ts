import {NextRequest,NextResponse} from 'next/server';
import {getAdminFromRequest} from '@/lib/adminAuth';
import {createBatchJob,getBatchJob,getBatchScopeOptions,listBatchJobs,listReviewQueue,placesConfigured,processBatchChunk,reviewQueueItem} from '@/lib/dispensaryBatchEnrichment';
import {resumeBlockedBatch} from '@/lib/dispensaryBatchRecovery';
import {controlBatchJob,getBatchControlState} from '@/lib/dispensaryBatchControl';

export const dynamic='force-dynamic';

export async function GET(request:NextRequest){const admin=getAdminFromRequest(request);if(!admin)return NextResponse.json({error:'Unauthorized.'},{status:401});const url=new URL(request.url);const reviewStatus=url.searchParams.get('reviewStatus')||'pending';return NextResponse.json({options:getBatchScopeOptions(),jobs:listBatchJobs(15),reviews:listReviewQueue(reviewStatus,100),googlePlacesConfigured:placesConfigured(),enrichmentSources:[{id:'google_places',label:'Google Places',configured:placesConfigured(),primary:true},{id:'official_website',label:'Official website',configured:true,primary:false}]});}

export async function POST(request:NextRequest){const admin=getAdminFromRequest(request);if(!admin)return NextResponse.json({error:'Unauthorized.'},{status:401});const body=await request.json().catch(()=>null);try{
 if(body?.action==='create'){const job=createBatchJob(admin.id,body.scope||{},body.autoApply!==false);return NextResponse.json({job});}
 if(body?.action==='singleCandidate'){
  if(!body.locationId)return NextResponse.json({error:'locationId is required.'},{status:400});
  if(!placesConfigured())return NextResponse.json({error:'Google Places enrichment is not configured.'},{status:400});
  const job=createBatchJob(admin.id,{recordType:'candidate',locationId:String(body.locationId)},body.autoApply!==false);
  if(!job?.total)return NextResponse.json({error:'Candidate was not found or is no longer eligible.'},{status:404});
  const processed=await processBatchChunk(job.id,admin.id,1);
  return NextResponse.json({job:processed});
 }
 if(body?.action==='process'){
  if(!body.jobId)return NextResponse.json({error:'jobId is required.'},{status:400});
  const jobId=String(body.jobId),state=getBatchControlState(jobId);
  if(['paused','cancelled','completed'].includes(state.status))return NextResponse.json({job:getBatchJob(jobId),processed:0,stopped:true});
  const before=Number(getBatchJob(jobId)?.counts?.pending||0);
  const job=await processBatchChunk(jobId,admin.id,Math.min(10,Math.max(1,Number(body.chunkSize||5))));
  const after=Number(job?.counts?.pending||0);
  return NextResponse.json({job,processed:Math.max(0,before-after)});
 }
 if(body?.action==='control'){
  if(!body.jobId)return NextResponse.json({error:'jobId is required.'},{status:400});
  if(!['pause','resume','cancel'].includes(body.control))return NextResponse.json({error:'control must be pause, resume, or cancel.'},{status:400});
  const jobId=String(body.jobId);
  const recovery=body.control==='resume'&&placesConfigured()?resumeBlockedBatch(jobId):null;
  const control=controlBatchJob(jobId,body.control);
  return NextResponse.json({control,recovery,job:getBatchJob(jobId)});
 }
 if(body?.action==='retryBlocked'){if(!body.jobId)return NextResponse.json({error:'jobId is required.'},{status:400});return NextResponse.json({recovery:resumeBlockedBatch(String(body.jobId))});}
 return NextResponse.json({error:'Unknown batch action.'},{status:400});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Batch operation failed.'},{status:400});}}

export async function PATCH(request:NextRequest){const admin=getAdminFromRequest(request);if(!admin)return NextResponse.json({error:'Unauthorized.'},{status:401});const body=await request.json().catch(()=>null);if(!body?.reviewId||!['approve','reject'].includes(body?.action))return NextResponse.json({error:'reviewId and approve/reject action are required.'},{status:400});try{return NextResponse.json(await reviewQueueItem(String(body.reviewId),body.action,admin.id));}catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Review action failed.'},{status:400});}}
