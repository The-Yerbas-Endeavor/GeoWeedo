import 'server-only';

type Row={name:string;city:string;region:string;country:string;dataSource:string;sourceUrl:string;sourceLicense:string;imageryStatus:'missing_coordinates'};

const SOURCE='https://doh.sd.gov/programs/medical-cannabis/med-cannabis-establishments/establishments-list/';

function clean(value:string){return value.replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&#0*39;|&apos;/gi,"'").replace(/&quot;/gi,'"').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();}
function headingBounds(html:string,label:string){
 const re=/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/gi;
 let match:RegExpExecArray|null;
 while((match=re.exec(html))!==null){
  if(clean(match[1]).toLowerCase()===label.toLowerCase())return{start:match.index,end:match.index+match[0].length};
 }
 return null;
}

export async function fetchSouthDakotaCandidates():Promise<Row[]>{
 const response=await fetch(SOURCE,{headers:{Accept:'text/html,application/xhtml+xml','User-Agent':'GeoWeedo/0.7 (https://geoweedo.com)','Accept-Language':'en-US,en;q=0.9'},cache:'no-store',signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw new Error(`South Dakota DOH establishments list returned ${response.status}.`);
 const html=await response.text();
 const dispensaryHeading=headingBounds(html,'Dispensary Establishments');
 const manufacturingHeading=headingBounds(html,'Manufacturing Establishments');
 if(!dispensaryHeading||!manufacturingHeading||manufacturingHeading.start<=dispensaryHeading.end)throw new Error('South Dakota DOH page no longer contains recognizable dispensary/manufacturing headings; refusing an unverified import.');
 const section=html.slice(dispensaryHeading.end,manufacturingHeading.start),rows:Row[]=[];
 const tr=/<tr[^>]*>([\s\S]*?)<\/tr>/gi;let match:RegExpExecArray|null;
 while((match=tr.exec(section))!==null){
  const cells:string[]=[];const td=/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;let cell:RegExpExecArray|null;
  while((cell=td.exec(match[1]))!==null)cells.push(clean(cell[1]));
  if(cells.length<3||/legal name/i.test(cells[0]))continue;
  const legal=cells[0],dba=cells[1],city=cells[2],name=dba||legal;
  if(!name||!city)continue;
  rows.push({name,city,region:'South Dakota',country:'USA',dataSource:'South Dakota DOH Medical Cannabis Establishments List',sourceUrl:SOURCE,sourceLicense:'Official South Dakota Department of Health Medical Cannabis Program dispensary establishments list; legal name, doing-business-as name, and city are published by the state. Street addresses and coordinates are completed through GeoWeedo Automated Enrichment.',imageryStatus:'missing_coordinates'});
 }
 if(rows.length<55)throw new Error(`South Dakota DOH establishments page yielded only ${rows.length} dispensary rows; refusing a likely partial or markup-mismatched import.`);
 return rows;
}
