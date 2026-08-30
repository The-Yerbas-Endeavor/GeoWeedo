import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/adminAuth';
import { listCandidates, updateCandidate, type DispensaryCandidate } from '@/lib/candidateStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function csvEscape(value: unknown) { const text = String(value ?? ''); return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; }
function parseCsvLine(line: string) { const values:string[]=[]; let value=''; let quoted=false; for(let i=0;i<line.length;i++){const char=line[i]; if(char==='"'){if(quoted&&line[i+1]==='"'){value+='"';i++;}else quoted=!quoted;}else if(char===','&&!quoted){values.push(value);value='';}else value+=char;} values.push(value); return values; }
function oneLineAddress(item: DispensaryCandidate) { return [item.streetAddress, item.city, item.region, item.country || 'USA'].filter(Boolean).join(', '); }
function parsedLocality(matchedAddress: string) { const parts=matchedAddress.split(',').map(p=>p.trim()).filter(Boolean); if(parts.length<3)return{}; const zipLike=/^\d{5}(?:-\d{4})?$/; let end=parts.length-1; if(zipLike.test(parts[end]))end--; const region=parts[end]||''; const city=parts[end-1]||''; return {city,region}; }
function normalizeName(value:string){return value.toLowerCase().replace(/\b(llc|inc|ltd|dispensary|cannabis|marijuana|medical|adult use|company|corp|corporation)\b/g,' ').replace(/[^a-z0-9]+/g,' ').trim();}
function normalizedCountry(item:DispensaryCandidate){return String(item.country||'USA').trim().toLowerCase();}
function isUsCandidate(item:DispensaryCandidate){return ['usa','us','united states','united states of america'].includes(normalizedCountry(item));}
function supportsLocationFallback(region:string){return ['montana','alaska','new jersey'].includes(region.trim().toLowerCase());}
function stateBounds(region:string,latitude:number,longitude:number){const r=region.trim().toLowerCase();if(r==='montana')return latitude>=44.35&&latitude<=49.1&&longitude>=-116.2&&longitude<=-103.9;if(r==='alaska')return latitude>=51.0&&latitude<=72.0&&longitude>=-180&&longitude<=-129.0;if(r==='new jersey')return latitude>=38.85&&latitude<=41.36&&longitude>=-75.65&&longitude<=-73.85;return false;}

async function oneLineLookup(item: DispensaryCandidate) {
  if(!isUsCandidate(item))return null;
  const address=oneLineAddress(item); if(!address)return null;
  const url=new URL('https://geocoding.geo.census.gov/geocoder/locations/onelineaddress');
  url.searchParams.set('address',address); url.searchParams.set('benchmark','Public_AR_Current'); url.searchParams.set('format','json');
  const response=await fetch(url,{headers:{Accept:'application/json','User-Agent':'GeoWeedo/0.8 (https://geoweedo.com)'},cache:'no-store'}); if(!response.ok)return null;
  const json=await response.json(); const match=Array.isArray(json?.result?.addressMatches)?json.result.addressMatches[0]:null;
  const latitude=Number(match?.coordinates?.y),longitude=Number(match?.coordinates?.x); if(!Number.isFinite(latitude)||!Number.isFinite(longitude))return null;
  const components=match?.addressComponents||{}; const matchedAddress=String(match?.matchedAddress||address); const fallback=parsedLocality(matchedAddress);
  return {latitude,longitude,matchedAddress,city:String(components.city||fallback.city||''),region:String(components.state||fallback.region||'')};
}

async function locationNameLookup(item:DispensaryCandidate){
  if(!isUsCandidate(item))return null;
  const region=String(item.region||'').trim();if(!supportsLocationFallback(region)||!item.city?.trim()||!item.name?.trim())return null;
  const url=new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q',`${item.name}, ${item.city}, ${region}, USA`);url.searchParams.set('format','jsonv2');url.searchParams.set('addressdetails','1');url.searchParams.set('limit','5');url.searchParams.set('countrycodes','us');
  const response=await fetch(url,{headers:{Accept:'application/json','User-Agent':`GeoWeedo/0.8 (https://geoweedo.com; ${region} official-license coordinate enrichment)`},cache:'no-store'});if(!response.ok)return null;
  const results=await response.json();if(!Array.isArray(results))return null;const wantedCity=normalizeName(item.city),wantedName=normalizeName(item.name);
  for(const result of results){const latitude=Number(result.lat),longitude=Number(result.lon);if(!Number.isFinite(latitude)||!Number.isFinite(longitude)||!stateBounds(region,latitude,longitude))continue;const address=result.address||{};const state=String(address.state||'');if(state&&normalizeName(state)!==normalizeName(region))continue;const locality=String(address.city||address.town||address.village||address.hamlet||address.municipality||'');if(locality&&normalizeName(locality)!==wantedCity)continue;const display=String(result.display_name||'');const resultName=normalizeName(String(result.name||display.split(',')[0]||''));const nameMatch=Boolean(wantedName&&resultName&&(resultName.includes(wantedName)||wantedName.includes(resultName)));if(!nameMatch)continue;const category=String(result.category||result.class||'').toLowerCase(),type=String(result.type||'').toLowerCase();if(region.toLowerCase()==='new jersey'&&!/(shop|amenity|commercial|retail)/.test(`${category} ${type}`))continue;const street=[address.house_number,address.road].filter(Boolean).join(' ').trim();return{latitude,longitude,streetAddress:street||undefined,city:locality||item.city,matchedAddress:display};}
  return null;
}

async function runWithConcurrency<T>(items:T[],concurrency:number,worker:(item:T)=>Promise<void>){let next=0;async function runner(){while(true){const index=next++;if(index>=items.length)return;await worker(items[index]);}}await Promise.all(Array.from({length:Math.min(concurrency,items.length)},()=>runner()));}

export async function POST(request:NextRequest){
  if(!getAdminFromRequest(request))return NextResponse.json({error:'Unauthorized.'},{status:401});
  const body=await request.json().catch(()=>({}));
  const limit=Math.max(1,Math.min(Number(body?.limit)||1000,2000));
  const fallbackLimit=Math.max(0,Math.min(Number(body?.fallbackLimit)||200,500));
  const requestedRegion=String(body?.region||'').trim();
  const all=await listCandidates();
  const missingAll=all.filter(item=>item.status==='candidate'&&(!Number.isFinite(item.latitude)||!Number.isFinite(item.longitude)));
  const missing=requestedRegion?missingAll.filter(item=>String(item.region||'').trim().toLowerCase()===requestedRegion.toLowerCase()):missingAll;
  const nonUsMissing=missing.filter(item=>!isUsCandidate(item));
  const usMissing=missing.filter(isUsCandidate);
  const addressCandidates=usMissing.filter(item=>Boolean(item.streetAddress?.trim())).slice(0,limit);
  const locationFallbackCandidates=usMissing.filter(item=>supportsLocationFallback(String(item.region||''))&&!item.streetAddress?.trim()&&Boolean(item.city?.trim())&&Boolean(item.name?.trim())).slice(0,fallbackLimit);
  const candidates=addressCandidates;
  const candidateById=new Map(candidates.map(item=>[item.id,item]));
  const skippedWithoutStreet=Math.max(0,usMissing.filter(item=>!item.streetAddress?.trim()).length-locationFallbackCandidates.length);
  let locationFallbackMatched=0;

  await runWithConcurrency(locationFallbackCandidates,1,async item=>{try{const match=await locationNameLookup(item);if(!match){await updateCandidate(item.id,{imageryStatus:'missing_coordinates',imageryMessage:`${item.region} name+city fallback did not find a high-confidence in-state OpenStreetMap match; manual review required.`});return;}await updateCandidate(item.id,{latitude:match.latitude,longitude:match.longitude,streetAddress:match.streetAddress||item.streetAddress,city:match.city||item.city,imageryStatus:'unchecked',imageryCount:0,imageryCheckedAt:undefined,imageryMessage:`Coordinates matched by strict ${item.region} OpenStreetMap name+city fallback: ${match.matchedAddress}`});locationFallbackMatched++;}catch{}});

  if(!candidates.length){
    const after=await listCandidates();
    const afterMissingAll=after.filter(item=>item.status==='candidate'&&(!Number.isFinite(item.latitude)||!Number.isFinite(item.longitude)));
    const remaining=requestedRegion?afterMissingAll.filter(item=>String(item.region||'').trim().toLowerCase()===requestedRegion.toLowerCase()).length:afterMissingAll.length;
    return NextResponse.json({submitted:locationFallbackCandidates.length,matched:locationFallbackMatched,batchMatched:0,fallbackMatched:0,locationFallbackMatched,locationFallbackAttempted:locationFallbackCandidates.length,unmatched:locationFallbackCandidates.length-locationFallbackMatched,skippedWithoutStreet,skippedNonUs:nonUsMissing.length,remaining,remainingAll:afterMissingAll.length,region:requestedRegion||null,provider:locationFallbackCandidates.length?'OpenStreetMap/Nominatim strict state fallback':'U.S. Census Geocoder (U.S. candidates only)'});
  }

  const lines=candidates.map(item=>[item.id,item.streetAddress||'',item.city||'',item.region||'',''].map(csvEscape).join(','));
  const form=new FormData(); form.set('benchmark','Public_AR_Current'); form.set('addressFile',new Blob([lines.join('\n')],{type:'text/csv'}),'geoweedo-addresses.csv');
  try{
    const response=await fetch('https://geocoding.geo.census.gov/geocoder/locations/addressbatch',{method:'POST',body:form,headers:{'User-Agent':'GeoWeedo/0.8 (https://geoweedo.com)'},cache:'no-store'}); if(!response.ok)throw new Error(`U.S. Census Geocoder returned ${response.status}`);
    const text=await response.text(); const rows=text.split(/\r?\n/).filter(line=>line.trim()); const matchedIds=new Set<string>(); let batchMatched=0;
    for(const line of rows){const fields=parseCsvLine(line); const id=fields[0]?.trim(); if(!id)continue; const status=fields[2]?.trim().toLowerCase(); const coordinates=fields[5]?.trim()||''; const parts=coordinates.split(',').map(value=>Number(value.trim())); const longitude=parts[0],latitude=parts[1]; if(status==='match'&&Number.isFinite(latitude)&&Number.isFinite(longitude)){const item=candidateById.get(id); const matchedAddress=fields[4]||''; const locality=parsedLocality(matchedAddress); await updateCandidate(id,{latitude,longitude,city:item?.city||locality.city||undefined,region:item?.region||locality.region||undefined,imageryStatus:'unchecked',imageryCount:0,imageryCheckedAt:undefined,imageryMessage:`Coordinates matched by U.S. Census batch geocoder: ${matchedAddress||'matched address'}`}); matchedIds.add(id); batchMatched++;}}
    const fallbackPool=candidates.filter(item=>!matchedIds.has(item.id)||!item.city?.trim()); const fallbackCandidates=fallbackPool.slice(0,fallbackLimit); let fallbackMatched=0;
    await runWithConcurrency(fallbackCandidates,5,async item=>{try{const match=await oneLineLookup(item);if(!match)return;await updateCandidate(item.id,{latitude:match.latitude,longitude:match.longitude,city:item.city||match.city||undefined,region:item.region||match.region||undefined,imageryStatus:'unchecked',imageryCount:0,imageryCheckedAt:undefined,imageryMessage:`Coordinates matched by U.S. Census one-line geocoder: ${match.matchedAddress}`});if(!matchedIds.has(item.id))fallbackMatched++;matchedIds.add(item.id);}catch{}});
    const unresolved=candidates.filter(item=>!matchedIds.has(item.id)); for(const item of unresolved){await updateCandidate(item.id,{imageryStatus:'missing_coordinates',imageryMessage:fallbackCandidates.some(candidate=>candidate.id===item.id)?'U.S. Census batch and one-line geocoders did not return an address match; manual review may be required.':'Batch geocoder did not return a match; one-line fallback will be attempted in a later run.'});}
    const after=await listCandidates(); const afterMissingAll=after.filter(item=>item.status==='candidate'&&(!Number.isFinite(item.latitude)||!Number.isFinite(item.longitude))); const remaining=requestedRegion?afterMissingAll.filter(item=>String(item.region||'').trim().toLowerCase()===requestedRegion.toLowerCase()).length:afterMissingAll.length; const matched=batchMatched+fallbackMatched+locationFallbackMatched;
    return NextResponse.json({submitted:candidates.length+locationFallbackCandidates.length,matched,batchMatched,fallbackMatched,locationFallbackMatched,locationFallbackAttempted:locationFallbackCandidates.length,fallbackAttempted:fallbackCandidates.length,unmatched:candidates.length+locationFallbackCandidates.length-matched,skippedWithoutStreet,skippedNonUs:nonUsMissing.length,remaining,remainingAll:afterMissingAll.length,region:requestedRegion||null,provider:locationFallbackCandidates.length?'U.S. Census Geocoder + OpenStreetMap/Nominatim strict state fallback (U.S. only)':'U.S. Census Geocoder (U.S. candidates only)'},{headers:{'Cache-Control':'no-store'}});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Batch geocoding failed.'},{status:502});}
}
