import 'server-only';
import 'pdf-parse/worker';
import { PDFParse } from 'pdf-parse';

type Row={name:string;streetAddress:string;city?:string;region:string;country:string;licenseNumber?:string;dataSource:string;sourceUrl:string;sourceLicense:string;imageryStatus:'missing_coordinates'};
const PAGE='https://www.michigan.gov/cra/resources/cannabis-regulatory-agency-licensing-reports/adult-use-marijuana-licensing-report/2026-adult-use-marijuana-licensing-reports';
function clean(s:string){return s.replace(/\s+/g,' ').trim();}
function decode(s:string){return s.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'");}
export async function fetchMichiganCandidates():Promise<Row[]>{
 const page=await fetch(PAGE,{headers:{'User-Agent':'GeoWeedo/0.7 (https://geoweedo.com)'},cache:'no-store',signal:AbortSignal.timeout(30000)});if(!page.ok)throw new Error(`Michigan CRA reports page returned ${page.status}`);const html=await page.text();
 const links=Array.from(html.matchAll(/href=["']([^"']+\.pdf[^"']*)["']/gi)).map(m=>decode(m[1])).filter(v=>/Licensing-Report|Adult-Use/i.test(v));if(!links.length)throw new Error('Michigan CRA exposed no current adult-use licensing report PDF.');
 const href=links[0].startsWith('http')?links[0]:new URL(links[0],'https://www.michigan.gov').toString();const response=await fetch(href,{headers:{Accept:'application/pdf','User-Agent':'GeoWeedo/0.7 (https://geoweedo.com)'},cache:'no-store',signal:AbortSignal.timeout(30000)});if(!response.ok)throw new Error(`Michigan CRA licensing report returned ${response.status}`);const buffer=Buffer.from(await response.arrayBuffer());const parser=new PDFParse({data:buffer});
 try{const result=await parser.getText();const text=result.text||'';const rows:Row[]=[];const re=/([^\n]{2,120})\n(AU-R-\d{6})[\s\S]{0,180}?Marihuana Retailer[^\n]*\n([^\n]{3,140})\n([^\n,]{2,60}),\s*MI\s*(\d{5})/gi;let m:RegExpExecArray|null;while((m=re.exec(text))!==null){const name=clean(m[1]),streetAddress=clean(`${m[3]}, ${m[4]}, MI ${m[5]}`);if(!name||!/\d/.test(streetAddress))continue;rows.push({name,streetAddress,city:clean(m[4]),region:'Michigan',country:'USA',licenseNumber:m[2].toUpperCase(),dataSource:'Michigan CRA Adult-Use Licensing Reports',sourceUrl:PAGE,sourceLicense:'Official Michigan Cannabis Regulatory Agency adult-use licensing report; Marihuana Retailer licenses only.',imageryStatus:'missing_coordinates'});}const unique=new Map(rows.map(r=>[r.licenseNumber||`${r.name}|${r.streetAddress}`,r]));if(!unique.size)throw new Error('Michigan CRA report contained no parseable Marihuana Retailer rows; refusing an unverified import.');return Array.from(unique.values());}finally{await parser.destroy();}
}
