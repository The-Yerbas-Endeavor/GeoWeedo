import {NextRequest,NextResponse} from 'next/server';
import {getAdminFromRequest} from '@/lib/adminAuth';
import {listCandidates,updateCandidate,type DispensaryCandidate} from '@/lib/candidateStore';

export const runtime='nodejs';
export const dynamic='force-dynamic';

const AMSTERDAM_BOUNDS={minLat:52.278,maxLat:52.431,minLng:4.728,maxLng:5.016};
const NON_COFFEESHOP=/\b(head\s*shop|smart\s*shop|grow\s*shop|seed\s*bank|cbd\s*shop|vape\s*shop|souvenir|tattoo|pharmacy)\b/i;
const GENERIC=/^(amsterdam\s+)?coffeeshop$/i;

function norm(value?:string){return String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();}
function hasCoords(item:DispensaryCandidate){return Number.isFinite(item.latitude)&&Number.isFinite(item.longitude);}
function inAmsterdam(item:DispensaryCandidate){return hasCoords(item)&&(item.latitude as number)>=AMSTERDAM_BOUNDS.minLat&&(item.latitude as number)<=AMSTERDAM_BOUNDS.maxLat&&(item.longitude as number)>=AMSTERDAM_BOUNDS.minLng&&(item.longitude as number)<=AMSTERDAM_BOUNDS.maxLng;}
function isAmsterdam(item:DispensaryCandidate){return /amsterdam/i.test(item.city||'')&&/netherlands/i.test(item.country||'')&&/amsterdam|openstreetmap/i.test(item.dataSource||'');}
function distanceMeters(a:DispensaryCandidate,b:DispensaryCandidate){if(!hasCoords(a)||!hasCoords(b))return Infinity;const r=6371000,p1=(a.latitude as number)*Math.PI/180,p2=(b.latitude as number)*Math.PI/180,dp=((b.latitude as number)-(a.latitude as number))*Math.PI/180,dl=((b.longitude as number)-(a.longitude as number))*Math.PI/180;const h=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;return 2*r*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));}

export async function POST(request:NextRequest){
 if(!getAdminFromRequest(request))return NextResponse.json({error:'Unauthorized.'},{status:401});
 const all=(await listCandidates()).filter(isAmsterdam).filter(i=>i.status==='candidate'||i.status==='reviewing');
 const summary={scanned:all.length,passed:0,review:0,rejected:0,duplicates:0,outOfBounds:0,nonCoffeeshop:0,genericNames:0,missingCoordinates:0,missingAddress:0};
 const rejectedIds:string[]=[],reviewIds:string[]=[],imageryIds:string[]=[];
 const keepers:DispensaryCandidate[]=[];

 for(const item of all){
  const name=norm(item.name),address=norm(item.streetAddress),city=norm(item.city);
  let reason='';
  if(NON_COFFEESHOP.test(item.name||'')){reason='Amsterdam validation: name strongly indicates a non-coffeeshop business.';summary.nonCoffeeshop++;}
  const duplicate=keepers.find(k=>{
   const sameName=name&&name===norm(k.name);if(!sameName)return false;
   const sameAddress=address&&address===norm(k.streetAddress)&&city===norm(k.city);
   return sameAddress||distanceMeters(item,k)<=18;
  });
  if(!reason&&duplicate){reason=`Amsterdam validation: probable duplicate of ${duplicate.name} (${duplicate.id}).`;summary.duplicates++;}
  if(reason){await updateCandidate(item.id,{status:'rejected',imageryMessage:reason});summary.rejected++;rejectedIds.push(item.id);continue;}
  keepers.push(item);

  const reviewReasons:string[]=[];
  if(!hasCoords(item)){reviewReasons.push('missing coordinates');summary.missingCoordinates++;}
  else if(!inAmsterdam(item)){reviewReasons.push('coordinates outside Amsterdam validation bounds');summary.outOfBounds++;}
  if(GENERIC.test(item.name||'')){reviewReasons.push('generic name needs verification');summary.genericNames++;}
  if(!item.streetAddress?.trim()){reviewReasons.push('street address missing');summary.missingAddress++;}
  if(reviewReasons.length){await updateCandidate(item.id,{status:'reviewing',imageryMessage:`Amsterdam validation: ${reviewReasons.join('; ')}.`});summary.review++;reviewIds.push(item.id);continue;}

  if(item.status==='reviewing')await updateCandidate(item.id,{status:'candidate'});
  summary.passed++;imageryIds.push(item.id);
 }

 return NextResponse.json({ok:true,summary,rejectedIds,reviewIds,imageryIds},{headers:{'Cache-Control':'no-store, max-age=0'}});
}
