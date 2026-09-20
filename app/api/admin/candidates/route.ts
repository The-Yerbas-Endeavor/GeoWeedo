import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/adminAuth';
import { auditCandidatePipeline, assessCandidatePipeline, listCandidates, updateCandidate, type DispensaryCandidate } from '@/lib/candidateStore';
import { saveApprovedDispensary } from '@/lib/dispensaryStore';
import { getDatabase } from '@/lib/sqlite';
import { lookupGameplayStreetView } from '@/lib/streetViewLookupClient';
import { reverseGeocodeCoordinates } from '@/lib/reverseGeocode';

function automatedEnrichmentApprovedIds(){
 try{
  const db=getDatabase();
  const table=db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='dispensary_batch_items'`).get() as {name:string}|undefined;
  if(!table)return new Set<string>();
  const rows=db.prepare(`SELECT DISTINCT location_id FROM dispensary_batch_items WHERE record_type='candidate' AND status='applied'`).all() as Array<{location_id:string}>;
  return new Set(rows.map(row=>String(row.location_id)));
 }catch{return new Set<string>();}
}

async function mapWithConcurrency<T,R>(items:T[],concurrency:number,worker:(item:T,index:number)=>Promise<R>){
 const results=new Array<R>(items.length);
 let next=0;
 async function run(){
  while(true){
   const index=next++;
   if(index>=items.length)return;
   results[index]=await worker(items[index],index);
  }
 }
 await Promise.all(Array.from({length:Math.min(Math.max(1,concurrency),items.length)},()=>run()));
 return results;
}

export async function GET(request:NextRequest){
 if(!getAdminFromRequest(request))return NextResponse.json({error:'Unauthorized.'},{status:401});
 if(request.nextUrl.searchParams.get('summary')==='1'){
  const db=getDatabase();
  const row=db.prepare(`SELECT COUNT(*) AS total,COUNT(DISTINCT NULLIF(TRIM(region),'')) AS regions FROM dispensary_candidates`).get() as {total:number;regions:number}|undefined;
  return NextResponse.json({summary:{total:Number(row?.total||0),regions:Number(row?.regions||0)}},{headers:{'Cache-Control':'no-store'}});
 }
 const candidates=await listCandidates(),enriched=automatedEnrichmentApprovedIds();
 return NextResponse.json({candidates:candidates.map(item=>({...item,automatedEnrichmentApproved:enriched.has(String(item.id))}))},{headers:{'Cache-Control':'no-store'}});
}

function selectedStartingPhotoId(message?:string){
 const match=String(message||'').match(/Starting view\s+([^\s.]+)\./i);
 return match?.[1]||'';
}
async function fillCandidateLocality(item:DispensaryCandidate){
 if(!Number.isFinite(item.latitude)||!Number.isFinite(item.longitude))return item;
 if(item.city?.trim()&&item.postalCode?.trim())return item;
 try{
  const location=await reverseGeocodeCoordinates(item.latitude as number,item.longitude as number);
  if(!location)return item;
  const patch:Partial<DispensaryCandidate>={};
  if(!item.city?.trim()&&location.city)patch.city=location.city;
  if(!item.postalCode?.trim()&&location.postalCode)patch.postalCode=location.postalCode;
  if(!item.region?.trim()&&location.region)patch.region=location.region;
  if(!item.country?.trim()&&location.country)patch.country=location.country;
  if(!Object.keys(patch).length)return item;
  return await updateCandidate(item.id,patch)||item;
 }catch{return item;}
}

function distanceMeters(a:{lat:number;lng:number},b:{lat:number;lng:number}){
 const radius=6371008.8,toRad=(value:number)=>value*Math.PI/180;
 const dLat=toRad(b.lat-a.lat),dLng=toRad(b.lng-a.lng),lat1=toRad(a.lat),lat2=toRad(b.lat);
 const h=Math.sin(dLat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLng/2)**2;
 return radius*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));
}

async function promoteCandidate(original:DispensaryCandidate){
 let item=original;
 if(Number.isFinite(item.latitude)&&Number.isFinite(item.longitude))item=await fillCandidateLocality(item);
 const pipeline=assessCandidatePipeline(item);
 if(!pipeline.eligible)return{ok:false,reason:`pipeline_${String(pipeline.reason||'ineligible').replace(/\W+/g,'_')}`};
 if(!Number.isFinite(item.latitude)||!Number.isFinite(item.longitude))return{ok:false,reason:'missing_coordinates'};
 if(!item.city?.trim()||!item.region?.trim())return{ok:false,reason:'missing_location_fields'};
 if(item.imageryStatus!=='coverage')return{ok:false,reason:'imagery_not_playable'};
 try{
  const requestedPhotoId=selectedStartingPhotoId(item.imageryMessage);
  const adminSelected=String(item.imageryMessage||'').startsWith('ADMIN_SELECTED_STREET_VIEW');
  const adminConfirmed=/^ADMIN_(?:CONFIRMED|SELECTED)_STREET_VIEW/.test(String(item.imageryMessage||''));

  const savePostalCode=(dispensaryId:string)=>{
   if(item.postalCode?.trim())getDatabase().prepare('UPDATE dispensaries SET postal_code=? WHERE id=?').run(item.postalCode.trim(),dispensaryId);
  };

  const inspection=await lookupGameplayStreetView(item.latitude as number,item.longitude as number,requestedPhotoId||undefined);
  const photos=Array.isArray(inspection.photos)?inspection.photos:[];
  const defaultPhoto=photos[Math.max(0,Number(inspection.initialIndex||0))]||photos[0];
  const exactPhoto=requestedPhotoId?photos.find(candidate=>String(candidate.id)===requestedPhotoId):undefined;
  const photo=exactPhoto||defaultPhoto;
  if(!photo?.id||!photo.imageUrl)return{ok:false,reason:'imagery_revalidation_failed'};

  const selectedImageChanged=Boolean(requestedPhotoId&&String(photo.id)!==requestedPhotoId);
  const replacementDistanceMeters=selectedImageChanged
   ? distanceMeters({lat:item.latitude as number,lng:item.longitude as number},{lat:Number(photo.lat),lng:Number(photo.lng)})
   : 0;
  const safeReplacement=Boolean(
   selectedImageChanged &&
   Number.isFinite(replacementDistanceMeters) &&
   replacementDistanceMeters<=100 &&
   inspection.quality?.playable
  );

  // Stored Street View IDs are hints, not permanent identities. Prefer the
  // exact saved image when it still exists, but do not strand a good location
  // when the provider rotates a pano/sequence or the lookup returns a newer
  // nearby image. A replacement must still pass normal gameplay quality and
  // remain within 100 m of the dispensary coordinates.
  if(selectedImageChanged&&!safeReplacement){
   if(replacementDistanceMeters>100)return{ok:false,reason:'replacement_imagery_too_far'};
   if(!inspection.quality?.playable)return{ok:false,reason:'replacement_imagery_not_playable'};
   return{ok:false,reason:'replacement_imagery_not_safe'};
  }
  if(!selectedImageChanged&&!inspection.quality?.playable&&!adminConfirmed){
   return{ok:false,reason:'imagery_revalidation_failed'};
  }
  const saved=await saveApprovedDispensary({name:item.name,slug:`${item.name}-${item.city}-${item.id.slice(-8)}`,streetAddress:item.streetAddress,city:item.city,region:item.region,country:item.country||'USA',latitude:item.latitude as number,longitude:item.longitude as number,website:item.website,dataSource:item.dataSource,sourceUrl:item.sourceUrl,sourceLicense:item.sourceLicense,recreational:false,medical:false,imageryProvider:inspection.provider,imageryPhotoId:photo.id,imagerySequenceId:photo.sequenceId||undefined,imageryLatitude:photo.lat,imageryLongitude:photo.lng,imageryHeading:photo.heading,imageryFieldOfView:photo.fieldOfView,imageryProjection:photo.projection,imageryUrl:photo.imageUrl,active:true});
  savePostalCode(saved.id);
  const promotionMessage=safeReplacement
   ? `Promoted to gameplay with refreshed Street View · ${inspection.provider} · previous image ${requestedPhotoId} replaced by ${photo.id} · ${Math.round(replacementDistanceMeters)} m from location. Starting view ${photo.id}.`
   : adminSelected
     ? `Promoted to gameplay with admin-selected Street View · ${inspection.provider}. Starting view ${photo.id}.`
     : adminConfirmed
       ? `Promoted to gameplay with admin-confirmed Street View · ${inspection.provider}. Starting view ${photo.id}.`
       : `Promoted to gameplay with Street View · ${inspection.provider} · Grade ${inspection.quality?.grade||'A'}: ${inspection.quality?.reason||'Gameplay-ready imagery.'} Starting view ${photo.id}.`;
  await updateCandidate(item.id,{status:'approved',imageryMessage:promotionMessage});
  return{ok:true,dispensaryId:saved.id};
 }catch{return{ok:false,reason:'imagery_revalidation_error'};}
}

function cleanupCandidateEnrichment(db:ReturnType<typeof getDatabase>,id:string){
 for(const table of ['dispensary_batch_items','google_places_enrichment']){
  try{db.prepare(`DELETE FROM ${table} WHERE location_id=?`).run(id);}catch{}
 }
}

export async function DELETE(request:NextRequest){
 if(!getAdminFromRequest(request))return NextResponse.json({error:'Unauthorized.'},{status:401});
 const body=await request.json().catch(()=>null);
 const db=getDatabase();
 if(body?.allRejected===true){
  const countRow=db.prepare("SELECT COUNT(*) AS count FROM dispensary_candidates WHERE status='rejected'").get() as {count:number}|undefined;
  const requested=Number(countRow?.count||0);
  if(!requested)return NextResponse.json({deleted:true,count:0});
  const ids=(db.prepare("SELECT id FROM dispensary_candidates WHERE status='rejected'").all() as Array<{id:string}>).map(row=>String(row.id));
  const result=db.prepare("DELETE FROM dispensary_candidates WHERE status='rejected'").run();
  for(const id of ids)cleanupCandidateEnrichment(db,id);
  return NextResponse.json({deleted:true,count:Number(result.changes),requested});
 }
 const ids=Array.isArray(body?.ids)?Array.from(new Set<string>(body.ids.map((value:unknown)=>String(value).trim()).filter(Boolean))).slice(0,5000):[];
 if(ids.length){
  const placeholders=ids.map(()=>'?').join(',');
  const matchedRows=db.prepare(`SELECT id FROM dispensary_candidates WHERE status='rejected' AND id IN (${placeholders})`).all(...ids) as Array<{id:string}>;
  const result=db.prepare(`DELETE FROM dispensary_candidates WHERE status='rejected' AND id IN (${placeholders})`).run(...ids);
  for(const row of matchedRows)cleanupCandidateEnrichment(db,String(row.id));
  return NextResponse.json({deleted:true,count:Number(result.changes),requested:ids.length,matched:matchedRows.length});
 }
 const id=String(body?.id||'').trim();
 if(!id)return NextResponse.json({error:'Candidate id is required.'},{status:400});
 const current=db.prepare('SELECT id,name,status FROM dispensary_candidates WHERE id=? LIMIT 1').get(id) as {id:string;name:string;status:string}|undefined;
 if(!current)return NextResponse.json({error:'Candidate not found.'},{status:404});
 const deleteOpenCandidate=body?.deleteCandidate===true;
 const allowed=deleteOpenCandidate?['candidate','reviewing'].includes(current.status):current.status==='rejected';
 if(!allowed)return NextResponse.json({error:deleteOpenCandidate?'Only unapproved candidate or reviewing records can be deleted.':'Only rejected candidates can be deleted.'},{status:409});
 const result=db.prepare('DELETE FROM dispensary_candidates WHERE id=?').run(id);
 if(!Number(result.changes))return NextResponse.json({error:'Candidate could not be deleted.'},{status:409});
 cleanupCandidateEnrichment(db,id);
 return NextResponse.json({deleted:true,id,name:current.name,count:1});
}

export async function PATCH(request:NextRequest){if(!getAdminFromRequest(request))return NextResponse.json({error:'Unauthorized.'},{status:401});const body=await request.json().catch(()=>null);
 if(body?.action==='pipeline-audit'||body?.action==='pipeline-cleanup'){return NextResponse.json(await auditCandidatePipeline({apply:body.action==='pipeline-cleanup'}));}
 if(Array.isArray(body?.ids)){const ids=Array.from(new Set<string>(body.ids.map((v:unknown)=>String(v)).filter(Boolean))).slice(0,5000),action=String(body.action||'');if(!ids.length)return NextResponse.json({error:'At least one candidate id is required.'},{status:400});if(!['approve','reject'].includes(action))return NextResponse.json({error:'Bulk action must be approve or reject.'},{status:400});const all=await listCandidates(),selected=all.filter(i=>ids.includes(i.id));let updated=0,skipped=0,promoted=0;const skippedReasons:Record<string,number>={};const outcomes=await mapWithConcurrency(selected,5,async item=>{if(action==='approve')return await promoteCandidate(item);const candidate=await updateCandidate(item.id,{status:'rejected'});return candidate?{ok:true,dispensaryId:''}:{ok:false,reason:'update_failed'};});for(const result of outcomes){if(result.ok){updated++;if(action==='approve')promoted++;continue;}skipped++;const reason=result.reason||'not_eligible';skippedReasons[reason]=(skippedReasons[reason]||0)+1;}return NextResponse.json({action,requested:ids.length,matched:selected.length,updated,promoted,skipped,skippedReasons});}
 if(!body?.id)return NextResponse.json({error:'Candidate id is required.'},{status:400});const id=String(body.id),all=await listCandidates(),current=all.find(i=>i.id===id);if(!current)return NextResponse.json({error:'Candidate not found.'},{status:404});if(body.status==='approved'){const result=await promoteCandidate(current);if(!result.ok)return NextResponse.json({error:`Candidate cannot enter gameplay: ${result.reason}.`},{status:400});return NextResponse.json({candidate:(await listCandidates()).find(i=>i.id===id),promoted:true});}const patch:Partial<DispensaryCandidate>={};if(['candidate','reviewing','rejected'].includes(body.status))patch.status=body.status as DispensaryCandidate['status'];if(body.name!==undefined)patch.name=String(body.name).trim();if(body.streetAddress!==undefined)patch.streetAddress=String(body.streetAddress).trim()||undefined;if(body.city!==undefined)patch.city=String(body.city).trim()||undefined;if(body.region!==undefined)patch.region=String(body.region).trim()||undefined;if(body.postalCode!==undefined)patch.postalCode=String(body.postalCode).trim()||undefined;if(body.country!==undefined)patch.country=String(body.country).trim()||undefined;if(body.website!==undefined)patch.website=String(body.website).trim()||undefined;if(body.licenseNumber!==undefined)patch.licenseNumber=String(body.licenseNumber).trim()||undefined;if(body.sourceUrl!==undefined)patch.sourceUrl=String(body.sourceUrl).trim()||undefined;if(body.sourceLicense!==undefined)patch.sourceLicense=String(body.sourceLicense).trim()||undefined;if(body.latitude!==undefined&&Number.isFinite(Number(body.latitude)))patch.latitude=Number(body.latitude);if(body.longitude!==undefined&&Number.isFinite(Number(body.longitude)))patch.longitude=Number(body.longitude);return NextResponse.json({candidate:await updateCandidate(id,patch)});
}
