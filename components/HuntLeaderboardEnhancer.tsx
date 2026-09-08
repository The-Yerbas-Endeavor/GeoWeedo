'use client';

import {useEffect} from 'react';

export default function HuntLeaderboardEnhancer(){
 useEffect(()=>{
  if(window.location.pathname!=='/hunt')return;
  let observer:MutationObserver|null=null;
  let scheduled=0;
  const leaderboardPath='/leaderboard?game=hunt';
  const leaderboardUrl='https://geoweedo.com/leaderboard?game=hunt';
  const copyText=async(text:string)=>{try{await navigator.clipboard.writeText(text);return true;}catch{}try{const area=document.createElement('textarea');area.value=text;area.style.position='fixed';area.style.opacity='0';document.body.appendChild(area);area.focus();area.select();const ok=document.execCommand('copy');area.remove();return ok;}catch{return false;}};
  const enhance=()=>{
   scheduled=0;
   const final=document.querySelector<HTMLElement>('.weedo-hunt-final');
   const huntAgain=Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(button=>button.textContent?.trim()==='Hunt Again');
   if(!final||!huntAgain)return;
   const statusHost=huntAgain.parentElement;
   if(!statusHost)return;
   if(!statusHost.querySelector('[data-hunt-leaderboard-status]')){
    const status=document.createElement('div');status.dataset.huntLeaderboardStatus='1';status.style.cssText='display:grid;gap:4px;margin:12px 0;padding:12px 13px;border:1px solid rgba(103,214,110,.24);border-radius:11px;background:rgba(103,214,110,.05);';status.innerHTML='<strong style="color:#67d66e">🏆 Weedo Hunt Leaderboard</strong><span style="font-size:12px;color:#cbd5cd">Open the Hunt board to compare scores and earned YERB.</span>';huntAgain.insertAdjacentElement('beforebegin',status);
   }
   if(!statusHost.querySelector('[data-hunt-share-leaderboard]')){
    const button=document.createElement('button');button.type='button';button.dataset.huntShareLeaderboard='1';button.className='secondary full';button.style.marginBottom='8px';button.textContent='Share Result + Leaderboard';button.addEventListener('click',async()=>{
     const scoreText=final.querySelector('strong')?.textContent||'0 points';
     const rewardText=final.querySelector('span')?.textContent||'';
     const targetName=document.querySelector<HTMLElement>('.weedo-hunt-location-info h2')?.textContent?.replace(/^📍\s*/,'').trim()||'';
     const guesses=document.querySelectorAll('.weedo-hunt-guesses > div').length;
     const text=`🌿 Weedo Hunt\n⭐ ${scoreText}${guesses?`\n🎯 ${guesses} guess${guesses===1?'':'es'}`:''}${targetName?`\n📍 ${targetName}`:''}${rewardText?`\n🪙 ${rewardText}`:''}\n🏆 ${leaderboardUrl}\n#GeoWeedo`;
     if(navigator.share){try{await navigator.share({title:'Weedo Hunt',text,url:leaderboardUrl});window.location.href=leaderboardPath;return;}catch(error){if((error as Error)?.name==='AbortError')return;}}
     await copyText(text);window.location.href=leaderboardPath;
    });huntAgain.insertAdjacentElement('beforebegin',button);
   }
  };
  const schedule=()=>{if(scheduled)return;scheduled=window.requestAnimationFrame(enhance);};
  observer=new MutationObserver(schedule);observer.observe(document.body,{childList:true,subtree:true,characterData:true});schedule();
  return()=>{if(scheduled)window.cancelAnimationFrame(scheduled);observer?.disconnect();};
 },[]);
 return null;
}
