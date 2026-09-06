import 'server-only';

type NorthDakotaCandidate={name:string;streetAddress:string;city:string;region:string;country:string;phone?:string;website?:string;dataSource:string;sourceUrl:string;sourceLicense:string;imageryStatus:'missing_coordinates'};

const SOURCE_URL='https://www.hhs.nd.gov/mm/dispensary-locations';

function decode(value:string){return value.replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#0*39;|&apos;/gi,"'").replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();}

export async function fetchNorthDakotaCandidates():Promise<NorthDakotaCandidate[]>{
 const response=await fetch(SOURCE_URL,{headers:{Accept:'text/html,application/xhtml+xml','User-Agent':'GeoWeedo/0.7 (https://geoweedo.com)','Accept-Language':'en-US,en;q=0.9'},cache:'no-store',signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw new Error(`North Dakota HHS dispensary-locations page returned ${response.status}.`);
 const html=await response.text();
 const headings=[...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)];
 const rows:NorthDakotaCandidate[]=[];
 for(let i=0;i<headings.length;i++){
  const city=decode(headings[i][1]);
  if(!city||/dispensary locations/i.test(city))continue;
  const start=(headings[i].index??0)+headings[i][0].length;
  const end=i+1<headings.length?(headings[i+1].index??html.length):html.length;
  const block=html.slice(start,end);
  const h3=block.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
  if(!h3)continue;
  const name=decode(h3[1]);
  const plain=decode(block);
  const addressMatch=plain.match(/\b(\d{1,6}\s+.+?)(?=\s+\(\d{3}\)\s*\d{3}-\d{4}|\s+https?:\/\/|\s+www\.|\s+Store Hours\b)/i);
  const phoneMatch=plain.match(/\((\d{3})\)\s*(\d{3})-(\d{4})/);
  const hrefs=[...block.matchAll(/href=["']([^"']+)["']/gi)].map(m=>m[1]).filter(v=>/^https?:\/\//i.test(v)&&!v.includes('hhs.nd.gov'));
  const streetAddress=addressMatch?.[1]?.trim();
  if(!name||!streetAddress)continue;
  rows.push({name,streetAddress,city,region:'North Dakota',country:'USA',phone:phoneMatch?`(${phoneMatch[1]}) ${phoneMatch[2]}-${phoneMatch[3]}`:undefined,website:hrefs[0],dataSource:'North Dakota HHS Medical Marijuana Dispensary Locations',sourceUrl:SOURCE_URL,sourceLicense:'Official North Dakota Health and Human Services Medical Marijuana Program registered dispensary locations.',imageryStatus:'missing_coordinates'});
 }
 const unique=new Map<string,NorthDakotaCandidate>();
 for(const row of rows)unique.set(`${row.name}|${row.city}`.toLowerCase(),row);
 const result=[...unique.values()];
 if(result.length!==8)throw new Error(`North Dakota HHS page yielded ${result.length} recognizable dispensaries; expected the 8 registered dispensaries published by the state, refusing a likely partial or markup-mismatched import.`);
 return result;
}
