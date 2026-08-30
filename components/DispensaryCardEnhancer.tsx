'use client';

import { useEffect } from 'react';

type MapItem={id:string;name:string;latitude:number;longitude:number};
type PublicDispensary={id:string;name:string;latitude:number;longitude:number};

function parseCoordinates(card:Element){
 const text=card.textContent||'';const match=text.match(/(-?\d{1,2}\.\d{3,}),\s*(-?\d{1,3}\.\d{3,})/);if(!match)return null;return{lat:Number(match[1]),lng:Number(match[2])};
}
function distance(a:{lat:number;lng:number},b:{lat:number;lng:number}){return Math.abs(a.lat-b.lat)+Math.abs(a.lng-b.lng);}
function safeWebsite(value?:string){if(!value)return null;return /^https?:\/\//i.test(value)?value:`https://${value}`;}
function stars(value:number){const rounded=Math.round(value);return `${'★'.repeat(rounded)}${'☆'.repeat(Math.max(0,5-rounded))}`;}

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
   enhanced.add(card);try{const r=await fetch(`/api/dispensaries/${encodeURIComponent(match.id)}`,{cache:'no-store'});if(!r.ok)return;const data=await r.json();if(disposed||!card.isConnected)return;const existing=card.querySelector('.map-community-summary');existing?.remove();const wrap=document.createElement('div');wrap.className='map-community-summary';const rating=document.createElement('div');rating.className='map-community-rating';rating.textContent=data.ratings?.count?`${stars(Number(data.ratings.average||0))} ${Number(data.ratings.average||0).toFixed(1)} · ${data.ratings.count} reviews`:'☆☆☆☆☆ · No reviews yet';wrap.appendChild(rating);const location=data.location||{};if(location.overview){const p=document.createElement('p');p.textContent=String(location.overview).slice(0,220);wrap.appendChild(p);}const contact=document.createElement('div');contact.className='map-community-contact';const address=[location.streetAddress,location.city,location.region,location.postalCode].filter(Boolean).join(', ');if(address){const span=document.createElement('span');span.textContent=`📍 ${address}`;contact.appendChild(span);}if(location.phone){const a=document.createElement('a');a.href=`tel:${String(location.phone).replace(/[^+\d]/g,'')}`;a.textContent=`☎ ${location.phone}`;contact.appendChild(a);}const website=safeWebsite(location.website);if(website){const a=document.createElement('a');a.href=website;a.target='_blank';a.rel='noreferrer';a.textContent='↗ Website';contact.appendChild(a);}if(contact.childNodes.length)wrap.appendChild(contact);const link=document.createElement('a');link.className='map-community-profile-link';link.href=`/dispensary/${encodeURIComponent(match.id)}`;link.textContent='View full profile · Reviews · Photos';wrap.appendChild(link);const focusButton=card.querySelector('.map-location-focus');if(focusButton)card.insertBefore(wrap,focusButton);else card.appendChild(wrap);}catch{}
  }
  function scan(){document.querySelectorAll('.map-location-card').forEach(card=>void enhance(card));}
  const observer=new MutationObserver(scan);observer.observe(document.body,{childList:true,subtree:true,characterData:true});scan();return()=>{disposed=true;observer.disconnect();};
 },[]);
 return null;
}
