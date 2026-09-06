import 'server-only';
import { PDFParse } from 'pdf-parse';

type WestVirginiaCandidate={
  name:string;
  streetAddress:string;
  city?:string;
  region:string;
  country:string;
  phone?:string;
  dataSource:string;
  sourceUrl:string;
  sourceLicense:string;
  imageryStatus:'missing_coordinates';
};

const SOURCE_URL='https://omc.wv.gov/PublishingImages/Lists/Accordion/NewForm/Copy%20of%20WV%20Medical%20Cannabis%20Facilities%20-%20Dispensary%20List.pdf';

function clean(value:string){return value.replace(/\u00bd/g,'1/2').replace(/\s+/g,' ').trim();}
function phoneLine(value:string){return /^\(?\d{3}\)?[-.\s]*\d{3}[-.\s]*\d{4}$/.test(value);}
function headerLine(value:string){return /^DISPENSARIES$/i.test(value)||/^Dispensary Name(?:\s+Website)?\s+Phone$/i.test(value)||/^Website$/i.test(value)||/^Phone$/i.test(value);}
function websiteLine(value:string){return /^(?:https?:\/\/|www\.)\S+$/i.test(value);}
function cityHint(name:string){const match=name.match(/\s+-\s+([^–—-]+)$/);return match?.[1]?.trim();}

function parseAddress(value:string,name:string):{streetAddress:string;city?:string}{
 const normalized=clean(value).replace(/\s+-\s+[A-Za-z][A-Za-z .'-]*$/,'').trim();
 const state=normalized.match(/^(.*?)\s*,?\s*WV(?:\s+(\d{5}(?:-\d{4})?))?$/i);
 if(!state)return{streetAddress:normalized};
 const beforeState=state[1].trim().replace(/,+$/,'');
 const zip=state[2];
 const hint=cityHint(name);
 if(hint&&beforeState.toLowerCase().endsWith(hint.toLowerCase())){
  const street=beforeState.slice(0,beforeState.length-hint.length).replace(/[\s,]+$/,'').trim();
  if(street)return{streetAddress:street,city:hint};
 }
 const comma=beforeState.lastIndexOf(',');
 if(comma>0){
  const street=beforeState.slice(0,comma).trim(),city=beforeState.slice(comma+1).trim();
  if(street&&city&&!/\d/.test(city))return{streetAddress:street,city};
 }
 return{streetAddress:`${beforeState}, WV${zip?` ${zip}`:''}`};
}

export async function fetchWestVirginiaCandidates():Promise<WestVirginiaCandidate[]>{
 const response=await fetch(SOURCE_URL,{headers:{Accept:'application/pdf','User-Agent':'GeoWeedo/0.7 (https://geoweedo.com)','Accept-Language':'en-US,en;q=0.9'},cache:'no-store',signal:AbortSignal.timeout(45000)});
 if(!response.ok)throw new Error(`West Virginia OMC dispensary PDF returned ${response.status}.`);
 const bytes=new Uint8Array(await response.arrayBuffer());
 if(bytes.length<4||String.fromCharCode(bytes[0],bytes[1],bytes[2],bytes[3])!=='%PDF')throw new Error('West Virginia OMC dispensary download was not a PDF; refusing an unverified import.');
 const parser=new PDFParse({data:bytes});let text='';try{text=(await parser.getText()).text||'';}finally{await parser.destroy();}
 const lines=text.replace(/\r/g,'\n').split(/\n+/).map(clean).filter(Boolean);
 const rows:WestVirginiaCandidate[]=[];let block:string[]=[];
 const flush=(phone:string)=>{
  const useful=block.filter(line=>!headerLine(line)&&!websiteLine(line));block=[];
  if(useful.length<2)return;
  const name=useful[0],addressText=clean(useful.slice(1).join(' '));
  if(!name||!addressText||!/\bWV\b/i.test(addressText))return;
  const address=parseAddress(addressText,name);
  rows.push({name,streetAddress:address.streetAddress,city:address.city,region:'West Virginia',country:'USA',phone:clean(phone),dataSource:'West Virginia OMC Licensed Medical Cannabis Dispensaries',sourceUrl:SOURCE_URL,sourceLicense:'Official West Virginia Department of Health Office of Medical Cannabis operational licensed dispensary list. Street address, city when recoverable from the published listing, and phone are imported; coordinates are completed through GeoWeedo Automated Enrichment.',imageryStatus:'missing_coordinates'});
 };
 for(const line of lines){
  if(headerLine(line))continue;
  if(phoneLine(line)){flush(line);continue;}
  block.push(line);
 }
 const unique=new Map<string,WestVirginiaCandidate>();
 for(const row of rows){const key=`${row.name}|${row.streetAddress}`.toLowerCase().replace(/[^a-z0-9|]/g,'');if(!unique.has(key))unique.set(key,row);}
 const result=Array.from(unique.values());
 if(result.length<50)throw new Error(`West Virginia OMC dispensary PDF yielded only ${result.length} recognizable operational locations; expected at least 50, refusing a likely partial or PDF-layout-mismatched import.`);
 return result;
}
