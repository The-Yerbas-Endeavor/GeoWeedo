'use client';

import { useEffect } from 'react';

type RecordKind='dispensary'|'candidate';
type MapItem={id:string;kind:RecordKind;name:string;city:string;region:string;latitude:number;longitude:number};
type Hours=Record<string,string>;

function parseCoordinates(card:Element){const text=card.textContent||'';const match=text.match(/(-?\d{1,2}\.\d{3,}),\s*(-?\d{1,3}\.\d{3,})/);if(!match)return null;return{lat:Number(match[1]),lng:Number(match[2])};}
function distance(a:{lat:number;lng:number},b:{lat:number;lng:number}){return Math.abs(a.lat-b.lat)+Math.abs(a.lng-b.lng);}
function norm(v:unknown){return String(v||'').trim().toLowerCase();}
function safeWebsite(value?:string){if(!value)return null;return /^https?:\/\//i.test(value)?value:`https://${value}`;}
function stars(value:number){const rounded=Math.round(value);return `${'★'.repeat(rounded)}${'☆'.repeat(Math.max(0,5-rounded))}`;}

const US_TZ:Record<string,string>={'California':'America/Los_Angeles','Nevada':'America/Los_Angeles','Washington':'America/Los_Angeles','Oregon':'America/Los_Angeles','Arizona':'America/Phoenix','Colorado':'America/Denver','Montana':'America/Denver','Utah':'America/Denver','New Mexico':'America/Denver','Wyoming':'America/Denver','Idaho':'America/Boise','Texas':'America/Chicago','Oklahoma':'America/Chicago','Kansas':'America/Chicago','Nebraska':'America/Chicago','South Dakota':'America/Chicago','North Dakota':'America/Chicago','Minnesota':'America/Chicago','Iowa':'America/Chicago','Missouri':'America/Chicago','Arkansas':'America/Chicago','Louisiana':'America/Chicago','Wisconsin':'America/Chicago','Illinois':'America/Chicago','Mississippi':'America/Chicago','Alabama':'America/Chicago','Tennessee':'America/Chicago','Michigan':'America/Detroit','Indiana':'America/Indiana/Indianapolis','Kentucky':'America/New_York','Ohio':'America/New_York','Georgia':'America/New_York','Florida':'America/New_York','South Carolina':'America/New_York','North Carolina':'America/New_York','Virginia':'America/New_York','West Virginia':'America/New_York','Pennsylvania':'America/New_York','New York':'America/New_York','New Jersey':'America/New_York','Delaware':'America/New_York','Maryland':'America/New_York','Connecticut':'America/New_York','Rhode Island':'America/New_York','Massachusetts':'America/New_York','Vermont':'America/New_York','New Hampshire':'America/New_York','Maine':'America/New_York','District of Columbia':'America/New_York','Alaska':'America/Anchorage','Hawaii':'Pacific/Honolulu'};
const CA_TZ:Record<string,string>={'British Columbia':'America/Vancouver','Alberta':'America/Edmonton','Saskatchewan':'America/Regina','Manitoba':'America/Winnipeg','Ontario':'America/Toronto','Quebec':'America/Toronto','New Brunswick':'America/Moncton','Nova Scotia':'America/Halifax','Prince Edward Island':'America/Halifax','Newfoundland and Labrador':'America/St_Johns','Yukon':'America/Whitehorse','Northwest Territories':'America/Yellowknife','Nunavut':'America/Iqaluit'};
function timezoneFor(location:any){const country=String(location.country||''),region=String(location.region||'');if(/netherlands/i.test(country))return'Europe/Amsterdam';if(/canada/i.test(country))return CA_TZ[region]||null;return US_TZ[region]||null;}
function todayInfo(timeZone:string){const parts=new Intl.DateTimeFormat('en-US',{timeZone,weekday:'long',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date());const weekday=parts.find(p=>p.type==='weekday')?.value||'',hour=Number(parts.find(p=>p.type==='hour')?.value||0),minute=Number(parts.find(p=>p.type==='minute')?.value||0);return{weekday,minutes:hour*60+minute};}
function todaysHours(hours:Hours|undefined,weekday:string){if(!hours)return'';const target=weekday.toLowerCase();const key=Object.keys(hours).find(k=>k.toLowerCase()===target||k.toLowerCase().startsWith(target.slice(0,3)));return key?String(hours[key]||'').trim():'';}
function parseClock(value:string){const clean=value.trim().toLowerCase().replace(/\./g,''),m=clean.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);if(!m)return null;let hour=Number(m[1]),minute=Number(m[2]||0);if(hour>24||minute>59)return null;if(m[3]){if(hour>12)return null;if(m[3]==='am'&&hour===12)hour=0;if(m[3]==='pm'&&hour!==12)hour+=12;}if(hour===24&&minute===0)return 1440;if(hour>23)return null;return hour*60+minute;}
function openState(schedule:string,currentMinutes:number){const normalized=schedule.trim();if(!normalized)return'unknown' as const;if(/closed/i.test(normalized))return'closed' as const;if(/24\s*hours|open\s*24|24\/7/i.test(normalized))return'open' as const;const range=normalized.split(/\s*(?:-|–|—|\bto\b)\s*/i);if(range.length<2)return'unknown' as const;const start=parseClock(range[0]),end=parseClock(range[1]);if(start==null||end==null)return'unknown' as const;if(start===end)return'open' as const;if(end>start)return currentMinutes>=start&&currentMinutes<end?'open':'closed';return currentMinutes>=start||currentMinutes<end?'open':'closed';}
function ensureInfoRow(dl:Element,label:string,reuseLabel?:string){let row=Array.from(dl.querySelectorAll(':scope > div')).find(item=>item.querySelector('dt')?.textContent?.trim()===label);if(!row&&reuseLabel)row=Array.from(dl.querySelectorAll(':scope > div')).find(item=>item.querySelector('dt')?.textContent?.trim()===reuseLabel);if(!row){row=document.createElement('div');row.append(document.createElement('dt'),document.createElement('dd'));const gameplay=Array.from(dl.querySelectorAll(':scope > div')).find(item=>item.querySelector('dt')?.textContent?.trim()==='Gameplay');if(gameplay)dl.insertBefore(row,gameplay);else dl.appendChild(row);}const dt=row.querySelector('dt');if(dt)dt.textContent=label;return row;}
function rewriteInfoRows(card:Element,location:any){const dl=card.querySelector('dl');if(!dl)return;const address=[location.streetAddress,location.city,location.region,location.postalCode].filter(Boolean).join(', ');const addressRow=ensureInfoRow(dl,'Address','Coordinates'),addressDd=addressRow.querySelector('dd');if(addressDd)addressDd.textContent=address||'Address unavailable';const hoursRow=ensureInfoRow(dl,'Hours','Source'),hoursDd=hoursRow.querySelector('dd');if(hoursDd){hoursDd.textContent='';const zone=timezoneFor(location);let schedule='',state:'open'|'closed'|'unknown'='unknown';if(zone){const local=todayInfo(zone);schedule=todaysHours(location.hours,local.weekday);state=openState(schedule,local.minutes);}const text=document.createElement('span');text.textContent=schedule||'Hours unavailable';hoursDd.appendChild(text);const badge=document.createElement('span');badge.className=`map-hours-badge ${state}`;badge.textContent=state==='open'?'Open':state==='closed'?'Closed':'Hours unavailable';hoursDd.appendChild(badge);}}

function resolveCard(card:HTMLElement,pool:MapItem[]){
 const name=norm(card.querySelector('h3')?.textContent),subtitle=norm(card.querySelector(':scope > p')?.textContent),coords=parseCoordinates(card);
 if(!name)return null;
 const selectedId=String(card.dataset.locationId||'');const selectedLat=Number(card.dataset.locationLat),selectedLng=Number(card.dataset.locationLng);
 if(selectedId&&Number.isFinite(selectedLat)&&Number.isFinite(selectedLng)){
  const exact=pool.filter(item=>item.id===selectedId).map(item=>({item,d:distance({lat:selectedLat,lng:selectedLng},{lat:item.latitude,lng:item.longitude})})).sort((a,b)=>a.d-b.d)[0];
  if(exact&&exact.d<0.003)return exact.item;
 }
 let matches=pool.filter(item=>norm(item.name)===name);
 if(subtitle){const contextual=matches.filter(item=>(!item.city||subtitle.includes(norm(item.city)))&&(!item.region||subtitle.includes(norm(item.region))));if(contextual.length)matches=contextual;}
 if(coords&&matches.length){return matches.map(item=>({item,d:distance(coords,{lat:item.latitude,lng:item.longitude})})).sort((a,b)=>a.d-b.d)[0]?.item||null;}
 if(matches.length===1)return matches[0];
 const previousId=card.dataset.locationId,previousKind=card.dataset.locationKind as RecordKind|undefined;if(previousId&&previousKind){const previous=matches.find(item=>item.id===previousId&&item.kind===previousKind);if(previous)return previous;}
 return null;
}

export default function DispensaryCardEnhancer(){
 useEffect(()=>{
  let disposed=false;let pool:MapItem[]=[];
  Promise.all([fetch('/api/map-candidates',{cache:'no-store'}).then(r=>r.ok?r.json():null).catch(()=>null),fetch('/api/dispensaries',{cache:'no-store'}).then(r=>r.ok?r.json():null).catch(()=>null)]).then(([candidateData,dispensaryData])=>{
   const candidates:MapItem[]=(candidateData?.candidates||[]).map((i:any)=>({id:String(i.id),kind:'candidate',name:String(i.name),city:String(i.city||''),region:String(i.region||''),latitude:Number(i.latitude),longitude:Number(i.longitude)}));
   const approved:MapItem[]=(dispensaryData?.dispensaries||[]).map((i:any)=>({id:String(i.id),kind:'dispensary',name:String(i.name),city:String(i.city||''),region:String(i.region||''),latitude:Number(i.latitude),longitude:Number(i.longitude)}));
   pool=[...approved,...candidates];scan();
  });
  async function enhance(card:HTMLElement){
   if(disposed)return;const match=resolveCard(card,pool);if(!match)return;const identity=`${match.kind}:${match.id}:${match.latitude.toFixed(6)}:${match.longitude.toFixed(6)}`;if(card.dataset.enhancedIdentity===identity&&card.querySelector('.map-community-summary'))return;
   card.dataset.locationId=match.id;card.dataset.locationKind=match.kind;card.dataset.locationLat=String(match.latitude);card.dataset.locationLng=String(match.longitude);card.dataset.pendingIdentity=identity;
   try{
    const r=await fetch(`/api/dispensaries/${encodeURIComponent(match.id)}?kind=${match.kind}`,{cache:'no-store'});if(!r.ok)return;const data=await r.json();if(disposed||!card.isConnected||card.dataset.pendingIdentity!==identity)return;
    const heading=norm(card.querySelector('h3')?.textContent),subtitle=norm(card.querySelector(':scope > p')?.textContent);if(heading!==norm(match.name)||(match.city&&subtitle&&!subtitle.includes(norm(match.city))))return;
    const location=data.location||{};const returnedKind=String(location.kind||'');if(returnedKind&&returnedKind!==match.kind)return;
    const returnedLat=Number(location.latitude),returnedLng=Number(location.longitude);if(Number.isFinite(returnedLat)&&Number.isFinite(returnedLng)&&distance({lat:returnedLat,lng:returnedLng},{lat:match.latitude,lng:match.longitude})>0.003)return;
    card.dataset.enhancedIdentity=identity;rewriteInfoRows(card,location);card.querySelector('.map-community-summary')?.remove();const wrap=document.createElement('div');wrap.className='map-community-summary';wrap.dataset.locationIdentity=identity;const rating=document.createElement('div');rating.className='map-community-rating';rating.textContent=data.ratings?.count?`${stars(Number(data.ratings.average||0))} ${Number(data.ratings.average||0).toFixed(1)} · ${data.ratings.count} reviews`:'☆☆☆☆☆ · No reviews yet';wrap.appendChild(rating);if(location.overview){const p=document.createElement('p');p.textContent=String(location.overview).slice(0,220);wrap.appendChild(p);}const contact=document.createElement('div');contact.className='map-community-contact';if(location.phone){const a=document.createElement('a');a.href=`tel:${String(location.phone).replace(/[^+\d]/g,'')}`;a.textContent=`☎ ${location.phone}`;contact.appendChild(a);}const website=safeWebsite(location.website);if(website){const a=document.createElement('a');a.href=website;a.target='_blank';a.rel='noreferrer';a.textContent='↗ Website';contact.appendChild(a);}if(contact.childNodes.length)wrap.appendChild(contact);const link=document.createElement('a');link.className='map-community-profile-link';link.href=`/dispensary/${encodeURIComponent(match.id)}?kind=${match.kind}`;link.textContent='View full profile · Reviews · Photos';wrap.appendChild(link);const focusButton=card.querySelector('.map-location-focus');if(focusButton)card.insertBefore(wrap,focusButton);else card.appendChild(wrap);
   }catch{}
  }
  function scan(){document.querySelectorAll<HTMLElement>('.map-location-card').forEach(card=>void enhance(card));}
  const observer=new MutationObserver(scan);observer.observe(document.body,{childList:true,subtree:true,characterData:true});scan();return()=>{disposed=true;observer.disconnect();};
 },[]);
 return null;
}
