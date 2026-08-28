import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/adminAuth';
import { listCandidates, updateCandidate, type DispensaryCandidate } from '@/lib/candidateStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function csvEscape(value: unknown) { const text = String(value ?? ''); return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; }
function parseCsvLine(line: string) { const values:string[]=[]; let value=''; let quoted=false; for(let i=0;i<line.length;i++){const char=line[i]; if(char==='"'){if(quoted&&line[i+1]==='"'){value+='"';i++;}else quoted=!quoted;}else if(char===','&&!quoted){values.push(value);value='';}else value+=char;} values.push(value); return values; }
function oneLineAddress(item: DispensaryCandidate) { return [item.streetAddress, item.city, item.region, item.country || 'USA'].filter(Boolean).join(', '); }
function parsedLocality(matchedAddress: string) { const parts=matchedAddress.split(',').map(p=>p.trim()).filter(Boolean); if(parts.length<3)return{}; const zipLike=/^\d{5}(?:-\d{4})?$/; let end=parts.length-1; if(zipLike.test(parts[end]))end--; const region=parts[end]||''; const city=parts[end-1]||''; return {city,region}; }

async function oneLineLookup(item: DispensaryCandidate) {
  const address=oneLineAddress(item); if(!address)return null;
  const url=new URL('https://geocoding.geo.census.gov/geocoder/locations/onelineaddress');
  url.searchParams.set('address',address); url.searchParams.set('benchmark','Public_AR_Current'); url.searchParams.set('format','json');
  const response=await fetch(url,{headers:{Accept:'application/json','User-Agent':'GeoWeedo/0.7 (https://geoweedo.yerbas.org)'},cache:'no-store'}); if(!response.ok)return null;
  const json=await response.json(); const match=Array.isArray(json?.result?.addressMatches)?json.result.addressMatches[0]:null;
  const latitude=Number(match?.coordinates?.y),longitude=Number(match?.coordinates?.x); if(!Number.isFinite(latitude)||!Number.isFinite(longitude))return null;
  const components=match?.addressComponents||{}; const matchedAddress=String(match?.matchedAddress||address); const fallback=parsedLocality(matchedAddress);
  return {latitude,longitude,matchedAddress,city:String(components.city||fallback.city||''),region:String(components.state||fallback.region||'')};
}

async function runWithConcurrency<T>(items:T[],concurrency:number,worker:(item:T)=>Promise<void>){let next=0;async function runner(){while(true){const index=next++;if(index>=items.length)return;await worker(items[index]);}}await Promise.all(Array.from({length:Math.min(concurrency,items.length)},()=>runner()));}

export async function POST(request:NextRequest){
  if(!getAdminFromRequest(request))return NextResponse.json({error:'Unauthorized.'},{status:401});
  const body=await request.json().catch(()=>({})); const limit=Math.max(1,Math.min(Number(body?.limit)||1000,2000)); const fallbackLimit=Math.max(0,Math.min(Number(body?.fallbackLimit)||200,500));
  const all=await listCandidates(); const missing=all.filter(item=>item.status==='candidate'&&(!Number.isFinite(item.latitude)||!Number.isFinite(item.longitude))); const candidates=missing.filter(item=>Boolean(item.streetAddress?.trim())).slice(0,limit); const candidateById=new Map(candidates.map(item=>[item.id,item])); const skippedWithoutStreet=missing.filter(item=>!item.streetAddress?.trim()).length;
  if(!candidates.length)return NextResponse.json({submitted:0,matched:0,batchMatched:0,fallbackMatched:0,unmatched:0,skippedWithoutStreet,remaining:missing.length});
  const lines=candidates.map(item=>[item.id,item.streetAddress||'',item.city||'',item.region||'',''].map(csvEscape).join(',')); const form=new FormData(); form.set('benchmark','Public_AR_Current'); form.set('addressFile',new Blob([lines.join('\n')],{type:'text/csv'}),'geoweedo-addresses.csv');
  try{
    const response=await fetch('https://geocoding.geo.census.gov/geocoder/locations/addressbatch',{method:'POST',body:form,headers:{'User-Agent':'GeoWeedo/0.7 (https://geoweedo.yerbas.org)'},cache:'no-store'}); if(!response.ok)throw new Error(`U.S. Census Geocoder returned ${response.status}`);
    const text=await response.text(); const rows=text.split(/\r?\n/).filter(line=>line.trim()); const matchedIds=new Set<string>(); let batchMatched=0;
    for(const line of rows){const fields=parseCsvLine(line); const id=fields[0]?.trim(); if(!id)continue; const status=fields[2]?.trim().toLowerCase(); const coordinates=fields[5]?.trim()||''; const parts=coordinates.split(',').map(value=>Number(value.trim())); const longitude=parts[0],latitude=parts[1]; if(status==='match'&&Number.isFinite(latitude)&&Number.isFinite(longitude)){const item=candidateById.get(id); const matchedAddress=fields[4]||''; const locality=parsedLocality(matchedAddress); await updateCandidate(id,{latitude,longitude,city:item?.city||locality.city||undefined,region:item?.region||locality.region||undefined,imageryStatus:'unchecked',imageryCount:0,imageryCheckedAt:undefined,imageryMessage:`Coordinates matched by U.S. Census batch geocoder: ${matchedAddress||'matched address'}`}); matchedIds.add(id); batchMatched++;}}
    const fallbackPool=candidates.filter(item=>!matchedIds.has(item.id)||!item.city?.trim()); const fallbackCandidates=fallbackPool.slice(0,fallbackLimit); let fallbackMatched=0;
    await runWithConcurrency(fallbackCandidates,5,async item=>{try{const match=await oneLineLookup(item);if(!match)return;await updateCandidate(item.id,{latitude:match.latitude,longitude:match.longitude,city:item.city||match.city||undefined,region:item.region||match.region||undefined,imageryStatus:'unchecked',imageryCount:0,imageryCheckedAt:undefined,imageryMessage:`Coordinates matched by U.S. Census one-line geocoder: ${match.matchedAddress}`});if(!matchedIds.has(item.id))fallbackMatched++;matchedIds.add(item.id);}catch{}});
    const unresolved=candidates.filter(item=>!matchedIds.has(item.id)); for(const item of unresolved){await updateCandidate(item.id,{imageryStatus:'missing_coordinates',imageryMessage:fallbackCandidates.some(candidate=>candidate.id===item.id)?'U.S. Census batch and one-line geocoders did not return an address match; manual review may be required.':'Batch geocoder did not return a match; one-line fallback will be attempted in a later run.'});}
    const after=await listCandidates(); const remaining=after.filter(item=>item.status==='candidate'&&(!Number.isFinite(item.latitude)||!Number.isFinite(item.longitude))).length; const matched=batchMatched+fallbackMatched;
    return NextResponse.json({submitted:candidates.length,matched,batchMatched,fallbackMatched,fallbackAttempted:fallbackCandidates.length,unmatched:candidates.length-matched,skippedWithoutStreet,remaining,provider:'U.S. Census Geocoder'},{headers:{'Cache-Control':'no-store'}});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Batch geocoding failed.'},{status:502});}
}
