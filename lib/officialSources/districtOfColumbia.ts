import 'server-only';

type Row={
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

const SOURCE='https://abca.dc.gov/service/find-medical-cannabis-retailer';

function decode(value:string){
  return value
    .replace(/&amp;/g,'&')
    .replace(/&#0*39;|&apos;|&#x27;/gi,"'")
    .replace(/&quot;/g,'"')
    .replace(/&nbsp;|&#160;/gi,' ')
    .replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCharCode(parseInt(n,16)));
}

function linesFromHtml(html:string){
  const separated=html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ')
    .replace(/<br\s*\/?\s*>/gi,'\n')
    .replace(/<\/(?:p|div|li|h[1-6]|tr|td|th|section|article|ul|ol)>/gi,'\n')
    .replace(/<[^>]+>/g,' ');
  return decode(separated)
    .split(/\n+/)
    .map(line=>line.replace(/\s+/g,' ').trim())
    .filter(Boolean);
}

function isWard(line:string){return /^Ward\s+[1-8]\b/i.test(line);}
function isAddress(line:string){
  return /^\d{2,5}\s+.+\b(?:NW|NE|SW|SE)\b(?:,?\s*Washington)?(?:,?\s*DC)?(?:\s+\d{5})?\s*$/i.test(line);
}
function cleanAddress(line:string){
  return line
    .replace(/,?\s*Washington\s*,?\s*DC(?:\s+\d{5})?\s*$/i,'')
    .replace(/\s+/g,' ')
    .trim();
}
function plausibleName(line:string){
  return line.length>=2&&line.length<=120&&!isWard(line)&&!isAddress(line)&&!/^(Internet Retailers|Online Only|Retailers that have been verified|Find a licensed retailer|Report an illegal)/i.test(line);
}

export async function fetchDistrictOfColumbiaCandidates():Promise<Row[]>{
  const response=await fetch(SOURCE,{
    headers:{
      Accept:'text/html,application/xhtml+xml',
      'User-Agent':'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
      'Accept-Language':'en-US,en;q=0.9'
    },
    cache:'no-store',
    signal:AbortSignal.timeout(30000)
  });
  if(!response.ok)throw new Error(`District of Columbia ABCA retailer page returned ${response.status}.`);

  const html=await response.text();
  if(!/Only ABCA licensed medical cannabis Retailers are included/i.test(html)&&!/Retailers that have been verified as operational/i.test(html)){
    throw new Error('District of Columbia ABCA page no longer confirms the licensed operational retailer roster; refusing an unverified import.');
  }

  const lines=linesFromHtml(html);
  const rows:Row[]=[];
  let ward='';
  let pendingName='';
  let inPhysicalSection=false;

  for(const line of lines){
    if(isWard(line)){
      ward=line.match(/^Ward\s+[1-8]\b/i)?.[0]||line;
      inPhysicalSection=true;
      pendingName='';
      continue;
    }
    if(!inPhysicalSection)continue;
    if(/^Internet Retailers\b/i.test(line)){inPhysicalSection=false;pendingName='';continue;}
    if(isAddress(line)){
      if(pendingName){
        rows.push({
          name:pendingName,
          streetAddress:cleanAddress(line),
          city:'Washington',
          region:'District of Columbia',
          country:'USA',
          dataSource:'District of Columbia ABCA Licensed Medical Cannabis Retailers',
          sourceUrl:SOURCE,
          sourceLicense:`Official District of Columbia Alcoholic Beverage and Cannabis Administration operational physical medical cannabis retailer roster (${ward||'ward not stated'}). Internet-only retailers are excluded.`,
          imageryStatus:'missing_coordinates'
        });
      }
      pendingName='';
      continue;
    }
    if(plausibleName(line))pendingName=line;
  }

  const unique=new Map<string,Row>();
  for(const row of rows){
    const key=`${row.name.toLowerCase()}|${row.streetAddress.toLowerCase()}`;
    if(!unique.has(key))unique.set(key,row);
  }
  if(unique.size<10)throw new Error(`District of Columbia ABCA parser found only ${unique.size} physical retailer record(s); refusing a likely partial import.`);
  return Array.from(unique.values());
}
