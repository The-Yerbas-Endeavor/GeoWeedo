import 'server-only';

type HawaiiCandidate={name:string;streetAddress?:string;city?:string;region:string;country:string;dataSource:string;sourceUrl:string;sourceLicense:string;imageryStatus:'missing_coordinates'};

type PageSpec={url:string;operators:string[]};
const PAGES:PageSpec[]=[
 {url:'https://health.hawaii.gov/medicalcannabisregistry/hawaii-island-dispensary-locations/',operators:['Hawaiian Ethos','Big Island Grown']},
 {url:'https://health.hawaii.gov/medicalcannabisregistry/oahu-dispensary-locations/',operators:['Aloha Green','Cure Oahu','Noa Botanicals']},
 {url:'https://health.hawaii.gov/medicalcannabisregistry/maui-dispensary-locations/',operators:['Maui Grown Therapies','Pono Life Sciences Maui']},
 {url:'https://health.hawaii.gov/medicalcannabisregistry/kauai-dispensary-location/',operators:['Green Aloha']},
];

function decodeHtml(value:string){return value.replace(/<br\s*\/?\s*>/gi,'\n').replace(/<\/p>|<\/div>|<\/h[1-6]>|<\/li>/gi,'\n').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#0*39;|&apos;/gi,"'").replace(/&ndash;|&#8211;|&#x2013;/gi,'–').replace(/&mdash;|&#8212;|&#x2014;/gi,'—').replace(/\r/g,'').replace(/[ \t]+/g,' ').replace(/\n{2,}/g,'\n').trim();}
function clean(value:string){return value.replace(/\s+/g,' ').replace(/\s+,/g,',').trim();}
function cityFromAddress(address:string){const match=address.match(/,\s*([^,]+),\s*(?:HI|Hawaii)\s*,?\s*\d{5}\b/i);return match?clean(match[1]):undefined;}
function streetFromAddress(address:string){return clean(address.replace(/,\s*[^,]+,\s*(?:HI|Hawaii)\s*,?\s*\d{5}\b.*$/i,''));}

export async function fetchHawaiiCandidates():Promise<HawaiiCandidate[]>{
 const rows:HawaiiCandidate[]=[];
 for(const page of PAGES){
  const response=await fetch(page.url,{headers:{Accept:'text/html,application/xhtml+xml','User-Agent':'GeoWeedo/0.7 (https://geoweedo.com)'},cache:'no-store',signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw new Error(`Hawaii DOH dispensary page returned ${response.status}: ${page.url}`);
  const text=decodeHtml(await response.text());
  for(let i=0;i<page.operators.length;i++){
   const operator=page.operators[i];
   const start=text.toLowerCase().indexOf(operator.toLowerCase());
   if(start<0)continue;
   const next=page.operators.slice(i+1).map(name=>text.toLowerCase().indexOf(name.toLowerCase(),start+operator.length)).filter(pos=>pos>start).sort((a,b)=>a-b)[0];
   const section=text.slice(start+(operator.length),next??text.length);
   const lineRe=/([^\n]{1,60}?)\s*[–—-]\s*([^\n]*?\b(?:HI|Hawaii)\s*,?\s*\d{5}\b)/gi;
   let match:RegExpExecArray|null;
   while((match=lineRe.exec(section))!==null){
    const label=clean(match[1]);
    const address=clean(match[2]);
    const nearby=section.slice(Math.max(0,match.index-40),Math.min(section.length,lineRe.lastIndex+80));
    if(/permanently\s+closed/i.test(label)||/permanently\s+closed/i.test(nearby))continue;
    if(!/\d/.test(address))continue;
    const city=cityFromAddress(address);
    const streetAddress=streetFromAddress(address);
    rows.push({name:`${operator} - ${label}`,streetAddress,city,region:'Hawaii',country:'USA',dataSource:'Hawaii DOH Medical Cannabis Dispensary Locations',sourceUrl:page.url,sourceLicense:'Official Hawaii Department of Health Medical Cannabis Registry Program licensed dispensary location pages; locations explicitly marked permanently closed are excluded.',imageryStatus:'missing_coordinates'});
   }
  }
 }
 const unique=new Map<string,HawaiiCandidate>();
 for(const row of rows){const key=`${row.name}|${row.streetAddress||''}`.toLowerCase().replace(/[^a-z0-9|]/g,'');if(!unique.has(key))unique.set(key,row);}
 const result=Array.from(unique.values());
 if(result.length<15)throw new Error(`Hawaii DOH pages yielded only ${result.length} recognizable active dispensary locations; refusing a likely partial import.`);
 return result;
}
