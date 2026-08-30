import {NextRequest,NextResponse} from 'next/server';
import {getAdminFromRequest} from '@/lib/adminAuth';
import {importCandidates} from '@/lib/candidateStore';
import {fetchAmsterdamCoffeeshopCandidates} from '@/lib/officialSources/amsterdam';
export const runtime='nodejs';
export async function POST(request:NextRequest){if(!getAdminFromRequest(request))return NextResponse.json({error:'Unauthorized.'},{status:401});try{const fetched=await fetchAmsterdamCoffeeshopCandidates();const rows=fetched.rows;const result=await importCandidates(rows as any[]);const geocoded=rows.filter(r=>Number.isFinite(r.latitude)&&Number.isFinite(r.longitude)).length;return NextResponse.json({ok:true,source:fetched.sourceLabel,sourceType:fetched.source,warning:fetched.warning||null,fetched:rows.length,added:result.added,geocoded,total:result.total},{status:201});}catch(error){const message=error instanceof Error?error.message:String(error);return NextResponse.json({ok:false,error:message},{status:502});}}
