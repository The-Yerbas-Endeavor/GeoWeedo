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
 const pathname=usePathname(),game=useMemo(()=>gameForPath(pathname),[pathname]);
 const[data,setData]=useState<CampaignPayload|null>(null),[hidden,setHidden]=useState(false);
 useEffect(()=>{setHidden(false);setData(null);if(!game)return;let alive=true;fetch(`/api/sponsorship/campaign?game=${game}`,{cache:'no-store'}).then(r=>r.ok?r.json():Promise.reject()).then(payload=>{if(alive)setData(payload?.campaign||null);}).catch(()=>{});return()=>{alive=false;};},[game]);
 useEffect(()=>{
  if(!data?.campaign?.id)return;
  const campaignId=data.campaign.id,impressionKey=`geoweedo-game-campaign-impression:${campaignId}`;
  if(!sessionStorage.getItem(impressionKey)){
   sessionStorage.setItem(impressionKey,'1');
   void fetch('/api/sponsorship/campaign',{method:'POST',headers:{'Content-Type':'application/json'},keepalive:true,body:JSON.stringify({campaignId,eventType:'game_impression',metadata:{surface:'presented_by',path:pathname}})}).catch(()=>{});
  }
  const completionKey=`geoweedo-game-campaign-completed:${campaignId}`;
  const detect=()=>{
   if(sessionStorage.getItem(completionKey))return;
   const text=document.body?.innerText||'';
   const completed=data.campaign.gameType==='classic'?text.includes('GAME COMPLETE'):data.campaign.gameType==='daily'?/View Location|DAILY.*COMPLETE|DAILY RESULT/i.test(text):/TARGET REVEALED|FOUND IT|HUNT OVER/i.test(text);
   if(!completed)return;
   sessionStorage.setItem(completionKey,'1');
   void fetch('/api/sponsorship/campaign',{method:'POST',headers:{'Content-Type':'application/json'},keepalive:true,body:JSON.stringify({campaignId,eventType:'game_completed',metadata:{surface:'game',path:pathname}})}).catch(()=>{});
  };
  const observer=new MutationObserver(detect);observer.observe(document.body,{childList:true,subtree:true,characterData:true});detect();return()=>observer.disconnect();
 },[data,pathname]);
 if(!game||!data||hidden)return null;
 const {campaign,sponsor}=data,geo=campaign.geographyType==='all'?'All players':campaign.geographyType==='radius'?`${campaign.radiusKm||''} km radius`:campaign.geographyValue||campaign.geographyType;
 const event=(eventType:'listing_view'|'website_click')=>{void fetch('/api/sponsorship/campaign',{method:'POST',headers:{'Content-Type':'application/json'},keepalive:true,body:JSON.stringify({campaignId:campaign.id,eventType,metadata:{surface:'presented_by',path:pathname}})}).catch(()=>{});};
 return <aside aria-label={`${gameName(game)} sponsor`} style={{position:'fixed',right:18,bottom:18,zIndex:40,width:'min(360px,calc(100vw - 36px))',border:'1px solid rgba(245,196,81,.34)',borderRadius:16,background:'rgba(8,13,9,.96)',boxShadow:'0 18px 55px rgba(0,0,0,.42)',backdropFilter:'blur(12px)',padding:14,color:'#f4f7f4'}}>
  <button type="button" aria-label="Hide sponsor" onClick={()=>setHidden(true)} style={{position:'absolute',right:8,top:8,width:28,height:28,border:0,borderRadius:999,background:'rgba(255,255,255,.06)',color:'#d7dfd9',cursor:'pointer'}}>×</button>
  <div style={{color:'#f5c451',fontSize:9,fontWeight:900,letterSpacing:'.14em',paddingRight:30}}>{game==='hunt'?'SPONSORED WEEDO HUNT':`${gameName(game).toUpperCase()} · PRESENTED BY`}</div>
  <div style={{display:'flex',alignItems:'center',gap:12,marginTop:9}}>{sponsor.logo&&<img src={sponsor.logo} alt="" style={{width:52,height:52,objectFit:'contain',borderRadius:10,border:'1px solid rgba(103,214,110,.28)'}}/>}<div style={{minWidth:0}}><strong style={{display:'block',fontSize:16,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{campaign.title||sponsor.name}</strong><small style={{color:'#9aa69d'}}>{[sponsor.city,sponsor.region].filter(Boolean).join(', ')} · {geo}</small></div></div>
  <div style={{display:'flex',gap:8,marginTop:11}}><a href={sponsor.profileHref} onClick={()=>event('listing_view')} style={{flex:1,textAlign:'center',textDecoration:'none',padding:'9px 10px',borderRadius:9,background:'#67d66e',color:'#071108',fontWeight:800,fontSize:12}}>View sponsor</a>{sponsor.website&&<a href={sponsor.website} target="_blank" rel="noreferrer" onClick={()=>event('website_click')} style={{flex:1,textAlign:'center',textDecoration:'none',padding:'9px 10px',borderRadius:9,border:'1px solid rgba(255,255,255,.14)',color:'#f4f7f4',fontWeight:800,fontSize:12}}>Website ↗</a>}</div>
  <small style={{display:'block',marginTop:8,color:'#7f8a82',fontSize:9}}>Sponsor placement never changes mystery-location odds.</small>
 </aside>;
}
