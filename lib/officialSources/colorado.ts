import 'server-only';

type ColoradoCandidate = {
  name: string;
  streetAddress?: string;
  city?: string;
  region: string;
  country: string;
  latitude?: number;
  longitude?: number;
  website?: string;
  licenseNumber?: string;
  dataSource: string;
  sourceUrl: string;
  sourceLicense: string;
  imageryStatus: 'unchecked' | 'missing_coordinates';
};

const SOURCE_PAGE='https://med.colorado.gov/licensee-information-and-lookup-tool/licensed-facilities';
const SHEET_ID='1PqYThJJwGEsrwWvciu9vXosuC0BzAw4YtD03RvlSKzE';
const CSV_URL=`https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=0`;
const SOURCE_NAME='Colorado MED Licensed Marijuana Stores';
const SOURCE_LICENSE='Official Colorado Marijuana Enforcement Division licensed-facilities store list; MED states facility lists are updated monthly.';

function clean(value:unknown){return String(value??'').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();}
function normalized(value:string){return clean(value).toLowerCase().replace(/[^a-z0-9]+/g,'');}

function parseCsv(text:string):string[][]{
  const rows:string[][]=[];
  let row:string[]=[];
  let field='';
  let quoted=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(quoted){
      if(ch==='"'&&text[i+1]==='"'){field+='"';i++;continue;}
      if(ch==='"'){quoted=false;continue;}
      field+=ch;
      continue;
    }
    if(ch==='"'){quoted=true;continue;}
    if(ch===','){row.push(field);field='';continue;}
    if(ch==='\n'){
      row.push(field.replace(/\r$/,''));
      rows.push(row);
      row=[];
      field='';
      continue;
    }
    field+=ch;
  }
  if(field.length||row.length){row.push(field.replace(/\r$/,''));rows.push(row);}
  return rows;
}

function headerIndex(headers:string[],name:string){const needle=normalized(name);return headers.findIndex(header=>normalized(header)===needle);}
function value(row:string[],index:number){return index>=0?clean(row[index]):'';}
function locationKey(street:string,city:string){return `${normalized(street)}|${normalized(city)}`;}

export async function fetchColoradoCandidates():Promise<ColoradoCandidate[]>{
  let response:Response;
  try{
    response=await fetch(CSV_URL,{headers:{Accept:'text/csv,text/plain;q=0.9,*/*;q=0.8','User-Agent':'GeoWeedo/0.5 (https://geoweedo.yerbas.org)'},cache:'no-store',signal:AbortSignal.timeout(30000)});
  }catch(error){
    throw new Error(`Colorado MED store-list connection failed: ${error instanceof Error?error.message:String(error)}`);
  }
  if(!response.ok)throw new Error(`Colorado MED store list returned ${response.status}.`);
  const text=await response.text();
  if(!text.includes('License Number')||!text.includes('Facility Type'))throw new Error('Colorado MED store list returned an unexpected spreadsheet format.');

  const table=parseCsv(text).filter(row=>row.some(cell=>clean(cell)));
  const headers=(table.shift()||[]).map(clean);
  const licenseIndex=headerIndex(headers,'License Number');
  const facilityIndex=headerIndex(headers,'Facility Name');
  const dbaIndex=headerIndex(headers,'DBA');
  const typeIndex=headerIndex(headers,'Facility Type');
  const streetIndex=headerIndex(headers,'Street');
  const cityIndex=headerIndex(headers,'City');
  const zipIndex=headerIndex(headers,'ZIP Code');
  const expirationIndex=headerIndex(headers,'Expiration Date');
  const updatedIndex=headerIndex(headers,'Date Updated');
  if([licenseIndex,facilityIndex,typeIndex,streetIndex,cityIndex].some(index=>index<0))throw new Error('Colorado MED store list is missing required columns.');

  type Parsed={candidate:ColoradoCandidate;type:string;expiration:string;updated:string};
  const byLocation=new Map<string,Parsed>();
  for(const row of table){
    const type=value(row,typeIndex);
    if(!/^(?:Medical|Retail) Marijuana Store$/i.test(type))continue;
    const street=value(row,streetIndex);
    const city=value(row,cityIndex);
    const facility=value(row,facilityIndex);
    const dba=value(row,dbaIndex);
    const licenseNumber=value(row,licenseIndex);
    if(!street||!city||(!dba&&!facility))continue;
    const zip=value(row,zipIndex);
    const candidate:ColoradoCandidate={
      name:dba||facility,
      streetAddress:street,
      city,
      region:'Colorado',
      country:'USA',
      licenseNumber:licenseNumber||undefined,
      dataSource:SOURCE_NAME,
      sourceUrl:SOURCE_PAGE,
      sourceLicense:SOURCE_LICENSE,
      imageryStatus:'missing_coordinates',
    };
    const parsed:Parsed={candidate,type,expiration:value(row,expirationIndex),updated:value(row,updatedIndex)};
    const key=locationKey(street,city);
    const existing=byLocation.get(key);
    // One GeoWeedo candidate per physical storefront. Prefer a retail license when
    // MED lists both retail and medical licenses at the same premises.
    if(!existing||(/Retail Marijuana Store/i.test(type)&&!/Retail Marijuana Store/i.test(existing.type)))byLocation.set(key,parsed);
    void zip;
  }

  const rows=Array.from(byLocation.values()).map(item=>item.candidate);
  // The MED sheet can contain separate medical and retail licenses at one address,
  // so the deduplicated physical-store count is lower than the raw license count.
  // Keep a corruption guard without assuming Colorado must always exceed 300 stores.
  if(rows.length<200)throw new Error(`Colorado MED store parser found only ${rows.length} physical storefronts; refusing a likely partial import.`);
  return rows;
}
