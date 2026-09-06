import 'server-only';

type KentuckyCandidate={
  name:string;
  streetAddress:string;
  city:string;
  region:string;
  country:string;
  dataSource:string;
  sourceUrl:string;
  sourceLicense:string;
  imageryStatus:'missing_coordinates';
};

const SOURCE_URL='https://kymedcan.ky.gov/patients-and-caregivers/Pages/Find-A-Dispensary.aspx';

function clean(value:string){
  return value
    .replace(/&nbsp;|&#160;/gi,' ')
    .replace(/&amp;/gi,'&')
    .replace(/&quot;/gi,'"')
    .replace(/&#0*39;|&apos;/gi,"'")
    .replace(/&ndash;|&#8211;/gi,'–')
    .replace(/&mdash;|&#8212;/gi,'—')
    .replace(/<[^>]+>/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}

function preferredName(value:string){
  const dba=value.match(/\(\s*DBA\s*:\s*([^)]*)\)/i)?.[1]?.trim();
  if(dba)return dba;
  return value.replace(/\s*\([^)]*\)\s*$/,'').trim();
}

function parseAddress(value:string){
  const normalized=value.replace(/[.;]+$/,'').replace(/\s+/g,' ').trim();
  const match=normalized.match(/^(.*?),\s*([^,]+),\s*KY\s+(\d{5}(?:-\d{4})?)$/i);
  if(!match)return null;
  return {streetAddress:match[1].trim(),city:match[2].trim()};
}

export async function fetchKentuckyCandidates():Promise<KentuckyCandidate[]>{
  const response=await fetch(SOURCE_URL,{
    headers:{
      Accept:'text/html,application/xhtml+xml',
      'User-Agent':'GeoWeedo/0.7 (https://geoweedo.com)',
      'Accept-Language':'en-US,en;q=0.9'
    },
    cache:'no-store',
    signal:AbortSignal.timeout(30000)
  });
  if(!response.ok)throw new Error(`Kentucky Medical Cannabis dispensary page returned ${response.status}.`);

  const html=await response.text();
  const updatesIndex=html.search(/Dispensary Updates/i);
  const directoryIndex=html.search(/Dispensary Directory/i);
  if(updatesIndex<0||directoryIndex<=updatesIndex){
    throw new Error('Kentucky dispensary page no longer contains the expected Dispensary Updates section; refusing an unverified import.');
  }

  const section=html.slice(updatesIndex,directoryIndex);
  const rows:KentuckyCandidate[]=[];
  const li=/<li[^>]*>([\s\S]*?)<\/li>/gi;
  let match:RegExpExecArray|null;
  while((match=li.exec(section))!==null){
    const text=clean(match[1]);
    const located=text.match(/^(.*?),\s*located at\s+(.+?);\s*open since\b/i);
    if(!located)continue;
    const name=preferredName(located[1]);
    const address=parseAddress(located[2]);
    if(!name||!address)continue;
    rows.push({
      name,
      streetAddress:address.streetAddress,
      city:address.city,
      region:'Kentucky',
      country:'USA',
      dataSource:'Kentucky Medical Cannabis Program Dispensary Updates',
      sourceUrl:SOURCE_URL,
      sourceLicense:'Official Kentucky Medical Cannabis Program list of dispensaries confirmed open and operating.',
      imageryStatus:'missing_coordinates'
    });
  }

  const unique=new Map<string,KentuckyCandidate>();
  for(const row of rows)unique.set(`${row.name}|${row.streetAddress}|${row.city}`.toLowerCase(),row);
  const result=Array.from(unique.values());
  if(result.length<20){
    throw new Error(`Kentucky official dispensary page yielded only ${result.length} recognizable open dispensaries; expected at least 20, refusing a likely partial or markup-mismatched import.`);
  }
  return result;
}
