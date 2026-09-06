import 'server-only';

type UtahCandidate={name:string;streetAddress:string;city:string;region:string;country:string;website?:string;dataSource:string;sourceUrl:string;sourceLicense:string;imageryStatus:'missing_coordinates'};

const SOURCE_URL='https://medicalcannabis.utah.gov/pharmacy-locations/';

function clean(value:string){return value.replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#0*39;|&apos;/gi,"'").replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();}
function decodeHref(value:string){return value.replace(/&amp;/g,'&').trim();}
function externalWebsite(cellHtml:string){
 const match=cellHtml.match(/href=["']([^"']+)["']/i);if(!match)return undefined;
 const raw=decodeHref(match[1]);
 try{
  const url=new URL(raw,SOURCE_URL);
  if(/(^|\.)google\.com$/i.test(url.hostname)){const target=url.searchParams.get('q')||url.searchParams.get('url');return target&&/^https?:\/\//i.test(target)?target:undefined;}
  return /^https?:$/i.test(url.protocol)?url.toString():undefined;
 }catch{return undefined;}
}
function addressParts(address:string){
 const parts=address.split(',').map(part=>part.trim()).filter(Boolean);
 let cityIndex=-1;
 for(let i=parts.length-1;i>=0;i--){
  const stripped=parts[i].replace(/\bUT\b.*$/i,'').replace(/\b\d{5}(?:-\d{4})?\b.*$/,'').trim();
  if(stripped&&!/^\d+$/.test(stripped)&&!/^(suite|ste|unit)\b/i.test(stripped)&&!/^\d/.test(stripped)){cityIndex=i;break;}
 }
 if(cityIndex<1)return{streetAddress:address,city:''};
 return{streetAddress:parts.slice(0,cityIndex).join(', '),city:parts[cityIndex].replace(/\bUT\b.*$/i,'').replace(/\b\d{5}(?:-\d{4})?\b.*$/,'').trim()};
}

export async function fetchUtahCandidates():Promise<UtahCandidate[]>{
 const response=await fetch(SOURCE_URL,{headers:{Accept:'text/html,application/xhtml+xml','User-Agent':'GeoWeedo/0.7 (https://geoweedo.com)','Accept-Language':'en-US,en;q=0.9'},cache:'no-store',signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw new Error(`Utah medical cannabis pharmacy page returned ${response.status}.`);
 const html=await response.text();
 const start=html.search(/Medical cannabis pharmacy locations/i),delivery=html.search(/Home delivery services/i);
 if(start<0)throw new Error('Utah pharmacy page no longer contains the Medical cannabis pharmacy locations heading; refusing an unverified import.');
 const section=html.slice(start,delivery>start?delivery:html.length);
 const table=section.match(/<table[^>]*>([\s\S]*?)<\/table>/i)?.[1];
 if(!table)throw new Error('Utah pharmacy page no longer contains a recognizable pharmacy table; refusing an unverified import.');
 const rows:UtahCandidate[]=[];
 const tr=/<tr[^>]*>([\s\S]*?)<\/tr>/gi;let rowMatch:RegExpExecArray|null;
 while((rowMatch=tr.exec(table))!==null){
  const cells:Array<{text:string;html:string}>=[];const td=/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;let cellMatch:RegExpExecArray|null;
  while((cellMatch=td.exec(rowMatch[1]))!==null)cells.push({text:clean(cellMatch[1]),html:cellMatch[1]});
  if(cells.length<2||/pharmacy name/i.test(cells[0].text))continue;
  const name=cells[0].text,address=cells[1].text;if(!name||!address)continue;
  const parsed=addressParts(address);if(!parsed.city)continue;
  rows.push({name,streetAddress:parsed.streetAddress,city:parsed.city,region:'Utah',country:'USA',website:cells[2]?externalWebsite(cells[2].html):undefined,dataSource:'Utah UDAF Medical Cannabis Pharmacy Locations',sourceUrl:SOURCE_URL,sourceLicense:'Official Utah medical cannabis pharmacy locations published by the Utah Department of Health and Human Services Center for Medical Cannabis and regulated by the Utah Department of Agriculture and Food.',imageryStatus:'missing_coordinates'});
 }
 const unique=new Map<string,UtahCandidate>();for(const row of rows)unique.set(`${row.name}|${row.city}`.toLowerCase(),row);
 const result=Array.from(unique.values());
 if(result.length<15)throw new Error(`Utah official pharmacy page yielded only ${result.length} recognizable pharmacy locations; expected at least 15, refusing a likely partial or markup-mismatched import.`);
 return result;
}
