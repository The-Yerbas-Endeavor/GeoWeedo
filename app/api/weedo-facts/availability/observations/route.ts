import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/userAuth';
import { recordProductAvailabilityObservation } from '@/lib/productAvailabilityObservations';
import { getPersistedQrScanForSighting } from '@/lib/weedoFactsQrPersistence';

export const runtime='nodejs';
export const dynamic='force-dynamic';

function text(value:unknown,max=500){return String(value??'').trim().slice(0,max);}

export async function POST(request:NextRequest){
  const user=getUserFromRequest(request);
  if(!user)return NextResponse.json({error:'Login required to report where you found a product.'},{status:401});

  const body=await request.json().catch(()=>null);
  if(!body||typeof body!=='object')return NextResponse.json({error:'Invalid JSON body.'},{status:400});

  const dispensaryId=text((body as any).dispensaryId,180);
  const productId=text((body as any).productId,180);
  const batchId=text((body as any).batchId,180)||null;
  const scanId=text((body as any).scanId,180);
  const requestedSource=text((body as any).sourceType,32).toLowerCase();
  const sourceType='scanner';
  const availabilityStatus=text((body as any).availabilityStatus,32).toLowerCase()||'seen';
  const priceRaw=(body as any).price;
  const price=priceRaw===null||priceRaw===undefined||String(priceRaw).trim()===''?null:Number(priceRaw);

  if(!dispensaryId||!productId)return NextResponse.json({error:'Dispensary and product are required.'},{status:400});
  if(!scanId)return NextResponse.json({error:'Scan this product QR before reporting where you saw it.'},{status:400});
  const recordedScan=getPersistedQrScanForSighting(scanId,productId,batchId);
  if(!recordedScan)return NextResponse.json({error:'This sighting must come from the recorded QR scan for this product.'},{status:400});
  if(!['seen','in_stock','carried','unavailable'].includes(availabilityStatus))return NextResponse.json({error:'Invalid availability status.'},{status:400});
  if(price!==null&&(!Number.isFinite(price)||price<0||price>100000))return NextResponse.json({error:'Price must be a valid non-negative amount.'},{status:400});

  try{
    const id=recordProductAvailabilityObservation({
      userId:user.id,
      dispensaryId,
      productId,
      batchId,
      sourceType,
      availabilityStatus:availabilityStatus as any,
      priceCents:price===null?null:Math.round(price*100),
      currency:'USD',
    });
    return NextResponse.json({ok:true,id,message:sourceType==='scanner'?'Scan location recorded.':'Product sighting recorded.'},{status:201});
  }catch(error){
    return NextResponse.json({error:error instanceof Error?error.message:'Could not save product sighting.'},{status:400});
  }
}
