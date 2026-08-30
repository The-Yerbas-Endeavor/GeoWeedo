import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/adminAuth';
import { listPendingReviews, moderateReview } from '@/lib/dispensaryCommunity';

export const runtime='nodejs';
export async function GET(request:NextRequest){const admin=getAdminFromRequest(request);if(!admin||(!admin.permissions.includes('locations.manage')&&admin.role!=='admin'))return NextResponse.json({error:'Forbidden'},{status:403});return NextResponse.json({reviews:listPendingReviews()});}
export async function POST(request:NextRequest){const admin=getAdminFromRequest(request);if(!admin||(!admin.permissions.includes('locations.manage')&&admin.role!=='admin'))return NextResponse.json({error:'Forbidden'},{status:403});const body=await request.json().catch(()=>null);const reviewId=String(body?.reviewId||''),status=body?.status==='approved'?'approved':body?.status==='rejected'?'rejected':null;if(!reviewId||!status)return NextResponse.json({error:'reviewId and approved/rejected status are required.'},{status:400});return NextResponse.json({ok:true,...moderateReview(reviewId,status)});}
