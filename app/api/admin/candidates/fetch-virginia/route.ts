import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/adminAuth';
import { importCandidates } from '@/lib/candidateStore';
import { fetchVirginiaCandidates } from '@/lib/officialSources/virginia';

export const runtime='nodejs';

export async function POST(request:NextRequest){
  if(!getAdminFromRequest(request))return NextResponse.json({error:'Unauthorized.'},{status:401});
  try{
    const rows=await fetchVirginiaCandidates();
    const result=await importCandidates(rows as any[]);
    return NextResponse.json({ok:true,source:'Virginia CCA',fetched:rows.length,added:result.added,updated:result.updated,geocoded:0,total:result.total,sourceUrl:'https://cca.virginia.gov/medicalcannabis/dispensaries'},{status:201});
  }catch(error){
    return NextResponse.json({ok:false,source:'Virginia CCA',error:error instanceof Error?error.message:String(error)},{status:502});
  }
}
