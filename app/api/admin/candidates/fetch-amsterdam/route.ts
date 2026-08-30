import {NextRequest,NextResponse} from 'next/server';
import {getAdminFromRequest} from '@/lib/adminAuth';
import {importCandidates} from '@/lib/candidateStore';
import {fetchAmsterdamCoffeeshopCandidates} from '@/lib/officialSources/amsterdam';
export const runtime='nodejs';
export async function POST(request:NextRequest){if(!getAdminFromRequest(request))return NextResponse.json({error:'Unauthorized.'},{status:401});try{const rows=await fetchAmsterdamCoffeeshopCandidates();if(!rows.length)throw new Error('Amsterdam official horeca data returned zero coffeeshop records.');const result=await importCandidates(rows as any[]);const geocoded=rows.filter(r=>Number.isFinite(r.latitude)&&Number.isFinite(r.longitude)).length;return NextResponse.json({ok:true,source:'Amsterdam · Gemeente Amsterdam',fetched:rows.length,added:result.added,geocoded,total:result.total},{status:201});}catch(error){return NextResponse.json({ok:false,error:error instanceof Error?error.message:String(error)},{status:502});}}
