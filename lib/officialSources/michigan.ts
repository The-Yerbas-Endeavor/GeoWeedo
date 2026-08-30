import 'server-only';

type Row={name:string;streetAddress:string;city?:string;region:string;country:string;licenseNumber?:string;dataSource:string;sourceUrl:string;sourceLicense:string;imageryStatus:'missing_coordinates'};
type Dataset={module:'Adult_Use'|'Licenses';tab:'Adult_Use'|'Licenses';label:string;accept:(type:string,license:string)=>boolean};

const SOURCE='https://www.michigan.gov/cra/verify-a-license-1';
const HOSTS=['https://aca3.accela.com','https://aca-prod.accela.com'];
const DATASETS:Dataset[]=[
 {module:'Adult_Use',tab:'Adult_Use',label:'adult-use establishments',accept:(type,license)=>(/mari(?:j|h)uana\s+retailer/i.test(type)||/^AU-R-/i.test(license))},
 {module:'Licenses',tab:'Licenses',label:'medical marijuana facilities',accept:(type)=>/provisioning\s+center/i.test(type)},
];

function clean(value:unknown){return String(value??'').replace(/&amp;/g,'&').replace(/&#39;|&apos;/g,"'").replace(/&quot;/g,'"').replace(/&nbsp;/g,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();}
function key(value:string){return value.toLowerCase().replace(/[^a-z0-9]/g,'');}
function decodeHtml(value:string){return value.replace(/&amp;/g,'&').replace(/&#39;|&apos;/g,"'").replace(/&quot;/g,'"').replace(/&#x27;/g,"'").replace(/&#x2F;/g,'/');}
function pick(row:Record<string,string>,names:string[]){for(const name of names){const value=row[key(name)];if(value)return clean(value);}return '';}
function parseAddress(value:string){const address=clean(value);const match=address.match(/^(.*?)(?:,\s*|\s+)([A-Za-z .'-]{2,60}),?\s+MI\s+(\d{5}(?:-\d{4})?)(?:\s+United States)?$/i);return{streetAddress:address,city:match?.[2]?.trim()};}

function cookiesFrom(response:Response){const headers=response.headers as Headers&{getSetCookie?:()=>string[]};const raw=headers.getSetCookie?.()??(response.headers.get('set-cookie')?[response.headers.get('set-cookie')!]:[]);return raw.map(item=>item.split(';',1)[0]).filter(Boolean);}
function mergeCookies(current:string[],response:Response){const map=new Map(current.map(item=>[item.split('=',1)[0],item]));for(const item of cookiesFrom(response))map.set(item.split('=',1)[0],item);return Array.from(map.values());}
function hiddenFields(html:string){const values=new URLSearchParams();const input=/<input\b[^>]*>/gi;let match:RegExpExecArray|null;while((match=input.exec(html))!==null){const tag=match[0];const type=tag.match(/\btype=["']?([^"'\s>]+)/i)?.[1]?.toLowerCase()||'';if(type&&type!=='hidden')continue;const name=decodeHtml(tag.match(/\bname=["']([^"']+)["']/i)?.[1]||'');if(!name)continue;const value=decodeHtml(tag.match(/\bvalue=["']([^"']*)["']/i)?.[1]||'');values.set(name,value);}return values;}
function searchButton(html:string){const tags=html.match(/<(?:input|button)\b[^>]*>[\s\S]*?<\/button>|<input\b[^>]*>/gi)||[];for(const tag of tags){const label=clean(tag.match(/\bvalue=["']([^"']*)["']/i)?.[1]||tag);if(!/^search$/i.test(label)&&!/search all records/i.test(label))continue;const name=decodeHtml(tag.match(/\bname=["']([^"']+)["']/i)?.[1]||'');const value=decodeHtml(tag.match(/\bvalue=["']([^"']*)["']/i)?.[1]||'Search');if(name)return{name,value};}return{name:'ctl00$PlaceHolderMain$btnNewSearch',value:'Search'};}
function downloadAction(html:string){const anchors=html.match(/<a\b[^>]*>[\s\S]*?<\/a>/gi)||[];for(const anchor of anchors){if(!/Download\s+results/i.test(clean(anchor)))continue;const href=decodeHtml(anchor.match(/\bhref=["']([^"']+)["']/i)?.[1]||'');const onclick=decodeHtml(anchor.match(/\bonclick=["']([^"']+)["']/i)?.[1]||'');const script=`${href} ${onclick}`;const post=script.match(/__doPostBack\(['"]([^'"]+)['"],\s*['"]([^'"]*)['"]\)/i);if(post)return{kind:'post' as const,target:post[1],argument:post[2]};if(href&&!/^javascript:/i.test(href))return{kind:'get' as const,href};}return null;}

function parseCsv(csv:string){const records:string[][]=[];let row:string[]=[],cell='',quoted=false;const text=csv.replace(/^\uFEFF/,'');for(let i=0;i<text.length;i++){const ch=text[i];if(ch==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;continue;}if(ch===','&&!quoted){row.push(cell.trim());cell='';continue;}if((ch==='\n'||ch==='\r')&&!quoted){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(cell.trim());cell='';if(row.some(value=>value))records.push(row);row=[];continue;}cell+=ch;}row.push(cell.trim());if(row.some(value=>value))records.push(row);if(records.length<2)return[];const headers=records[0].map(key);return records.slice(1).map(cells=>{const out:Record<string,string>={};headers.forEach((header,index)=>{out[header]=cells[index]??'';});return out;});}

async function request(url:string,init:RequestInit,cookies:string[]){const headers=new Headers(init.headers);headers.set('User-Agent','Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36');headers.set('Accept-Language','en-US,en;q=0.9');if(cookies.length)headers.set('Cookie',cookies.join('; '));return fetch(url,{...init,headers,cache:'no-store',redirect:'follow',signal:AbortSignal.timeout(25000)});}

async function downloadDataset(host:string,dataset:Dataset){const url=`${host}/MIMM/Cap/CapHome.aspx?TabName=${dataset.tab}&module=${dataset.module}`;let cookies:string[]=[];const initial=await request(url,{headers:{Accept:'text/html,application/xhtml+xml'}},cookies);cookies=mergeCookies(cookies,initial);if(!initial.ok)throw new Error(`${dataset.label} initial Accela page returned ${initial.status}`);const initialHtml=await initial.text();if(!/__VIEWSTATE|ACA_CS_FIELD/i.test(initialHtml))throw new Error(`${dataset.label} Accela page did not expose a searchable public form`);

 const form=hiddenFields(initialHtml),button=searchButton(initialHtml);form.set(button.name,button.value);form.set('ctl00$PlaceHolderMain$ddlSearchType',form.get('ctl00$PlaceHolderMain$ddlSearchType')||'0');
 const search=await request(url,{method:'POST',headers:{Accept:'text/html,application/xhtml+xml','Content-Type':'application/x-www-form-urlencoded',Origin:host,Referer:url},body:form.toString()},cookies);cookies=mergeCookies(cookies,search);if(!search.ok)throw new Error(`${dataset.label} blank Accela search returned ${search.status}`);const searchHtml=await search.text();const action=downloadAction(searchHtml);if(!action)throw new Error(`${dataset.label} blank Accela search did not expose the official Download results action`);

 let download:Response;
 if(action.kind==='get')download=await request(new URL(action.href,url).toString(),{headers:{Accept:'text/csv,application/csv,text/plain,*/*',Referer:url}},cookies);
 else{const fields=hiddenFields(searchHtml);fields.set('__EVENTTARGET',action.target);fields.set('__EVENTARGUMENT',action.argument);download=await request(url,{method:'POST',headers:{Accept:'text/csv,application/csv,text/plain,*/*','Content-Type':'application/x-www-form-urlencoded',Origin:host,Referer:url},body:fields.toString()},cookies);}
 if(!download.ok)throw new Error(`${dataset.label} Download results returned ${download.status}`);const csv=await download.text();if(/^\s*</.test(csv))throw new Error(`${dataset.label} Download results returned HTML instead of CSV`);const rows=parseCsv(csv);if(!rows.length)throw new Error(`${dataset.label} Download results CSV contained no records`);return rows;}

async function officialDownload(dataset:Dataset){const errors:string[]=[];for(const host of HOSTS){try{return await downloadDataset(host,dataset);}catch(error){errors.push(`${new URL(host).host}: ${error instanceof Error?error.message:String(error)}`);}}throw new Error(errors.join(' ; '));}

export async function fetchMichiganCandidates():Promise<Row[]>{
 const results=await Promise.allSettled(DATASETS.map(dataset=>officialDownload(dataset)));
 const failures=results.map((result,index)=>result.status==='rejected'?`${DATASETS[index].label}: ${result.reason instanceof Error?result.reason.message:String(result.reason)}`:'').filter(Boolean);
 if(failures.length)throw new Error(`Michigan CRA official Accela license-download workflow failed. ${failures.join(' | ')}`);

 const rows:Row[]=[];
 for(let index=0;index<DATASETS.length;index++){
  const dataset=DATASETS[index],records=(results[index] as PromiseFulfilledResult<Record<string,string>[]>).value;
  for(const record of records){
   const status=pick(record,['Status','Record Status','License Status']);
   if(!/^active$/i.test(status))continue;
   const licenseNumber=pick(record,['Record Number','License Number','License #','Record #']);
   const recordType=pick(record,['Record Type','License Type','Type']);
   if(!dataset.accept(recordType,licenseNumber))continue;
   const name=pick(record,['Licensee Name','License Name','Business Name','Name','DBA Name']);
   const address=pick(record,['Address','Street Address','Facility Address','Physical Address']);
   if(!name||!address||!licenseNumber)continue;
   const parsed=parseAddress(address);
   rows.push({name,streetAddress:parsed.streetAddress,city:parsed.city,region:'Michigan',country:'USA',licenseNumber,dataSource:'Michigan CRA Accela License Download',sourceUrl:SOURCE,sourceLicense:'Official Michigan Cannabis Regulatory Agency Verify a License database export; Active adult-use Marijuana Retailer and medical Provisioning Center license records only.',imageryStatus:'missing_coordinates'});
  }
 }
 const unique=new Map<string,Row>();for(const row of rows)if(!unique.has(row.licenseNumber!.toLowerCase()))unique.set(row.licenseNumber!.toLowerCase(),row);
 if(!unique.size)throw new Error('Michigan CRA official Accela downloads completed but yielded zero Active Marijuana Retailer or Provisioning Center records; refusing an unverified import.');
 return Array.from(unique.values());
}
