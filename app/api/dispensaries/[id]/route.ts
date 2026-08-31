import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/userAuth';
import { getCommunityProfile, getLocationBase, listPublicReviews, reviewSummary, submitReview } from '@/lib/dispensaryCommunity';
import { getDatabase } from '@/lib/sqlite';

export const runtime='nodejs';
type Context={params:Promise<{id:string}>};
type Kind='dispensary'|'candidate';
function optional(value:unknown){return value==null||value===''?undefined:String(value);}
function getLocationBaseByKind(id:string,kind:Kind){
 const db=getDatabase();
 if(kind==='dispensary'){
  const row=db.prepare(`SELECT id,name,street_address,city,region,postal_code,country,latitude,longitude,website,phone,license_number,data_source,source_url,recreational,medical,verified,active FROM dispensaries WHERE id=?`).get(id) as Record<string,unknown>|undefined;
  if(!row)return null;return{kind:'dispensary' as const,id:String(row.id),name:String(row.name),streetAddress:optional(row.street_address),city:String(row.city||''),region:String(row.region||''),postalCode:optional(row.postal_code),country:String(row.country||''),latitude:Number(row.latitude),longitude:Number(row.longitude),website:optional(row.website),phone:optional(row.phone),licenseNumber:optional(row.license_number),dataSource:optional(row.data_source),sourceUrl:optional(row.source_url),recreational:Boolean(row.recreational),medical:Boolean(row.medical),verified:Boolean(row.verified),active:Boolean(row.active)};
 }
 const row=db.prepare(`SELECT id,name,street_address,city,region,postal_code,country,latitude,longitude,website,phone,license_number,data_source,source_url,status FROM dispensary_candidates WHERE id=? AND status<>'rejected'`).get(id) as Record<string,unknown>|undefined;
 if(!row)return null;return{kind:'candidate' as const,id:String(row.id),name:String(row.name),streetAddress:optional(row.street_address),city:String(row.city||''),region:String(row.region||''),postalCode:optional(row.postal_code),country:String(row.country||''),latitude:Number(row.latitude),longitude:Number(row.longitude),website:optional(row.website),phone:optional(row.phone),licenseNumber:optional(row.license_number),dataSource:optional(row.data_source),sourceUrl:optional(row.source_url),verified:false,active:true};
}
function hasCrossKindCollision(id:string){const db=getDatabase();const approved=Boolean(db.prepare(`SELECT 1 ok FROM dispensaries WHERE id=?`).get(id)),candidate=Boolean(db.prepare(`SELECT 1 ok FROM dispensary_candidates WHERE id=? AND status<>'rejected'`).get(id));return approved&&candidate;}

export async function GET(request:NextRequest,{params}:Context){
 const {id}=await params;const requested=request.nextUrl.searchParams.get('kind');const kind:Kind|null=requested==='candidate'||requested==='dispensary'?requested:null;const base=kind?getLocationBaseByKind(id,kind):getLocationBase(id);if(!base)return NextResponse.json({error:'Location not found.'},{status:404});
 const ambiguous=Boolean(kind&&hasCrossKindCollision(id));const profile=ambiguous?null:getCommunityProfile(id);const ratings=ambiguous?{count:0,average:0}:reviewSummary(id);const reviews=ambiguous?[]:listPublicReviews(id,25);
 return NextResponse.json({location:{...base,website:profile?.website||base.website,phone:profile?.phone||base.phone,overview:profile?.overview||null,hours:profile?.hours||{},amenities:profile?.amenities||[],social:profile?.social||{}},ratings,reviews,identity:{id,kind:base.kind,ambiguousLegacyId:ambiguous}});
}

export async function POST(request:NextRequest,{params}:Context){
 const user=getUserFromRequest(request);if(!user)return NextResponse.json({error:'Sign in to leave a review.'},{status:401});
 const {id}=await params;const body=await request.json().catch(()=>null);if(!body)return NextResponse.json({error:'Invalid review payload.'},{status:400});
 try{const result=submitReview({locationId:id,userId:user.id,author:user.handle,rating:Number(body.rating),title:String(body.title||''),body:String(body.body||'')});return NextResponse.json({ok:true,...result,message:'Review submitted for moderation.'});}catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Review submission failed.'},{status:400});}
}
