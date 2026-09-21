'use client';

import {useEffect,useMemo,useState} from 'react';
import {DISPENSARY_LICENSE_TYPES} from '@/lib/licenseTypes';
import DispensaryLogoUploader from '@/components/DispensaryLogoUploader';
import AdminCoordinateMap from '@/components/AdminCoordinateMap';

const DAYS=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const STATE_ALIASES:Record<string,string>={CA:'California',CALIFORNIA:'California',CO:'Colorado',COLORADO:'Colorado',CT:'Connecticut',CONNECTICUT:'Connecticut',IL:'Illinois',ILLINOIS:'Illinois',MA:'Massachusetts',MASSACHUSETTS:'Massachusetts',MT:'Montana',MONTANA:'Montana',NV:'Nevada',NEVADA:'Nevada',NY:'New York','NEW YORK':'New York','NEW YORK STATE':'New York',OR:'Oregon',OREGON:'Oregon',WA:'Washington',WASHINGTON:'Washington','WASHINGTON STATE':'Washington'};

type ProfileVerification={lastVerifiedAt?:string|null;nextAuditAt?:string|null};
type Row={
  id:string;kind:'dispensary'|'candidate';name:string;street_address?:string;city?:string;region?:string;postal_code?:string;country?:string;
  latitude?:number|null;longitude?:number|null;website?:string;phone?:string;license_number?:string;license_status?:string;license_type?:string;
  license_types?:string[];data_source?:string;source_url?:string;source_license?:string;recreational?:number;medical?:number;verified?:number;
  gameplay_enabled?:number;active?:number;status?:string;imagery_status?:string;imagery_count?:number|null;imagery_message?:string;imagery_provider?:string;
  priority_weight?:number|null;sponsored_until?:string;automated_enrichment_approved?:boolean;profile_verification?:ProfileVerification;
  profile?:{overview?:string;phone?:string;website?:string;hours?:Record<string,string>;amenities?:string[];social?:Record<string,string>};
};
type Form={
  name:string;streetAddress:string;city:string;region:string;postalCode:string;country:string;latitude:string;longitude:string;website:string;phone:string;
  licenseNumber:string;licenseStatus:string;licenseType:string;licenseTypes:string[];dataSource:string;sourceUrl:string;sourceLicense:string;
  recreational:boolean;medical:boolean;gameplayEnabled:boolean;active:boolean;status:string;imageryStatus:string;priorityWeight:string;sponsoredUntil:string;
  overview:string;hours:Record<string,string>;amenities:string;instagram:string;facebook:string;twitter:string;
};
type SortKey='name'|'city'|'region'|'country'|'kind'|'status'|'gameplay';
type GameplayFilter='all'|'enabled'|'disabled'|'not-ready';

function normalizeState(value?:string){const raw=String(value||'').trim();if(!raw)return'Unknown state';return STATE_ALIASES[raw.toUpperCase()]||raw;}
function makeForm(r:Row):Form{return{name:r.name||'',streetAddress:r.street_address||'',city:r.city||'',region:r.region||'',postalCode:r.postal_code||'',country:r.country||'',latitude:r.latitude==null?'':String(r.latitude),longitude:r.longitude==null?'':String(r.longitude),website:r.profile?.website||r.website||'',phone:r.profile?.phone||r.phone||'',licenseNumber:r.license_number||'',licenseStatus:r.license_status||'',licenseType:r.license_type||'',licenseTypes:r.license_types||[],dataSource:r.data_source||'',sourceUrl:r.source_url||'',sourceLicense:r.source_license||'',recreational:Boolean(r.recreational),medical:Boolean(r.medical),gameplayEnabled:r.gameplay_enabled!==0,active:r.active!==0,status:r.status||'candidate',imageryStatus:r.imagery_status||'unchecked',priorityWeight:r.priority_weight==null?'':String(r.priority_weight),sponsoredUntil:r.sponsored_until||'',overview:r.profile?.overview||'',hours:Object.fromEntries(DAYS.map(d=>[d,r.profile?.hours?.[d]||''])),amenities:(r.profile?.amenities||[]).join(', '),instagram:r.profile?.social?.instagram||'',facebook:r.profile?.social?.facebook||'',twitter:r.profile?.social?.twitter||''};}
function rowStatus(r:Row){return r.kind==='dispensary'?(r.active===0?'browse hidden':'browse active'):(r.status||'candidate');}
function hasCoordinates(r:Row){if(r.latitude==null||r.longitude==null||String(r.latitude).trim()===''||String(r.longitude).trim()==='')return false;const lat=Number(r.latitude),lng=Number(r.longitude);return Number.isFinite(lat)&&Number.isFinite(lng)&&lat>=-90&&lat<=90&&lng>=-180&&lng<=180;}
function gameReady(r:Row){return r.kind==='dispensary'&&hasCoordinates(r)&&Boolean(r.imagery_provider);}
function candidateGameReady(r:Row){return r.kind==='candidate'&&hasCoordinates(r)&&r.imagery_status==='coverage';}
function gameplayStatus(r:Row){if(r.kind!=='dispensary')return'candidate';if(!gameReady(r))return'not-ready';return r.gameplay_enabled===0?'disabled':'enabled';}
function rowKey(r:Row){return r.kind+':'+r.id;}
function bulkGameplayEligible(r:Row){return r.kind==='candidate'?r.status!=='rejected'&&hasCoordinates(r):r.gameplay_enabled===0&&gameReady(r);}
function cmp(a:string,b:string){return a.localeCompare(b,undefined,{numeric:true,sensitivity:'base'});}
function dateText(value?:string|null){if(!value)return'Never';const d=new Date(value);return Number.isNaN(d.getTime())?'Never':d.toLocaleDateString();}

export default function AdminFullDispensaryEditor(){
 const[rows,setRows]=useState<Row[]>([]);
 const[query,setQuery]=useState(''),[country,setCountry]=useState('all'),[region,setRegion]=useState('all'),[kind,setKind]=useState('all'),[recordStatus,setRecordStatus]=useState('all'),[gameplayFilter,setGameplayFilter]=useState<GameplayFilter>('all');
 const[sortKey,setSortKey]=useState<SortKey>('region'),[sortDir,setSortDir]=useState<'asc'|'desc'>('asc'),[page,setPage]=useState(1),[pageSize,setPageSize]=useState(50);
 const[selected,setSelected]=useState<Row|null>(null),[form,setForm]=useState<Form|null>(null),[status,setStatus]=useState('Loading locations…'),[busyId,setBusyId]=useState<string|null>(null),[selectedKeys,setSelectedKeys]=useState<string[]>([]),[bulkBusy,setBulkBusy]=useState(false);

 async function fetchRows(){
  const response=await fetch('/api/admin/dispensary-records',{cache:'no-store'});
  if(response.status===401){location.href='/admin/login';return[] as Row[];}
  const data=await response.json();if(!response.ok)throw new Error(data.error||'Could not load locations.');
  const records:Row[]=data.records||[];setRows(records);return records;
 }
 async function reload(message?:string,keep?:Row|null){
  const records=await fetchRows(),target=keep===undefined?selected:keep;
  if(target){const next=records.find(item=>item.id===target.id&&item.kind===target.kind)||null;setSelected(next);setForm(next?makeForm(next):null);}
  else if(keep===null){setSelected(null);setForm(null);}
  setStatus(message||records.length.toLocaleString()+' location records loaded.');return records;
 }
 useEffect(()=>{fetchRows().then(records=>{setStatus(records.length.toLocaleString()+' location records loaded.');const pending=sessionStorage.getItem('geoweedo-edit-dispensary-id');if(pending){const record=records.find(item=>item.kind==='dispensary'&&item.id===pending);sessionStorage.removeItem('geoweedo-edit-dispensary-id');if(record){clearFilters();choose(record);window.requestAnimationFrame(()=>document.querySelector('.full-dispensary-editor')?.scrollIntoView({behavior:'smooth',block:'start'}));}}}).catch(error=>setStatus(error instanceof Error?error.message:'Load failed.'));},[]);
 useEffect(()=>{setPage(1);},[query,country,region,kind,recordStatus,gameplayFilter,sortKey,sortDir,pageSize]);

 const countries=useMemo(()=>Array.from(new Set(rows.map(r=>r.country||'').filter(Boolean))).sort(cmp),[rows]);
 const regions=useMemo(()=>Array.from(new Set(rows.filter(r=>country==='all'||r.country===country).map(r=>normalizeState(r.region)))).sort(cmp),[rows,country]);
 const statuses=useMemo(()=>Array.from(new Set(rows.map(rowStatus))).sort(cmp),[rows]);
 const stateStats=useMemo(()=>{const map=new Map<string,{state:string;total:number;dispensaries:number;candidates:number;gameplay:number}>();for(const row of rows){if(country!=='all'&&row.country!==country)continue;const state=normalizeState(row.region),current=map.get(state)||{state,total:0,dispensaries:0,candidates:0,gameplay:0};current.total++;if(row.kind==='dispensary'){current.dispensaries++;if(gameplayStatus(row)==='enabled')current.gameplay++;}else current.candidates++;map.set(state,current);}return Array.from(map.values()).sort((a,b)=>cmp(a.state,b.state));},[rows,country]);
 const filtered=useMemo(()=>{const q=query.trim().toLowerCase(),list=rows.filter(r=>{if(country!=='all'&&r.country!==country)return false;if(region!=='all'&&normalizeState(r.region)!==region)return false;if(kind!=='all'&&r.kind!==kind)return false;if(recordStatus!=='all'&&rowStatus(r)!==recordStatus)return false;if(gameplayFilter!=='all'&&gameplayStatus(r)!==gameplayFilter)return false;if(!q)return true;return(r.name+' '+(r.street_address||'')+' '+(r.city||'')+' '+normalizeState(r.region)+' '+(r.country||'')+' '+(r.license_number||'')+' '+(r.license_type||'')+' '+(r.license_types||[]).join(' ')+' '+(r.data_source||'')).toLowerCase().includes(q);});list.sort((a,b)=>{const value=(r:Row)=>sortKey==='kind'?r.kind:sortKey==='status'?rowStatus(r):sortKey==='gameplay'?gameplayStatus(r):sortKey==='region'?normalizeState(r.region):String((r as any)[sortKey]||'');const n=cmp(value(a),value(b))||cmp(a.name,b.name);return sortDir==='asc'?n:-n;});return list;},[rows,query,country,region,kind,recordStatus,gameplayFilter,sortKey,sortDir]);
 const totalPages=Math.max(1,Math.ceil(filtered.length/pageSize)),safePage=Math.min(page,totalPages),visible=filtered.slice((safePage-1)*pageSize,safePage*pageSize);
 const selectedKeySet=useMemo(()=>new Set(selectedKeys),[selectedKeys]);
 const selectedRows=useMemo(()=>rows.filter(row=>selectedKeySet.has(rowKey(row))&&bulkGameplayEligible(row)),[rows,selectedKeySet]);
 const visibleEligible=useMemo(()=>visible.filter(bulkGameplayEligible),[visible]);
 const visibleEligibleSelected=visibleEligible.length>0&&visibleEligible.every(row=>selectedKeySet.has(rowKey(row)));

 function choose(r:Row){setSelected(r);setForm(makeForm(r));setStatus('Editing '+r.name+'.');}
 function toggleLicense(type:string){if(!form)return;setForm({...form,licenseTypes:form.licenseTypes.includes(type)?form.licenseTypes.filter(x=>x!==type):[...form.licenseTypes,type]});}
 function clearFilters(){setQuery('');setCountry('all');setRegion('all');setKind('all');setRecordStatus('all');setGameplayFilter('all');setSortKey('region');setSortDir('asc');setPage(1);}
 function toggleSelected(row:Row){if(!bulkGameplayEligible(row)||bulkBusy)return;const key=rowKey(row);setSelectedKeys(current=>current.includes(key)?current.filter(value=>value!==key):[...current,key]);}
 function toggleVisibleSelection(){if(bulkBusy||!visibleEligible.length)return;const keys=visibleEligible.map(rowKey);setSelectedKeys(current=>{const set=new Set(current);const all=keys.every(key=>set.has(key));for(const key of keys){if(all)set.delete(key);else set.add(key);}return Array.from(set);});}
 function clearSelection(){if(!bulkBusy)setSelectedKeys([]);}
 function closeEditor(){if(busyId)return;setSelected(null);setForm(null);}
 useEffect(()=>{if(!selected)return;const previous=document.body.style.overflow;document.body.style.overflow='hidden';const onKey=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!busyId){setSelected(null);setForm(null);}};window.addEventListener('keydown',onKey);return()=>{document.body.style.overflow=previous;window.removeEventListener('keydown',onKey);};},[selected,busyId]);
 function setGameplayForm(enabled:boolean){if(!selected||!form||selected.kind!=='dispensary')return;if(enabled&&!gameReady(selected)){setStatus('Gameplay cannot be enabled until this dispensary has valid coordinates and approved Street View imagery. Save location/imagery corrections first.');return;}setForm({...form,gameplayEnabled:enabled});setStatus(enabled?'Gameplay will be enabled when you save.':'Gameplay will be disabled when you save. Browse visibility is independent.');}

 async function save(){if(!selected||!form)return;setBusyId(selected.id);setStatus('Saving all location information…');try{const details={...form,latitude:form.latitude===''?null:Number(form.latitude),longitude:form.longitude===''?null:Number(form.longitude),priorityWeight:form.priorityWeight===''?null:Number(form.priorityWeight),amenities:form.amenities.split(',').map(v=>v.trim()).filter(Boolean),social:{instagram:form.instagram,facebook:form.facebook,twitter:form.twitter}};const response=await fetch('/api/admin/dispensary-records',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:selected.id,kind:selected.kind,details})});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||'Save failed.');await reload('Location information saved.',selected);}catch(error){setStatus(error instanceof Error?error.message:'Save failed.');}finally{setBusyId(null);}}
 async function fillLocalityFromCoordinates(){
  if(!selected||!form)return;
  const latitude=Number(form.latitude),longitude=Number(form.longitude);
  if(!Number.isFinite(latitude)||!Number.isFinite(longitude)){setStatus('Valid coordinates are required to fill city and postal code.');return;}
  setBusyId(selected.id);setStatus('Resolving city and postal code from coordinates…');
  try{
   const response=await fetch('/api/admin/dispensary-records',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'lookup-coordinate-locality',id:selected.id,latitude,longitude})});
   const data=await response.json().catch(()=>({}));
   if(!response.ok)throw new Error(data.error||'Coordinate lookup failed.');
   const location=data.location||{};
   setForm(current=>current?{...current,city:current.city||String(location.city||''),postalCode:current.postalCode||String(location.postalCode||''),region:current.region||String(location.region||''),country:current.country||String(location.country||'')}:current);
   const summary=[location.city,location.region,location.postalCode].filter(Boolean).join(', ');
   setStatus(summary?'Coordinates resolved to '+summary+'. Save to keep the filled location fields.':'Coordinates resolved, but no city or postal code was returned.');
  }catch(error){setStatus(error instanceof Error?error.message:'Coordinate lookup failed.');}
  finally{setBusyId(null);}
 }
 async function locationAction(row:Row,action:'set-browse'|'set-gameplay',value:boolean){if(row.kind!=='dispensary')return;setBusyId(row.id);try{const body=action==='set-browse'?{id:row.id,action,active:value}:{id:row.id,action,enabled:value};const response=await fetch('/api/admin/dispensary-records',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||'Update failed.');await reload(row.name+': '+(action==='set-browse'?(value?'shown on browse map.':'hidden from browse map.'):(value?'gameplay enabled.':'gameplay disabled.')),row);}catch(error){setStatus(error instanceof Error?error.message:'Update failed.');}finally{setBusyId(null);}}
 async function confirmProfile(row:Row){if(row.kind!=='dispensary')return;setBusyId(row.id);try{const response=await fetch('/api/admin/dispensary-records',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:row.id,action:'mark-profile-verified',reauditDays:90,source:'locations-manager'})});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||'Confirmation failed.');await reload(row.name+': profile confirmed for 90 days.',row);}catch(error){setStatus(error instanceof Error?error.message:'Confirmation failed.');}finally{setBusyId(null);}}
 async function enrichDispensary(row:Row){if(row.kind!=='dispensary')return;setBusyId(row.id);setStatus(row.name+': running Google Places enrichment…');try{const response=await fetch('/api/admin/dispensary-batch-enrichment',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'singleDispensary',locationId:row.id,autoApply:true})});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||'Enrichment failed.');const counts=data.job?.counts||{};let message=row.name+': enrichment finished.';if(Number(counts.applied||0)>0)message=row.name+': enrichment approved and applied.';else if(Number(counts.review||0)>0)message=row.name+': enrichment needs Admin review.';else if(Number(counts.failed||0)>0)message=row.name+': enrichment failed; review the result.';await reload(message,row);}catch(error){setStatus(error instanceof Error?error.message:'Enrichment failed.');}finally{setBusyId(null);}}
 async function enrichCandidate(row:Row){if(row.kind!=='candidate'||row.status==='rejected')return;setBusyId(row.id);setStatus(row.name+': running Google Places enrichment…');try{const response=await fetch('/api/admin/dispensary-batch-enrichment',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'singleCandidate',locationId:row.id,autoApply:true})});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||'Automated enrichment failed.');const counts=data.job?.counts||{};let message=row.name+': enrichment finished.';if(Number(counts.applied||0)>0)message=row.name+': enrichment applied; Confirm & Enable is now available.';else if(Number(counts.review||0)>0)message=row.name+': Google Places match needs Admin review.';else if(Number(counts.failed||0)>0)message=row.name+': enrichment failed; review the result.';await reload(message,row);}catch(error){setStatus(error instanceof Error?error.message:'Automated enrichment failed.');}finally{setBusyId(null);}}
 async function confirmAndEnableCandidate(row:Row){if(row.kind!=='candidate'||row.status==='rejected')return;if(!hasCoordinates(row)){setStatus(row.name+': save valid coordinates before enabling gameplay.');return;}setBusyId(row.id);setStatus(row.name+': validating Street View and enabling gameplay…');try{const check=await fetch('/api/admin/candidates/check-imagery',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:[row.id],limit:1,source:'coordinate_ready'})});const checked=await check.json().catch(()=>({}));if(!check.ok)throw new Error(checked.error||'Street View validation failed.');const result=Array.isArray(checked.results)?checked.results[0]:null,imageryStatus=result?.imageryStatus||row.imagery_status;if(imageryStatus!=='coverage')throw new Error(result?.imageryMessage||'This location does not yet have gameplay-ready Street View.');const approve=await fetch('/api/admin/candidates',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:[row.id],action:'approve'})});const approved=await approve.json().catch(()=>({}));if(!approve.ok)throw new Error(approved.error||'Promotion failed.');if(Number(approved.promoted||0)<1){const reason=Object.keys(approved.skippedReasons||{})[0];throw new Error(reason?'Promotion skipped: '+reason.replace(/_/g,' ')+'.':'Candidate did not pass final gameplay validation.');}await reload(row.name+': confirmed, promoted, and gameplay enabled.',null);window.dispatchEvent(new Event('geoweedo-pipeline-updated'));}catch(error){setStatus(error instanceof Error?error.message:'Could not confirm and enable gameplay.');}finally{setBusyId(null);}}
 async function bulkEnableGameplay(){
  const targets=selectedRows;
  if(!targets.length){setStatus('Select one or more eligible rows first.');return;}
  const candidateTargets=targets.filter(row=>row.kind==='candidate');
  const dispensaryTargets=targets.filter(row=>row.kind==='dispensary');
  if(!window.confirm('Enable gameplay for '+targets.length+' selected location'+(targets.length===1?'':'s')+'? Candidates will still receive Street View validation before promotion.'))return;
  setBulkBusy(true);
  setStatus('Bulk gameplay enable started for '+targets.length+' selected locations…');
  let promoted=0,enabled=0,skipped=0;
  const skippedReasons:Record<string,number>={};
  const noteSkip=(reason:string,count=1)=>{skipped+=count;skippedReasons[reason]=(skippedReasons[reason]||0)+count;};
  try{
   const candidateIds=candidateTargets.map(row=>row.id);
   for(let offset=0;offset<candidateIds.length;offset+=20){
    const ids=candidateIds.slice(offset,offset+20);
    setStatus('Validating Street View for candidates '+(offset+1)+'–'+Math.min(offset+ids.length,candidateIds.length)+' of '+candidateIds.length+'…');
    const check=await fetch('/api/admin/candidates/check-imagery',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids,limit:ids.length,source:'coordinate_ready'})});
    const checked=await check.json().catch(()=>({}));
    if(!check.ok){noteSkip('imagery_check_failed',ids.length);continue;}
    const results=Array.isArray(checked.results)?checked.results:[];
    const readyIds=results.filter((item:any)=>item?.imageryStatus==='coverage').map((item:any)=>String(item.id)).filter(Boolean);
    const notReady=Math.max(0,ids.length-readyIds.length);
    if(notReady)noteSkip('imagery_not_ready',notReady);
    if(!readyIds.length)continue;
    const approve=await fetch('/api/admin/candidates',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:readyIds,action:'approve'})});
    const approved=await approve.json().catch(()=>({}));
    if(!approve.ok){noteSkip('promotion_request_failed',readyIds.length);continue;}
    promoted+=Number(approved.promoted||0);
    const approveSkipped=Number(approved.skipped||0);
    skipped+=approveSkipped;
    for(const [reason,count] of Object.entries(approved.skippedReasons||{}))skippedReasons[reason]=(skippedReasons[reason]||0)+Number(count||0);
   }

   if(dispensaryTargets.length){
    setStatus('Enabling gameplay for '+dispensaryTargets.length+' approved dispensar'+(dispensaryTargets.length===1?'y':'ies')+'…');
    const response=await fetch('/api/admin/dispensary-records',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'set-gameplay-bulk',ids:dispensaryTargets.map(row=>row.id)})});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)noteSkip('dispensary_bulk_update_failed',dispensaryTargets.length);
    else{
     enabled+=Number(data.updated||0);
     skipped+=Number(data.skipped||0);
     for(const [reason,count] of Object.entries(data.skippedReasons||{}))skippedReasons[reason]=(skippedReasons[reason]||0)+Number(count||0);
    }
   }

   await fetchRows();
   setSelectedKeys([]);
   const completed=promoted+enabled;
   const details=Object.entries(skippedReasons).filter(([,count])=>count>0).map(([reason,count])=>count+' '+reason.replace(/_/g,' ')).join(' · ');
   setStatus('Bulk gameplay complete: '+completed+' enabled'+(promoted?' · '+promoted+' candidates promoted':'')+(enabled?' · '+enabled+' dispensaries enabled':'')+(skipped?' · '+skipped+' skipped'+(details?' ('+details+')':''):'')+'.');
   if(completed)window.dispatchEvent(new Event('geoweedo-pipeline-updated'));
  }catch(error){
   setStatus(error instanceof Error?error.message:'Bulk gameplay enable failed.');
  }finally{setBulkBusy(false);}
 }
 async function setCandidateStatus(row:Row,next:'candidate'|'reviewing'|'rejected'){if(row.kind!=='candidate')return;setBusyId(row.id);try{const response=await fetch('/api/admin/candidates',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:row.id,status:next})});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||'Candidate status update failed.');await reload(row.name+': '+(next==='rejected'?'rejected.':next==='candidate'?'restored to candidate.':'moved to review.'),row);}catch(error){setStatus(error instanceof Error?error.message:'Candidate status update failed.');}finally{setBusyId(null);}}
 async function deleteRejectedCandidate(row:Row){if(row.kind!=='candidate'||row.status!=='rejected')return;if(!window.confirm('Permanently delete rejected candidate "'+row.name+'"? This cannot be undone.'))return;setBusyId(row.id);try{const response=await fetch('/api/admin/candidates',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:row.id})});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||'Could not delete rejected candidate.');await reload(row.name+': rejected candidate deleted.',null);}catch(error){setStatus(error instanceof Error?error.message:'Could not delete rejected candidate.');}finally{setBusyId(null);}}
 function actionButton(label:string,onClick:()=>void,disabled=false,primary=false){return <button type="button" className={primary?'primary':'ghost'} disabled={disabled} onClick={event=>{event.stopPropagation();onClick();}}>{label}</button>;}

 const editLatitude=form?Number(form.latitude):NaN,editLongitude=form?Number(form.longitude):NaN;

 return <section className="admin-panel full-dispensary-editor unified-location-manager" style={{marginBottom:24}}>
  <div><span className="eyebrow">UNIFIED LOCATIONS MANAGER</span><h2 style={{margin:'4px 0'}}>Locations</h2><p style={{margin:0,color:'var(--muted)'}}>State browsing, candidate review, confirmation, enrichment, gameplay controls, browse visibility, and full editing are managed here.</p></div>

  <div className="location-state-strip" aria-label="Filter locations by state">
   <button type="button" className={region==='all'?'primary':'ghost'} onClick={()=>setRegion('all')}>All states <span className="location-state-meta">{rows.length}</span></button>
   {stateStats.map(item=><button type="button" key={item.state} className={region===item.state?'primary':'ghost'} onClick={()=>setRegion(item.state)} title={item.dispensaries+' dispensaries · '+item.candidates+' candidates · '+item.gameplay+' gameplay enabled'}>{item.state}<span className="location-state-meta">{item.total}</span></button>)}
  </div>

  <div className="location-filter-grid">
   <input placeholder="Search name, address, city, license, source…" value={query} onChange={e=>setQuery(e.target.value)}/>
   <select value={country} onChange={e=>{setCountry(e.target.value);setRegion('all')}}><option value="all">All countries</option>{countries.map(v=><option key={v}>{v}</option>)}</select>
   <select value={region} onChange={e=>setRegion(e.target.value)}><option value="all">All states / regions</option>{regions.map(v=><option key={v}>{v}</option>)}</select>
   <select value={kind} onChange={e=>setKind(e.target.value)}><option value="all">All record types</option><option value="dispensary">Approved dispensaries</option><option value="candidate">Imported candidates</option></select>
   <select value={recordStatus} onChange={e=>setRecordStatus(e.target.value)}><option value="all">All browse / statuses</option>{statuses.map(v=><option key={v}>{v}</option>)}</select>
   <select value={gameplayFilter} onChange={e=>setGameplayFilter(e.target.value as GameplayFilter)}><option value="all">All gameplay</option><option value="enabled">Gameplay enabled</option><option value="disabled">Gameplay disabled</option><option value="not-ready">Not game ready</option></select>
  </div>

  <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',marginTop:8}}>
   <label>Sort <select value={sortKey} onChange={e=>setSortKey(e.target.value as SortKey)}><option value="region">State / region</option><option value="name">Name</option><option value="city">City</option><option value="country">Country</option><option value="kind">Record type</option><option value="status">Status</option><option value="gameplay">Gameplay</option></select></label>
   <select value={sortDir} onChange={e=>setSortDir(e.target.value as 'asc'|'desc')}><option value="asc">A → Z</option><option value="desc">Z → A</option></select>
   <label>Rows <select value={pageSize} onChange={e=>setPageSize(Number(e.target.value))}><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select></label>
   <button className="ghost" type="button" onClick={clearFilters}>Clear filters</button><span style={{marginLeft:'auto',color:'var(--muted)',fontSize:13}}>{filtered.length.toLocaleString()} matches</span>
  </div>

  <div className="location-bulk-actions" style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',marginTop:12,padding:'10px 12px',border:'1px solid var(--border)',borderRadius:10,background:'rgba(255,255,255,.02)'}}>
   <label style={{display:'inline-flex',gap:7,alignItems:'center',fontWeight:700}}><input type="checkbox" checked={visibleEligibleSelected} disabled={bulkBusy||visibleEligible.length===0} onChange={toggleVisibleSelection}/> Select eligible on this page ({visibleEligible.length})</label>
   <span style={{color:'var(--muted)',fontSize:12}}>{selectedRows.length} selected across pages</span>
   <button className="ghost" type="button" disabled={bulkBusy||selectedRows.length===0} onClick={clearSelection}>Clear selection</button>
   <button className="primary" type="button" disabled={bulkBusy||selectedRows.length===0} onClick={()=>void bulkEnableGameplay()} style={{marginLeft:'auto'}}>{bulkBusy?'Enabling selected…':'Enable gameplay selected ('+selectedRows.length+')'}</button>
  </div>

  <div className="admin-status" style={{margin:'12px 0'}}>{status}</div>

  <div>
   <div>
    <div className="location-table-wrap">
     <table className="location-table">
      <thead><tr><th style={{width:36,textAlign:'center'}}><input type="checkbox" aria-label="Select eligible rows on this page" checked={visibleEligibleSelected} disabled={bulkBusy||visibleEligible.length===0} onChange={toggleVisibleSelection}/></th><th>Name</th><th>City</th><th>State</th><th>Type</th><th>Browse / status</th><th>Gameplay</th><th>Actions</th></tr></thead>
      <tbody>{visible.map(row=>{const eligible=bulkGameplayEligible(row),checked=selectedKeySet.has(rowKey(row));return <tr key={row.kind+':'+row.id} onClick={()=>choose(row)} style={{cursor:'pointer',borderTop:'1px solid var(--border)',background:checked?'rgba(103,214,110,.05)':undefined}}>
       <td onClick={event=>event.stopPropagation()} style={{textAlign:'center',padding:'6px'}}><input type="checkbox" aria-label={'Select '+row.name+' for gameplay enable'} checked={checked} disabled={bulkBusy||!eligible} onChange={()=>toggleSelected(row)} title={eligible?'Select for bulk gameplay enable':row.kind==='dispensary'?'Already enabled or not game ready':'Candidate needs valid coordinates'}/></td>
       <td style={{padding:10}}><strong>{row.name}</strong>{row.license_number&&<div style={{fontSize:11,color:'var(--muted)'}}>{row.license_number}</div>}{row.kind==='candidate'&&row.automated_enrichment_approved&&<div style={{fontSize:10,color:'#8ecbff'}}>Enrichment approved</div>}</td>
       <td>{row.city||'—'}</td><td>{normalizeState(row.region)}</td><td>{row.kind==='candidate'?'Candidate':'Dispensary'}</td><td>{rowStatus(row)}</td><td>{gameplayStatus(row)==='enabled'?'Enabled':gameplayStatus(row)==='disabled'?'Disabled':gameplayStatus(row)==='not-ready'?'Not ready':'—'}</td>
       <td onClick={event=>event.stopPropagation()}><div className="location-actions">
        {actionButton('Edit',()=>choose(row))}
        {row.kind==='dispensary'?<>{actionButton('Confirm',()=>void confirmProfile(row),busyId===row.id)}{actionButton('Enrich',()=>void enrichDispensary(row),busyId===row.id)}{actionButton(row.active===0?'Show browse':'Hide browse',()=>void locationAction(row,'set-browse',row.active===0),busyId===row.id)}{actionButton(row.gameplay_enabled===0?'Gameplay on':'Gameplay off',()=>void locationAction(row,'set-gameplay',row.gameplay_enabled===0),busyId===row.id||row.gameplay_enabled===0&&!gameReady(row))}</>:row.status==='rejected'?<>{actionButton('Restore',()=>void setCandidateStatus(row,'candidate'),busyId===row.id,true)}{actionButton('Delete',()=>void deleteRejectedCandidate(row),busyId===row.id)}</>:<>{actionButton('Enrich',()=>void enrichCandidate(row),busyId===row.id)}{actionButton('Enable gameplay',()=>void confirmAndEnableCandidate(row),busyId===row.id||!hasCoordinates(row),true)}{actionButton('Reject',()=>void setCandidateStatus(row,'rejected'),busyId===row.id)}</>}
       </div></td>
      </tr>})}</tbody>
     </table>
    </div>
    <div style={{display:'flex',justifyContent:'space-between',marginTop:10}}><span>Page {safePage} of {totalPages}</span><div style={{display:'flex',gap:6}}><button className="ghost" disabled={safePage<=1} onClick={()=>setPage(1)}>First</button><button className="ghost" disabled={safePage<=1} onClick={()=>setPage(p=>p-1)}>Previous</button><button className="ghost" disabled={safePage>=totalPages} onClick={()=>setPage(p=>p+1)}>Next</button><button className="ghost" disabled={safePage>=totalPages} onClick={()=>setPage(totalPages)}>Last</button></div></div>
   </div>

   {selected&&form&&<div className="admin-form location-editor-modal" role="dialog" aria-modal="true" aria-label={'Edit '+selected.name}>
    <div className="location-modal-head"><div><span className="eyebrow">{selected.kind==='dispensary'?'DISPENSARY':'CANDIDATE'}</span><h3>{selected.name}</h3><small>{normalizeState(selected.region)} · {rowStatus(selected)}{selected.kind==='dispensary'?' · profile confirmed '+dateText(selected.profile_verification?.lastVerifiedAt):''}</small></div><button className="ghost" type="button" disabled={Boolean(busyId)} onClick={closeEditor}>Close</button></div>

    <div className="location-editor-actions">
     {selected.kind==='dispensary'?<><button className="ghost" disabled={busyId===selected.id} onClick={()=>void confirmProfile(selected)}>Confirm profile</button><button className="ghost" disabled={busyId===selected.id} onClick={()=>void enrichDispensary(selected)}>Run enrichment</button><button className="ghost" disabled={busyId===selected.id} onClick={()=>void locationAction(selected,'set-browse',selected.active===0)}>{selected.active===0?'Show on browse map':'Hide from browse map'}</button><button className="ghost" disabled={busyId===selected.id||selected.gameplay_enabled===0&&!gameReady(selected)} onClick={()=>void locationAction(selected,'set-gameplay',selected.gameplay_enabled===0)}>{selected.gameplay_enabled===0?'Enable gameplay':'Disable gameplay'}</button></>:selected.status==='rejected'?<><button className="primary" disabled={busyId===selected.id} onClick={()=>void setCandidateStatus(selected,'candidate')}>Restore candidate</button><button className="ghost" disabled={busyId===selected.id} onClick={()=>void deleteRejectedCandidate(selected)}>Delete permanently</button></>:<><button className="ghost" disabled={busyId===selected.id} onClick={()=>void enrichCandidate(selected)}>Run enrichment</button><button className="primary" disabled={busyId===selected.id||!hasCoordinates(selected)} onClick={()=>void confirmAndEnableCandidate(selected)}>Enable gameplay</button><button className="ghost" disabled={busyId===selected.id} onClick={()=>void setCandidateStatus(selected,'reviewing')}>Mark reviewing</button><button className="ghost" disabled={busyId===selected.id} onClick={()=>void setCandidateStatus(selected,'rejected')}>Reject</button></>}
    </div>
    <div className="location-modal-status">{status}</div>

    <input placeholder="Name" value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/><input placeholder="Street address" value={form.streetAddress} onChange={e=>setForm({...form,streetAddress:e.target.value})}/>
    <div className="field-row"><input placeholder="City" value={form.city} onChange={e=>setForm({...form,city:e.target.value})}/><input placeholder="State / region" value={form.region} onChange={e=>setForm({...form,region:e.target.value})}/></div>
    <div className="field-row"><input placeholder="Postal code" value={form.postalCode} onChange={e=>setForm({...form,postalCode:e.target.value})}/><input placeholder="Country" value={form.country} onChange={e=>setForm({...form,country:e.target.value})}/></div>
    <div className="field-row"><input placeholder="Latitude" value={form.latitude} onChange={e=>setForm({...form,latitude:e.target.value})}/><input placeholder="Longitude" value={form.longitude} onChange={e=>setForm({...form,longitude:e.target.value})}/></div>

    {Number.isFinite(editLatitude)&&Number.isFinite(editLongitude)&&<div className="location-map-panel"><div className="location-map-head" style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,flexWrap:'wrap'}}><span>Verify coordinates by clicking the map or dragging the green pin.</span>{(!form.city.trim()||!form.postalCode.trim())&&<button className="ghost" type="button" disabled={busyId===selected.id} onClick={()=>void fillLocalityFromCoordinates()}>{busyId===selected.id?'Looking up…':'Fill city / ZIP from coordinates'}</button>}</div><AdminCoordinateMap key={selected.kind+selected.id} latitude={editLatitude} longitude={editLongitude} onChange={(latitude,longitude)=>setForm(current=>current?{...current,latitude:latitude.toFixed(6),longitude:longitude.toFixed(6)}:current)}/></div>}

    {selected.kind==='candidate'&&<div className="candidate-gameplay-panel"><div><span className="eyebrow">GAMEPLAY</span><strong>{!hasCoordinates(selected)?'Save coordinates to continue':candidateGameReady(selected)?'Street View ready · Enable when ready':'Ready for Street View validation'}</strong><p>Enable gameplay performs a fresh Street View check, promotes this candidate to an approved dispensary, and turns gameplay on. Google Places enrichment is optional for this manual Admin action.</p><small>Existing source/provenance and Street View validation still apply.</small></div><div className="candidate-gameplay-actions"><button className="primary" type="button" disabled={busyId===selected.id||!hasCoordinates(selected)} onClick={()=>void confirmAndEnableCandidate(selected)}>{busyId===selected.id?'Enabling…':'Enable gameplay'}</button>{!selected.automated_enrichment_approved&&<button className="ghost" type="button" disabled={busyId===selected.id} onClick={()=>void enrichCandidate(selected)}>Run enrichment (optional)</button>}</div></div>}

    <div className="field-row"><input placeholder="Phone" value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})}/><input placeholder="Website" value={form.website} onChange={e=>setForm({...form,website:e.target.value})}/></div>
    <textarea placeholder="Overview / business description" value={form.overview} onChange={e=>setForm({...form,overview:e.target.value})}/>
    <h4>Hours of operation</h4>{DAYS.map(day=><div className="field-row" key={day}><label>{day}</label><input placeholder="9:00 AM - 9:00 PM or Closed" value={form.hours[day]||''} onChange={e=>setForm({...form,hours:{...form.hours,[day]:e.target.value}})}/></div>)}
    <input placeholder="Amenities / services, comma separated" value={form.amenities} onChange={e=>setForm({...form,amenities:e.target.value})}/>
    <div className="field-row"><input placeholder="Instagram URL" value={form.instagram} onChange={e=>setForm({...form,instagram:e.target.value})}/><input placeholder="Facebook URL" value={form.facebook} onChange={e=>setForm({...form,facebook:e.target.value})}/></div><input placeholder="X / Twitter URL" value={form.twitter} onChange={e=>setForm({...form,twitter:e.target.value})}/>

    {selected.kind==='dispensary'&&<><h4>Dispensary branding</h4><div style={{border:'1px solid var(--border)',borderRadius:12,padding:12}}><p style={{fontSize:12,color:'var(--muted)',margin:'0 0 10px'}}>Custom logo shown on this dispensary's public GeoWeedo profile.</p><DispensaryLogoUploader locationId={selected.id} compact/></div></>}

    <h4>License & source</h4><div className="field-row"><input placeholder="License number" value={form.licenseNumber} onChange={e=>setForm({...form,licenseNumber:e.target.value})}/>{selected.kind==='candidate'&&<input placeholder="License status" value={form.licenseStatus} onChange={e=>setForm({...form,licenseStatus:e.target.value})}/>}</div>
    <div><strong style={{display:'block',marginBottom:8}}>License type(s)</strong><div className="check-row" style={{display:'grid',gridTemplateColumns:'repeat(2,minmax(0,1fr))',gap:8}}>{DISPENSARY_LICENSE_TYPES.map(type=><label key={type.id}><input type="checkbox" checked={form.licenseTypes.includes(type.id)} onChange={()=>toggleLicense(type.id)}/> {type.label}</label>)}</div></div>
    {selected.kind==='candidate'&&<input placeholder="Raw license type from official source" value={form.licenseType} onChange={e=>setForm({...form,licenseType:e.target.value})}/>}
    <div className="field-row"><input placeholder="Data source" value={form.dataSource} onChange={e=>setForm({...form,dataSource:e.target.value})}/><input placeholder="Source URL" value={form.sourceUrl} onChange={e=>setForm({...form,sourceUrl:e.target.value})}/></div><textarea placeholder="Source license / permission note" value={form.sourceLicense} onChange={e=>setForm({...form,sourceLicense:e.target.value})}/>

    {selected.kind==='dispensary'?<><h4>Visibility & gameplay</h4><div style={{border:'1px solid var(--border)',borderRadius:12,padding:12}}><label style={{display:'flex',gap:10,alignItems:'center',fontWeight:700}}><input type="checkbox" checked={form.gameplayEnabled} disabled={!form.gameplayEnabled&&!gameReady(selected)} onChange={e=>setGameplayForm(e.target.checked)}/> Enable Gameplay</label><p style={{fontSize:12,color:'var(--muted)',margin:'8px 0 0'}}>Gameplay requires valid coordinates and approved Street View imagery. Browse visibility is controlled separately.</p><p style={{fontSize:12,margin:'6px 0 0'}}><strong>{gameReady(selected)?(form.gameplayEnabled?'Game Ready · Enabled':'Game Ready · Disabled'):'Not Game Ready'}</strong>{!hasCoordinates(selected)?' · Missing coordinates':''}{!selected.imagery_provider?' · Missing Street View':''}</p></div><div className="check-row"><label><input type="checkbox" checked={form.recreational} onChange={e=>setForm({...form,recreational:e.target.checked})}/> Adult-use</label><label><input type="checkbox" checked={form.medical} onChange={e=>setForm({...form,medical:e.target.checked})}/> Medical</label><label><input type="checkbox" checked={form.active} onChange={e=>setForm({...form,active:e.target.checked})}/> Active on browse map</label></div><div className="field-row"><input placeholder="Priority weight" value={form.priorityWeight} onChange={e=>setForm({...form,priorityWeight:e.target.value})}/><input placeholder="Sponsored until" value={form.sponsoredUntil} onChange={e=>setForm({...form,sponsoredUntil:e.target.value})}/></div><p style={{fontSize:12,color:'var(--muted)'}}>Imagery provider: {selected.imagery_provider||'—'}</p></>:<><h4>Candidate review</h4><div className="field-row"><select value={form.status} onChange={e=>setForm({...form,status:e.target.value})}><option value="candidate">Candidate</option><option value="reviewing">Reviewing</option><option value="rejected">Rejected</option></select><select value={form.imageryStatus} onChange={e=>setForm({...form,imageryStatus:e.target.value})}><option value="unchecked">Imagery unchecked</option><option value="missing_coordinates">Missing coordinates</option><option value="coverage">Street View coverage</option><option value="no_coverage">No Street View coverage</option><option value="error">Imagery error</option><option value="rejected">Imagery rejected</option></select></div><p style={{fontSize:12,color:'var(--muted)'}}>Enrichment: {selected.automated_enrichment_approved?'approved':'optional / not yet approved'} · Imagery: {selected.imagery_status||'unchecked'}{selected.imagery_count!=null?' · '+selected.imagery_count+' image(s)':''}</p></>}

    <div className="location-modal-footer"><button className="ghost" type="button" disabled={Boolean(busyId)} onClick={closeEditor}>Cancel</button><button className="primary" disabled={busyId===selected.id} onClick={()=>void save()}>{busyId===selected.id?'Saving…':'Save all location information'}</button></div>
   </div>}
  </div>
 </section>;
}
