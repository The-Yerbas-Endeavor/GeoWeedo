'use client';

import {useEffect,useRef} from 'react';

type Candidate={id:string;name:string;latitude?:number;longitude?:number;status?:string};
type Photo={id:string;imageUrl:string;shotDate?:string|null;projection?:string;fieldOfView?:number};

function readInput(panel:HTMLElement,placeholder:string){return (panel.querySelector(`input[placeholder="${placeholder}"]`) as HTMLInputElement|null)?.value?.trim()||'';}
function escapeHtml(value:unknown){return String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]||ch));}
function setInputValue(input:HTMLInputElement,value:string){const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;if(setter)setter.call(input,value);else input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));}
function likelyWesternHemisphere(country:string,region:string){const text=`${country} ${region}`.toLowerCase();return /\b(usa|united states|canada|british columbia|california|colorado|connecticut|delaware|illinois|maine|maryland|massachusetts|minnesota|missouri|montana|nevada|new york|oregon|rhode island|washington)\b/.test(text);}
function validCoordinates(latText:string,lngText:string){
 if(!latText||!lngText)return false;
 const lat=Number(latText),lng=Number(lngText);
 return Number.isFinite(lat)&&Number.isFinite(lng)&&lat>=-90&&lat<=90&&lng>=-180&&lng<=180&&!(lat===0&&lng===0);
}

export default function StateCandidateStreetViewVerifier(){
 const runningRef=useRef(false);
 useEffect(()=>{
  const install=()=>{
   const editor=document.getElementById('state-candidate-edit');
   if(!editor||editor.querySelector('[data-state-candidate-street-view]'))return;
   const mapPanel=editor.querySelector('.state-edit-map-panel') as HTMLElement|null;
   if(!mapPanel)return;
   const host=document.createElement('div');
   host.dataset.stateCandidateStreetView='1';
   host.style.cssText='border-top:1px solid #314137;padding:10px 12px;box-sizing:border-box;min-width:0;overflow:hidden';
   host.innerHTML=`<div style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap"><div style="min-width:0;flex:1 1 250px"><strong style="display:block;font-size:14px;line-height:1.2;margin-bottom:2px">Street View readiness</strong><small style="display:block;color:#a9bbb0;line-height:1.3">Google first · fallback only when Google has no usable Street View.</small></div><button type="button" data-action="load" class="primary" style="flex:0 0 auto;white-space:nowrap;padding:9px 14px">Load Street View</button></div><div data-view style="display:none;margin-top:9px;min-width:0"></div><div data-message style="margin-top:6px;color:#a9bbb0;font-size:11px;line-height:1.35;overflow-wrap:anywhere"></div>`;
   mapPanel.appendChild(host);
   let photos:Photo[]=[];let index=0;let candidateId='';let provider='';
   const message=host.querySelector('[data-message]') as HTMLElement;
   const view=host.querySelector('[data-view]') as HTMLElement;
   const loadButton=host.querySelector('[data-action="load"]') as HTMLButtonElement;
   const render=()=>{
    const photo=photos[index];
    if(!photo){view.style.display='none';return;}
    view.style.display='block';
    const meta=`${escapeHtml(provider)} · ${index+1} / ${photos.length}${photo.shotDate?` · ${escapeHtml(photo.shotDate)}`:''}`;
    const controls=`<span style="display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap"><button type="button" data-action="prev" ${index<=0?'disabled':''}>Previous</button><button type="button" data-action="next" ${index>=photos.length-1?'disabled':''}>Next</button><button type="button" data-action="confirm" class="primary" style="white-space:nowrap">Confirm Street View ready</button></span>`;
    if(provider==='Google Street View'&&photos.length===1){
      view.innerHTML=`<div style="border:1px solid #314137;border-radius:9px;background:#0d130f;padding:8px 9px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center"><span style="font-size:11px;color:#a9bbb0;overflow-wrap:anywhere">${meta}</span>${controls}</div>`;
      return;
    }
    view.innerHTML=`<div style="border:1px solid #314137;border-radius:9px;overflow:hidden;background:#090d0b;min-width:0"><div style="display:flex;justify-content:center;align-items:center;background:#050706;height:180px;overflow:hidden"><img src="${escapeHtml(photo.imageUrl)}" alt="Street View preview" style="display:block;width:100%;height:100%;object-fit:contain;background:#050706"/></div><div style="display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center;padding:7px 8px"><span style="font-size:11px;color:#a9bbb0;line-height:1.3;overflow-wrap:anywhere">${meta}</span>${controls}</div></div>`;
   };
   const showLongitudeWarning=(lng:number)=>{message.innerHTML=`Longitude <strong>${escapeHtml(lng)}</strong> looks wrong for this US/Canada location. It is probably <strong>${escapeHtml(-Math.abs(lng))}</strong>. <button type="button" data-action="fix-longitude" style="margin-left:8px">Fix longitude sign</button>`;};
   host.addEventListener('click',async event=>{
    const button=(event.target as HTMLElement).closest('button[data-action]') as HTMLButtonElement|null;if(!button)return;
    const action=button.dataset.action;
    if(action==='prev'){index=Math.max(0,index-1);render();return;}
    if(action==='next'){index=Math.min(photos.length-1,index+1);render();return;}
    if(action==='fix-longitude'){
     const input=editor.querySelector('input[placeholder="Longitude"]') as HTMLInputElement|null;
     if(!input)return;
     const current=Number(input.value);if(!Number.isFinite(current))return;
     setInputValue(input,String(-Math.abs(current)));
     photos=[];render();message.textContent='Longitude sign corrected. Save candidate details, then load Street View again.';
     return;
    }
    if(runningRef.current)return;
    if(action==='load'){
     const name=readInput(editor,'Dispensary name'),country=readInput(editor,'Country'),region=readInput(editor,'State / region'),latText=readInput(editor,'Latitude'),lngText=readInput(editor,'Longitude');
     if(!name||!validCoordinates(latText,lngText)){photos=[];render();message.textContent='Save valid coordinates first. Street View will not be queried for blank or 0,0 coordinates.';return;}
     const lat=Number(latText),lng=Number(lngText);
     if(likelyWesternHemisphere(country,region)&&lng>0){showLongitudeWarning(lng);return;}
     runningRef.current=true;loadButton.disabled=true;message.textContent='Loading Street View…';
     try{
      const candidatesResponse=await fetch('/api/admin/candidates',{cache:'no-store'});const candidatesData=await candidatesResponse.json();if(!candidatesResponse.ok)throw new Error(candidatesData.error||'Could not load candidate.');
      const candidates=(candidatesData.candidates||[]) as Candidate[];
      const candidate=candidates.find(item=>item.name.trim().toLowerCase()===name.trim().toLowerCase()&&Number.isFinite(Number(item.latitude))&&Number.isFinite(Number(item.longitude))&&Math.abs(Number(item.latitude)-lat)<0.00002&&Math.abs(Number(item.longitude)-lng)<0.00002)||candidates.find(item=>item.name.trim().toLowerCase()===name.trim().toLowerCase()&&item.status!=='approved'&&item.status!=='rejected');
      if(!candidate)throw new Error('Save the candidate first so Street View can be attached to it.');candidateId=candidate.id;
      const response=await fetch(`/api/street-imagery?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}&provider=auto&_=${Date.now()}`,{cache:'no-store'});const data=await response.json();if(!response.ok)throw new Error(data.error||'Street View lookup failed.');
      photos=Array.isArray(data.photos)?data.photos:[];provider=data.provider==='google'?'Google Street View':data.provider==='kartaview'?'Fallback Street View':'Street View';index=Math.min(Math.max(Number(data.initialIndex||0),0),Math.max(photos.length-1,0));
      if(!photos.length)throw new Error('No Street View imagery found at these coordinates. Google was checked first, then fallback coverage. Verify the pin and coordinates, then try again.');
      render();message.textContent=provider==='Google Street View'&&photos.length===1?'Google Street View found. Confirm this panorama for gameplay.':`${provider} found ${photos.length} usable Street View image${photos.length===1?'':'s'}. Select the best starting view and confirm it.`;
     }catch(error){photos=[];render();message.textContent=error instanceof Error?error.message:'Street View lookup failed.';}finally{runningRef.current=false;loadButton.disabled=false;}
     return;
    }
    if(action==='confirm'){
     const photo=photos[index];if(!candidateId||!photo)return;
     runningRef.current=true;button.disabled=true;message.textContent='Confirming Street View readiness…';
     try{
      const response=await fetch('/api/admin/candidates/check-imagery',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:[candidateId],limit:1,source:'enrichment_approved',selectedPhotoId:photo.id})});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||'Street View confirmation failed.');
      const result=Array.isArray(data.results)?data.results[0]:null;if(result?.imageryStatus!=='coverage')throw new Error(result?.imageryMessage||'Street View could not be confirmed for gameplay.');
      message.textContent='Street View confirmed for gameplay. Enable gameplay is ready.';
      window.dispatchEvent(new Event('geoweedo-pipeline-updated'));
     }catch(error){message.textContent=error instanceof Error?error.message:'Street View confirmation failed.';}finally{runningRef.current=false;button.disabled=false;}
    }
   });
  };
  install();const observer=new MutationObserver(install);observer.observe(document.body,{childList:true,subtree:true});return()=>observer.disconnect();
 },[]);
 return null;
}
