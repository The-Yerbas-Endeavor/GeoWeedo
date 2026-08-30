'use client';

import { useEffect } from 'react';

type MapItem={id:string;name:string;latitude:number;longitude:number};
type PublicDispensary={id:string;name:string;latitude:number;longitude:number};
type Hours=Record<string,string>;

function parseCoordinates(card:Element){
 const text=card.textContent||'';const match=text.match(/(-?\d{1,2}\.\d{3,}),\s*(-?\d{1,3}\.\d{3,})/);if(!match)return null;return{lat:Number(match[1]),lng:Number(match[2])};
}
function distance(a:{lat:number;lng:number},b:{lat:number;lng:number}){return Math.abs(a.lat-b.lat)+Math.abs(a.lng-b.lng);}
function safeWebsite(value?:string){if(!value)return null;return /^https?:\/\//i.test(value)?value:`https://${value}`;}
function stars(value:number){const rounded=Math.round(value);return `${'★'.repeat(rounded)}${'☆'.repeat(Math.max(0,5-rounded))}`;}

const US_TZ:Record<string,string>={
 'California':'America/Los_Angeles','Nevada':'America/Los_Angeles','Washington':'America/Los_Angeles','Oregon':'America/Los_Angeles',
 'Arizona':'America/Phoenix','Colorado':'America/Denver','Montana':'America/Denver','Utah':'America/Denver','New Mexico':'America/Denver','Wyoming':'America/Denver','Idaho':'America/Boise',
 'Texas':'America/Chicago','Oklahoma':'America/Chicago','Kansas':'America/Chicago','Nebraska':'America/Chicago','South Dakota':'America/Chicago','North Dakota':'America/Chicago','Minnesota':'America/Chicago','Iowa':'America/Chicago','Missouri':'America/Chicago','Arkansas':'America/Chicago','Louisiana':'America/Chicago','Wisconsin':'America/Chicago','Illinois':'America/Chicago','Mississippi':'America/Chicago','Alabama':'America/Chicago','Tennessee':'America/Chicago',
 'Michigan':'America/Detroit','Indiana':'America/Indiana/Indianapolis','Kentucky':'America/New_York','Ohio':'America/New_York','Georgia':'America/New_York','Florida':'America/New_York','South Carolina':'America/New_York','North Carolina':'America/New_York','Virginia':'America/New_York','West Virginia':'America/New_York','Pennsylvania':'America/New_York','New York':'America/New_York','New Jersey':'America/New_York','Delaware':'America/New_York','Maryland':'America/New_York','Connecticut':'America/New_York','Rhode Island':'America/New_York','Massachusetts':'America/New_York','Vermont':'America/New_York','New Hampshire':'America/New_York','Maine':'America/New_York','District of Columbia':'America/New_York',
 'Alaska':'America/Anchorage','Hawaii':'Pacific/Honolulu'
};
const CA_TZ:Record<string,string>={
 'British Columbia':'America/Vancouver','Alberta':'America/Edmonton','Saskatchewan':'America/Regina','Manitoba':'America/Winnipeg','Ontario':'America/Toronto','Quebec':'America/Toronto','New Brunswick':'America/Moncton','Nova Scotia':'America/Halifax','Prince Edward Island':'America/Halifax','Newfoundland and Labrador':'America/St_Johns','Yukon':'America/Whitehorse','Northwest Territories':'America/Yellowknife','Nunavut':'America/Iqaluit'
};
function timezoneFor(location:any){const country=String(location.country||'');const region=String(location.region||'');if(/netherlands/i.test(country))return'Europe/Amsterdam';if(/canada/i.test(country))return CA_TZ[region]||null;return US_TZ[region]||null;}
function todayInfo(timeZone:string){const parts=new Intl.DateTimeFormat('en-US',{timeZone,weekday:'long',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(new Date());const weekday=parts.find(p=>p.type==='weekday')?.value||'';const hour=Number(parts.find(p=>p.type==='hour')?.value||0);const minute=Number(parts.find(p=>p.type==='minute')?.value||0);return{weekday,minutes:hour*60+minute};}
function todaysHours(hours:Hours|undefined,weekday:string){if(!hours)return'';const target=weekday.toLowerCase();const key=Object.keys(hours).find(k=>k.toLowerCase()===target||k.toLowerCase().startsWith(target.slice(0,3)));return key?String(hours[key]||'').trim():'';}
function parseClock(value:string){const clean=value.trim().toLowerCase().replace(/\./g,'');const m=clean.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);if(!m)return null;let hour=Number(m[1]),minute=Number(m[2]||0);if(hour>24||minute>59)return null;if(m[3]){if(hour>12)return null;if(m[3]==='am'&&hour===12)hour=0;if(m[3]==='pm'&&hour!==12)hour+=12;}if(hour===24&&minute===0)return 1440;if(hour>23)return null;return hour*60+minute;}
function openState(schedule:string,currentMinutes:number){const normalized=schedule.trim();if(!normalized)return'unknown' as const;if(/closed|unavailable|unknown/i.test(normalized))return'closed' as const;if(/24\s*hours|open\s*24|24\/7/i.test(normalized))return'open' as const;const range=normalized.split(/\s*(?:-|–|—|\bto\b)\s*/i);if(range.length<2)return'unknown' as const;const start=parseClock(range[0]),end=parseClock(range[1]);if(start==null||end==null)return'unknown' as const;if(start===end)return'open' as const;if(end>start)return currentMinutes>=start&&currentMinutes<end?'open':'closed';return currentMinutes>=start||currentMinutes<end?'open':'closed';}
function rewriteInfoRows(card:Element,location:any){
 const rows=Array.from(card.querySelectorAll('dl > div'));const address=[location.streetAddress,location.city,location.region,location.postalCode].filter(Boolean).join(', ');
 const coordRow=rows.find(row=>row.querySelector('dt')?.textContent?.trim()==='Coordinates');const sourceRow=rows.find(row=>row.querySelector('dt')?.textContent?.trim()==='Source');
 if(coordRow){const dt=coordRow.querySelector('dt'),dd=coordRow.querySelector('dd');if(dt)dt.textContent='Address';if(dd)dd.textContent=address||'Address unavailable';}
 if(sourceRow){const dt=sourceRow.querySelector('dt'),dd=sourceRow.querySelector('dd');if(dt)dt.textContent='Hours';if(dd){dd.textContent='';const zone=timezoneFor(location);let schedule='';let state:'open'|'closed'|'unknown'='unknown';if(zone){const local=todayInfo(zone);schedule=todaysHours(location.hours,local.weekday);state=openState(schedule,local.minutes);}const text=document.createElement('span');text.textContent=schedule||'Hours unavailable';dd.appendChild(text);const badge=document.createElement('span');badge.className=`map-hours-badge ${state}`;badge.textContent=state==='open'?'Open':state==='closed'?'Closed':'Hours unavailable';dd.appendChild(badge);}}
}

export default function DispensaryCardEnhancer(){
 useEffect(()=>{
  let disposed=false;let candidates:MapItem[]=[];let approved:PublicDispensary[]=[];const enhanced=new WeakSet<Element>();
  Promise.all([
   fetch('/api/map-candidates',{cache:'no-store'}).then(r=>r.ok?r.json():null).catch(()=>null),
   fetch('/api/dispensaries',{cache:'no-store'}).then(r=>r.ok?r.json():null).catch(()=>null),
  ]).then(([candidateData,dispensaryData])=>{candidates=(candidateData?.candidates||[]).map((i:any)=>({id:String(i.id),name:String(i.name),latitude:Number(i.latitude),longitude:Number(i.longitude)}));approved=(dispensaryData?.dispensaries||[]).map((i:any)=>({id:String(i.id),name:String(i.name),latitude:Number(i.latitude),longitude:Number(i.longitude)}));scan();});
  async function enhance(card:Element){
   if(disposed||enhanced.has(card))return;const coords=parseCoordinates(card);const name=card.querySelector('h3')?.textContent?.trim()||'';if(!coords||!name)return;
   const pool=[...approved,...candidates].filter(i=>i.name===name||i.name.toLowerCase()===name.toLowerCase());const match=(pool.length?pool:[...approved,...candidates]).map(item=>({item,d:distance(coords,{lat:item.latitude,lng:item.longitude})})).filter(x=>x.d<0.003).sort((a,b)=>a.d-b.d)[0]?.item;if(!match)return;
   enhanced.add(card);try{const r=await fetch(`/api/dispensaries/${encodeURIComponent(match.id)}`,{cache:'no-store'});if(!r.ok)return;const data=await r.json();if(disposed||!card.isConnected)return;const location=data.location||{};rewriteInfoRows(card,location);const existing=card.querySelector('.map-community-summary');existing?.remove();const wrap=document.createElement('div');wrap.className='map-community-summary';const rating=document.createElement('div');rating.className='map-community-rating';rating.textContent=data.ratings?.count?`${stars(Number(data.ratings.average||0))} ${Number(data.ratings.average||0).toFixed(1)} · ${data.ratings.count} reviews`:'☆☆☆☆☆ · No reviews yet';wrap.appendChild(rating);if(location.overview){const p=document.createElement('p');p.textContent=String(location.overview).slice(0,220);wrap.appendChild(p);}const contact=document.createElement('div');contact.className='map-community-contact';if(location.phone){const a=document.createElement('a');a.href=`tel:${String(location.phone).replace(/[^+\d]/g,'')}`;a.textContent=`☎ ${location.phone}`;contact.appendChild(a);}const website=safeWebsite(location.website);if(website){const a=document.createElement('a');a.href=website;a.target='_blank';a.rel='noreferrer';a.textContent='↗ Website';contact.appendChild(a);}if(contact.childNodes.length)wrap.appendChild(contact);const link=document.createElement('a');link.className='map-community-profile-link';link.href=`/dispensary/${encodeURIComponent(match.id)}`;link.textContent='View full profile · Reviews · Photos';wrap.appendChild(link);const focusButton=card.querySelector('.map-location-focus');if(focusButton)card.insertBefore(wrap,focusButton);else card.appendChild(wrap);}catch{}
  }
  function scan(){document.querySelectorAll('.map-location-card').forEach(card=>void enhance(card));}
  const observer=new MutationObserver(scan);observer.observe(document.body,{childList:true,subtree:true,characterData:true});scan();return()=>{disposed=true;observer.disconnect();};
 },[]);
 return null;
}
