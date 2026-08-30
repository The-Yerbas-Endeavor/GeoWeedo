export type VirginiaCandidate={name:string;streetAddress?:string;city?:string;region:string;country:string;website?:string;dataSource:string;sourceUrl:string;sourceLicense:string;imageryStatus:'missing_coordinates'};

const SOURCE_URL='https://cca.virginia.gov/medicalcannabis/dispensaries';

function decode(value:string){return value.replace(/&amp;/g,'&').replace(/&#39;|&apos;/g,"'").replace(/&quot;/g,'"').replace(/&nbsp;/g,' ').replace(/&#8211;|&ndash;/g,'–').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();}

export async function fetchVirginiaCandidates():Promise<VirginiaCandidate[]>{
  const response=await fetch(SOURCE_URL,{headers:{Accept:'text/html,application/xhtml+xml','User-Agent':'GeoWeedo/0.5 (https://geoweedo.com)'},cache:'no-store',signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw new Error(`Virginia CCA returned ${response.status}`);
  const html=await response.text();
  const text=decode(html);
  const rows:VirginiaCandidate[]=[];
  // CCA publishes the complete licensed medical-dispensary list as name followed by a Virginia postal address.
  const rx=/((?:Beyond Hello|RISE|Cannabist|gLeaf|Zen Leaf)\s+[A-Za-z0-9 .&'/-]{2,70})\s+(\d{1,6}\s+[A-Za-z0-9 .,'#/-]+?)\s+([A-Za-z .'-]+),\s*VA\s+(\d{5})/gi;
  let match:RegExpExecArray|null;
  while((match=rx.exec(text))!==null){
    const name=match[1].trim(),streetAddress=match[2].trim(),city=match[3].trim();
    if(rows.some(row=>row.name.toLowerCase()===name.toLowerCase()&&row.streetAddress?.toLowerCase()===streetAddress.toLowerCase()))continue;
    rows.push({name,streetAddress,city,region:'Virginia',country:'USA',dataSource:'Virginia CCA Licensed Medical Cannabis Dispensaries',sourceUrl:SOURCE_URL,sourceLicense:'Official Virginia Cannabis Control Authority list of all licensed medical cannabis dispensaries; physical dispensing locations only.',imageryStatus:'missing_coordinates'});
  }
  if(!rows.length)throw new Error('Virginia CCA returned zero parseable licensed dispensary locations; refusing a partial or unverified import.');
  return rows;
}
