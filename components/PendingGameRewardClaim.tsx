'use client';

import { useEffect } from 'react';

const STORAGE_KEY='geoweedo_pending_game_reward_v1';

type PendingGame={
  gameId:string;
  startedAt:string|null;
  scores:number[];
  dispensaryIds:string[];
  potentialYerb:number;
  savedAt:string;
};

function readPending():PendingGame|null{
  try{
    const raw=sessionStorage.getItem(STORAGE_KEY);
    if(!raw)return null;
    const value=JSON.parse(raw) as PendingGame;
    if(!value?.gameId||!Array.isArray(value.scores)||!Array.isArray(value.dispensaryIds))return null;
    return value;
  }catch{return null;}
}

function writePending(value:PendingGame){
  try{sessionStorage.setItem(STORAGE_KEY,JSON.stringify(value));}catch{}
}

function clearPending(){
  try{sessionStorage.removeItem(STORAGE_KEY);}catch{}
}

function formatYerb(value:number){
  return Number(value||0).toFixed(4).replace(/0+$/,'').replace(/\.$/,'');
}

export default function PendingGameRewardClaim(){
  useEffect(()=>{
    const originalFetch=window.fetch.bind(window);
    let claimInFlight=false;
    let modeSelected=false;

    const injectResultOffer=()=>{
      const pending=readPending();
      if(!pending||location.pathname!=='/')return;
      const card=document.querySelector<HTMLElement>('.result-card');
      if(!card||card.querySelector('[data-pending-game-reward]'))return;
      const scoreList=card.querySelector('.score-list');
      if(!scoreList)return;

      const box=document.createElement('div');
      box.dataset.pendingGameReward='true';
      box.className='pending-game-reward';
      box.innerHTML=`<strong>You could have earned ${formatYerb(pending.potentialYerb)} YERB</strong><span>Create an account now to claim this completed game's reward. This offer applies to this game only.</span><a class="primary pending-game-reward-button" href="/account?claimGame=1">Create account & claim ${formatYerb(pending.potentialYerb)} YERB</a>`;
      card.insertBefore(box,scoreList);
    };

    const showAccountClaimStatus=(message:string,ok:boolean)=>{
      const card=document.querySelector<HTMLElement>('.account-card');
      if(!card)return;
      let banner=card.querySelector<HTMLElement>('[data-game-claim-status]');
      if(!banner){banner=document.createElement('div');banner.dataset.gameClaimStatus='true';banner.className=`pending-game-claim-status ${ok?'success':'error'}`;card.prepend(banner);}
      banner.textContent=message;
    };

    const claimIfSignedIn=async()=>{
      if(claimInFlight||location.pathname!=='/account'||new URLSearchParams(location.search).get('claimGame')!=='1')return;
      const pending=readPending();
      if(!pending)return;
      claimInFlight=true;
      try{
        const summary=await originalFetch('/api/account/summary',{cache:'no-store'});
        if(summary.status===401){
          claimInFlight=false;
          if(!modeSelected){
            const buttons=Array.from(document.querySelectorAll<HTMLButtonElement>('.account-card button'));
            const create=buttons.find(button=>/^Create account$/i.test(button.textContent?.trim()||''));
            if(create){modeSelected=true;create.click();}
          }
          return;
        }
        if(!summary.ok)throw new Error('Could not verify your account before claiming this game.');

        const response=await originalFetch('/api/rewards/game',{
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({gameId:pending.gameId,startedAt:pending.startedAt,scores:pending.scores,dispensaryIds:pending.dispensaryIds}),
        });
        const data=await response.json().catch(()=>({}));
        if(!response.ok)throw new Error(data.error||'Could not claim this game reward.');
        clearPending();
        const amount=Number(data.amountYerb||0);
        const status=String(data.status||'');
        const message=status==='pending_review'
          ?`${formatYerb(amount)} YERB from your completed game has been claimed and is pending reward review.`
          :status==='daily_cap_reached'
            ?'Your completed game was claimed, but your daily YERB reward cap has already been reached.'
            :`${formatYerb(amount)} YERB from your completed game is now confirmed on your GeoWeedo account.`;
        showAccountClaimStatus(message,true);
      }catch(error){
        showAccountClaimStatus(error instanceof Error?error.message:'Could not claim this game reward.',false);
      }finally{claimInFlight=false;}
    };

    window.fetch=async(input:RequestInfo|URL,init?:RequestInit)=>{
      const response=await originalFetch(input,init);
      try{
        const url=typeof input==='string'?input:input instanceof URL?input.pathname:input.url;
        if(url.includes('/api/rewards/game')&&response.status===401&&typeof init?.body==='string'){
          const body=JSON.parse(init.body);
          const scores=Array.isArray(body?.scores)?body.scores.map(Number).filter(Number.isFinite):[];
          const dispensaryIds=Array.isArray(body?.dispensaryIds)?body.dispensaryIds.map(String):[];
          if(/^game-[A-Za-z0-9-]{8,80}$/.test(String(body?.gameId||''))&&scores.length&&scores.length===dispensaryIds.length){
            let rate=0.0004,perGameCap=10,enabled=true;
            try{
              const policyResponse=await originalFetch('/api/rewards/policy',{cache:'no-store'});
              const policy=await policyResponse.json();
              enabled=policy.enabled!==false;
              if(Number.isFinite(Number(policy.yerbPerPoint)))rate=Number(policy.yerbPerPoint);
              if(Number.isFinite(Number(policy.perGameCapYerb)))perGameCap=Number(policy.perGameCapYerb);
            }catch{}
            const total=scores.reduce((sum:number,value:number)=>sum+Math.max(0,Math.min(5000,value)),0);
            const potentialYerb=enabled?Number(Math.min(Number((Math.min(25000,total)*rate).toFixed(4)),perGameCap).toFixed(8)):0;
            if(potentialYerb>0){
              writePending({gameId:String(body.gameId),startedAt:typeof body.startedAt==='string'?body.startedAt:null,scores,dispensaryIds,potentialYerb,savedAt:new Date().toISOString()});
              queueMicrotask(injectResultOffer);
            }
          }
        }
      }catch{}
      return response;
    };

    const observer=new MutationObserver(()=>{injectResultOffer();void claimIfSignedIn();});
    observer.observe(document.body,{childList:true,subtree:true});
    injectResultOffer();
    void claimIfSignedIn();

    return()=>{
      window.fetch=originalFetch;
      observer.disconnect();
    };
  },[]);

  return null;
}
