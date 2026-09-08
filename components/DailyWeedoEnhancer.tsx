'use client';

import {useEffect} from 'react';

function dateKey(){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}

export default function DailyWeedoEnhancer(){
 useEffect(()=>{
  if(window.location.pathname!=='/daily')return;
  const leaderboardUrl='https://geoweedo.com/leaderboard?game=daily';
  const copyText=async(text:string)=>{try{await navigator.clipboard.writeText(text);return true;}catch{}try{const area=document.createElement('textarea');area.value=text;area.style.position='fixed';area.style.opacity='0';document.body.appendChild(area);area.focus();area.select();const ok=document.execCommand('copy');area.remove();return ok;}catch{return false;}};
  const handleClick=async(event:Event)=>{const target=event.target as HTMLElement|null;const button=target?.closest('button');if(!button||button.textContent?.trim()!=='Share Daily Result')return;event.preventDefault();event.stopImmediatePropagation();const today=dateKey();let saved:any=null;try{saved=JSON.parse(localStorage.getItem(`geoweedo-daily-${today}`)||'null');}catch{}const score=Number(saved?.score||0),distanceKm=Number(saved?.distanceKm||0),miles=distanceKm*.621371;const rewardText=Array.from(document.querySelectorAll('.daily-weedo-reward strong')).map(item=>item.textContent||'').find(Boolean)||'';const text=`🌎 Daily Weedo ${today}\n📍 ${miles<.1?`${Math.round(miles*5280)} ft`:`${miles.toFixed(1)} mi`}\n⭐ ${score.toLocaleString()} / 5,000${rewardText?`\n🪙 ${rewardText.replace(/^Reward earned:\s*/i,'')}`:''}\n🏆 ${leaderboardUrl}\n#GeoWeedo`;
   if(navigator.share){try{await navigator.share({title:'Daily Weedo',text,url:leaderboardUrl});window.location.href='/leaderboard?game=daily';return;}catch(error){if((error as Error)?.name==='AbortError')return;}}
   await copyText(text);window.location.href='/leaderboard?game=daily';
  };
  document.addEventListener('click',handleClick,true);
  return()=>document.removeEventListener('click',handleClick,true);
 },[]);
 return null;
}
