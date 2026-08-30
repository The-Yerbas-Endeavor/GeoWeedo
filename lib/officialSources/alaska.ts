export type AlaskaCandidate={name:string;streetAddress?:string;city?:string;region:string;country:string;licenseNumber?:string;dataSource:string;sourceUrl:string;sourceLicense:string;imageryStatus:'missing_coordinates'};

const SEARCH_URL='https://www.commerce.alaska.gov/abc/marijuana/Home/licensesearch';
const SEARCH_POST_URL='https://www.commerce.alaska.gov/abc/marijuana/Home/licensesearch';

function decode(value:string){return value.replace(/&amp;/g,'&').replace(/&#39;|&apos;/g,"'").replace(/&quot;/g,'"').replace(/&nbsp;/g,' ').replace(/&#8211;|&ndash;/g,'–').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();}
function hidden(html:string,name:string){const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');const m=html.match(new RegExp(`<input[^>]+name=["']${escaped}["'][^>]+value=["']([^"']*)["']`,'i'));return m?.[1]?.replace(/&amp;/g,'&')||'';}
function parseAddress(text:string){const m=text.match(/Physical Address:\s*(\d{1,6}\s+[^\n]{2,100}?)\s+([A-Za-z .'-]+),\s*AK\s+\d{5}(?:-\d{4})?/i);return m?{streetAddress:m[1].trim(),city:m[2].trim()}:{};}

async function detail(url:string,licenseNumber:string,name:string):Promise<AlaskaCandidate|null>{
 const response=await fetch(url,{headers:{Accept:'text/html,application/xhtml+xml','User-Agent':'GeoWeedo/0.7 (https://geoweedo.com)'},cache:'no-store',signal:AbortSignal.timeout(30000)});if(!response.ok)return null;const text=decode(await response.text());if(!/License Status:\s*Active-Operating/i.test(text)||!/License Type:\s*Retail Marijuana Store/i.test(text))return null;const address=parseAddress(text);return{name,streetAddress:address.streetAddress,city:address.city,region:'Alaska',country:'USA',licenseNumber,dataSource:'Alaska AMCO Marijuana License Search',sourceUrl:SEARCH_URL,sourceLicense:'Official Alaska Alcohol & Marijuana Control Office license search; Active-Operating Retail Marijuana Store licenses only.',imageryStatus:'missing_coordinates'};
}

export async function fetchAlaskaCandidates():Promise<AlaskaCandidate[]>{
 const first=await fetch(SEARCH_URL,{headers:{Accept:'text/html,application/xhtml+xml','User-Agent':'GeoWeedo/0.7 (https://geoweedo.com)'},cache:'no-store',signal:AbortSignal.timeout(30000)});if(!first.ok)throw new Error(`Alaska AMCO license search returned ${first.status}`);const html=await first.text();
 // AMCO's public search is an ASP.NET form. Submit the Retail Marijuana Store filter while preserving anti-forgery/form state when present.
 const form=new URLSearchParams();for(const name of ['__RequestVerificationToken','__VIEWSTATE','__VIEWSTATEGENERATOR','__EVENTVALIDATION']){const value=hidden(html,name);if(value)form.set(name,value);}form.set('LicenseType','Retail Marijuana Store');form.set('licenseType','Retail Marijuana Store');form.set('LicenseNumber','');form.set('DoingBusinessAs','');form.set('BusinessLicenseNumber','');form.set('PhysicalAddress','');
 const response=await fetch(SEARCH_POST_URL,{method:'POST',headers:{Accept:'text/html,application/xhtml+xml','Content-Type':'application/x-www-form-urlencoded','User-Agent':'GeoWeedo/0.7 (https://geoweedo.com)'},body:form.toString(),cache:'no-store',signal:AbortSignal.timeout(30000)});if(!response.ok)throw new Error(`Alaska AMCO retail-license search returned ${response.status}`);const resultHtml=await response.text();
 const links=[...resultHtml.matchAll(/href=["']([^"']*\/abc\/marijuana\/Home\/License\/[0-9a-f-]+)["'][^>]*>([\s\S]*?)<\/a>/gi)];const unique=new Map<string,{url:string;licenseNumber:string;name:string}>();
 for(const match of links){const url=new URL(match[1],SEARCH_URL).toString();const label=decode(match[2]);const around=decode(resultHtml.slice(Math.max(0,(match.index||0)-500),(match.index||0)+700));const licenseNumber=around.match(/(?:License\s*(?:#|Number)?\s*:?\s*)(\d{3,8})/i)?.[1]||label.match(/\b(\d{3,8})\b/)?.[1]||'';const name=around.match(/(?:Doing Business As|DBA)\s*:?\s*([A-Za-z0-9][A-Za-z0-9 &'.,/()-]{2,100}?)(?:\s+License|\s+Retail Marijuana Store|$)/i)?.[1]?.trim()||label.replace(/\b\d{3,8}\b/g,'').trim();if(licenseNumber&&name&&!unique.has(licenseNumber))unique.set(licenseNumber,{url,licenseNumber,name});}
 if(!unique.size)throw new Error('Alaska AMCO returned zero parseable retail-license results; refusing an unverified import.');
 const rows:AlaskaCandidate[]=[];for(const item of unique.values()){const row=await detail(item.url,item.licenseNumber,item.name);if(row)rows.push(row);}if(!rows.length)throw new Error('Alaska AMCO returned no Active-Operating Retail Marijuana Store records; refusing an unverified import.');return rows;
}
