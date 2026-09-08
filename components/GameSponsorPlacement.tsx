'use client';

import {useEffect,useMemo,useState} from 'react';
import {usePathname} from 'next/navigation';

type Game='classic'|'daily'|'hunt';
type CampaignPayload={campaign:{id:string;gameType:Game;placement:string;geographyType:string;geographyValue:string|null;radiusKm:number|null;startsAt:string;endsAt:string;title:string|null};sponsor:{id:string;name:string;city?:string;region?:string;country?:string;website?:string|null;logo?:string|null;profileHref:string}};

function gameForPath(pathname:string):Game|null{
 if(pathname==='/')return 'classic';
 if(pathname.startsWith('/daily'))return 'daily';
 if(pathname.startsWith('/hunt'))return 'hunt';
 return null;
}
function gameName(game:Game){return game==='classic'?'Classic GeoWeedo':game==='daily'?'Daily Weedo':'Weedo Hunt';}

export default function GameSponsorPlacement(){
 const pathname=usePathname(),routeGame=useMemo(()=>gameForPath(pathname),[pathname]);
 const[classicActive,setClassicActive]=useState(false);
 const game=routeGame==='classic'?(classicActive?'classic':null):routeGame;
 const[data,setData]=useState<CampaignPayload|null>(null),[hidden,setHidden]=useState(false),[completed,setCompleted]=useState(false);

 useEffect(()=>{
  if(pathname!=='/'){
   setClassicActive(false);
   return;
  }
  const detect=()=>setClassicActive(!document.querySelector('.map-first-home'));
  const observer=new MutationObserver(detect);
  observer.observe(document.body,{childList:true,subtree:true});
  detect();
  return()=>observer.disconnect();
 },[pathname]);

 useEffect(()=>{setHidden(false);setCompleted(false);setData(null);if(!game)return;let alive=true;fetch(`/api/sponsorship/campaign?game=${game}`,{cache:'no-store'}).then(r=>r.ok?r.json():Promise.reject()).then(payload=>{if(alive)setData(payload?.campaign||null);}).catch(()=>{});return()=>{alive=false;};},[game]);
 useEffect(()=>{
  if(!game||!data?.campaign?.id)return;
  const campaignId=data.campaign.id,impressionKey=`geoweedo-game-campaign-impression:${campaignId}`;
  if(!sessionStorage.getItem(impressionKey)){
   sessionStorage.setItem(impressionKey,'1');
   void fetch('/api/sponsorship/campaign',{method:'POST',headers:{'Content-Type':'application/json'},keepalive:true,body:JSON.stringify({campaignId,eventType:'game_impression',metadata:{surface:'presented_by',path:pathname}})}).catch(()=>{});
  }
  const completionKey=`geoweedo-game-campaign-completed:${campaignId}`;
  const detect=()=>{
   const text=document.body?.innerText||'';
   const isCompleted=data.campaign.gameType==='classic'?text.includes('GAME COMPLETE'):data.campaign.gameType==='daily'?/View Location|DAILY.*COMPLETE|DAILY RESULT/i.test(text):/TARGET REVEALED|FOUND IT|HUNT OVER/i.test(text);
   setCompleted(isCompleted);
   if(sessionStorage.getItem(completionKey)||!isCompleted)return;
   sessionStorage.setItem(completionKey,'1');
   void fetch('/api/sponsorship/campaign',{method:'POST',headers:{'Content-Type':'application/json'},keepalive:true,body:JSON.stringify({campaignId,eventType:'game_completed',metadata:{surface:'game',path:pathname}})}).catch(()=>{});
  };
  const observer=new MutationObserver(detect);observer.observe(document.body,{childList:true,subtree:true,characterData:true});detect();return()=>observer.disconnect();
 },[game,data,pathname]);
 if(!game||!data||hidden)return null;
 const {campaign,sponsor}=data,geo=campaign.geographyType==='all'?'All players':campaign.geographyType==='radius'?`${campaign.radiusKm||''} km radius`:campaign.geographyValue||campaign.geographyType;
 const event=(eventType:'listing_view'|'website_click')=>{void fetch('/api/sponsorship/campaign',{method:'POST',headers:{'Content-Type':'application/json'},keepalive:true,body:JSON.stringify({campaignId:campaign.id,eventType,metadata:{surface:'presented_by',path:pathname}})}).catch(()=>{});};

 if(game==='classic'){
  return <aside aria-label="Classic GeoWeedo sponsor" style={{position:'fixed',left:'50%',top:112,transform:'translateX(-50%)',zIndex:70,width:'min(760px,calc(100vw - 28px))',border:'1px solid rgba(245,196,81,.46)',borderRadius:18,background:'linear-gradient(135deg,rgba(8,13,9,.98),rgba(14,24,14,.97))',boxShadow:'0 20px 65px rgba(0,0,0,.48),0 0 0 1px rgba(103,214,110,.08) inset',backdropFilter:'blur(14px)',padding:'14px 16px',color:'#f4f7f4'}}>
   <button type="button" aria-label="Hide sponsor" onClick={()=>setHidden(true)} style={{position:'absolute',right:10,top:10,width:28,height:28,border:0,borderRadius:999,background:'rgba(255,255,255,.07)',color:'#d7dfd9',cursor:'pointer'}}>×</button>
   <div style={{display:'flex',alignItems:'center',gap:14,paddingRight:34,flexWrap:'wrap'}}>
    {sponsor.logo&&<img src={sponsor.logo} alt="" style={{width:62,height:62,objectFit:'contain',borderRadius:12,border:'1px solid rgba(103,214,110,.32)',background:'rgba(255,255,255,.02)'}}/>}
    <div style={{flex:'1 1 260px',minWidth:0}}>
     <div style={{color:'#f5c451',fontSize:10,fontWeight:900,letterSpacing:'.15em'}}>🎮 CLASSIC GEOWEEDO · PRESENTED BY</div>
     <strong style={{display:'block',fontSize:20,marginTop:4,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{campaign.title||sponsor.name}</strong>
     <small style={{display:'block',color:'#9aa69d',marginTop:3}}>{[sponsor.city,sponsor.region].filter(Boolean).join(', ')} · {geo}</small>
     <small style={{display:'block',color:'#7f8a82',marginTop:4,fontSize:10}}>Sponsor visibility only — mystery-location odds remain unchanged.</small>
    </div>
    <div style={{display:'flex',gap:8,flex:'0 0 auto'}}>
     <a href={sponsor.profileHref} onClick={()=>event('listing_view')} style={{textAlign:'center',textDecoration:'none',padding:'10px 13px',borderRadius:9,background:'#67d66e',color:'#071108',fontWeight:900,fontSize:12}}>View sponsor</a>
     {sponsor.website&&<a href={sponsor.website} target="_blank" rel="noreferrer" onClick={()=>event('website_click')} style={{textAlign:'center',textDecoration:'none',padding:'10px 13px',borderRadius:9,border:'1px solid rgba(255,255,255,.16)',color:'#f4f7f4',fontWeight:800,fontSize:12}}>Website ↗</a>}
    </div>
   </div>
   {completed&&<div style={{marginTop:10,paddingTop:10,borderTop:'1px solid rgba(255,255,255,.08)',fontSize:12,color:'#c9d2cb'}}><b style={{color:'#f5c451'}}>Game complete.</b> Thanks to {sponsor.name} for sponsoring this Classic GeoWeedo session.</div>}
  </aside>;
 }

 return <aside aria-label={`${gameName(game)} sponsor`} style={{position:'fixed',right:18,bottom:18,zIndex:40,width:'min(360px,calc(100vw - 36px))',border:'1px solid rgba(245,196,81,.34)',borderRadius:16,background:'rgba(8,13,9,.96)',boxShadow:'0 18px 55px rgba(0,0,0,.42)',backdropFilter:'blur(12px)',padding:14,color:'#f4f7f4'}}>
  <button type="button" aria-label="Hide sponsor" onClick={()=>setHidden(true)} style={{position:'absolute',right:8,top:8,width:28,height:28,border:0,borderRadius:999,background:'rgba(255,255,255,.06)',color:'#d7dfd9',cursor:'pointer'}}>×</button>
  <div style={{color:'#f5c451',fontSize:9,fontWeight:900,letterSpacing:'.14em',paddingRight:30}}>{game==='hunt'?'SPONSORED WEEDO HUNT':`${gameName(game).toUpperCase()} · PRESENTED BY`}</div>
  <div style={{display:'flex',alignItems:'center',gap:12,marginTop:9}}>{sponsor.logo&&<img src={sponsor.logo} alt="" style={{width:52,height:52,objectFit:'contain',borderRadius:10,border:'1px solid rgba(103,214,110,.28)'}}/>}<div style={{minWidth:0}}><strong style={{display:'block',fontSize:16,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{campaign.title||sponsor.name}</strong><small style={{color:'#9aa69d'}}>{[sponsor.city,sponsor.region].filter(Boolean).join(', ')} · {geo}</small></div></div>
  <div style={{display:'flex',gap:8,marginTop:11}}><a href={sponsor.profileHref} onClick={()=>event('listing_view')} style={{flex:1,textAlign:'center',textDecoration:'none',padding:'9px 10px',borderRadius:9,background:'#67d66e',color:'#071108',fontWeight:800,fontSize:12}}>View sponsor</a>{sponsor.website&&<a href={sponsor.website} target="_blank" rel="noreferrer" onClick={()=>event('website_click')} style={{flex:1,textAlign:'center',textDecoration:'none',padding:'9px 10px',borderRadius:9,border:'1px solid rgba(255,255,255,.14)',color:'#f4f7f4',fontWeight:800,fontSize:12}}>Website ↗</a>}</div>
  <small style={{display:'block',marginTop:8,color:'#7f8a82',fontSize:9}}>Sponsor placement never changes mystery-location odds.</small>
 </aside>;
}
