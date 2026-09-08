import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { readApprovedDispensaries } from '@/lib/dispensaryStore';
import { ensureFinanceSchema, postSystemLedgerEntry } from '@/lib/financeLedger';
import { calculateDailyReward, getGameRewardPolicy, getGameplayRewardTimingStatus } from '@/lib/gameRewardPolicy';
import { getDatabase } from '@/lib/sqlite';
import { getUserFromRequest } from '@/lib/userAuth';

export const runtime = 'nodejs';
const ATOMIC = 100_000_000;

function dateKey() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
function hashString(input: string) { let h = 2166136261; for (let i = 0; i < input.length; i++) { h ^= input.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function distanceKm(a:{lat:number;lng:number},b:{lat:number;lng:number}) { const r=6371.0088,rad=(v:number)=>(v*Math.PI)/180,dLat=rad(b.lat-a.lat),dLng=rad(b.lng-a.lng),lat1=rad(a.lat),lat2=rad(b.lat),h=Math.sin(dLat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLng/2)**2; return r*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h)); }
function scoreFromDistance(km:number) { return Math.max(0,Math.min(5000,Math.round(5000*Math.exp(-km/500)))); }
function mapStatus(status:string) { if (status==='posted') return 'earned'; if (status==='held'||status==='pending') return 'pending_review'; return status; }

async function resolveDailyTarget(today:string) {
  const approved = (await readApprovedDispensaries()).filter((item)=>item.active && Number.isFinite(item.latitude) && Number.isFinite(item.longitude));
  if (!approved.length) return null;
  return { location:approved[hashString(`geoweedo-daily-enabled-${today}`)%approved.length], sponsored:false, sponsorshipId:null };
}

export async function POST(request:NextRequest) {
  const user=getUserFromRequest(request);
  if(!user||!user.walletId) return NextResponse.json({error:'Sign in to earn Daily Weedo rewards.'},{status:401});
  if(!user.rewardEligible) return NextResponse.json({error:'This account is not reward eligible.'},{status:403});
  const body=await request.json().catch(()=>null);
  const guessLat=Number(body?.guessLat),guessLng=Number(body?.guessLng);
  if(!Number.isFinite(guessLat)||guessLat < -90||guessLat > 90||!Number.isFinite(guessLng)||guessLng < -180||guessLng > 180) return NextResponse.json({error:'Invalid Daily Weedo guess.'},{status:400});

  const today=dateKey();
  const gameId=`daily-${today}-${user.id}`;
  const db=getDatabase();
  ensureFinanceSchema(db);
  const existing=db.prepare('SELECT id,user_id,total_score,reward_atomic,reward_status FROM games WHERE id=?').get(gameId) as any;
  if(existing){const ledger=db.prepare("SELECT status,amount_atomic FROM wallet_ledger WHERE wallet_id=? AND reference_type='game_reward' AND reference_id=? ORDER BY created_at LIMIT 1").get(user.walletId,gameId) as any;return NextResponse.json({gameId,date:today,totalScore:Number(existing.total_score||0),amountYerb:Number(ledger?.amount_atomic||existing.reward_atomic||0)/ATOMIC,status:mapStatus(String(ledger?.status||existing.reward_status||'not_eligible')),duplicate:true});}

  const daily=await resolveDailyTarget(today);
  if(!daily) return NextResponse.json({error:'No enabled Daily Weedo target is available.'},{status:503});
  const km=distanceKm({lat:guessLat,lng:guessLng},{lat:Number(daily.location.latitude),lng:Number(daily.location.longitude)});
  const score=scoreFromDistance(km);
  const policy=getGameRewardPolicy();
  const timing=getGameplayRewardTimingStatus(user.walletId,policy);
  const blockedStatus=!policy.enabled?'rewards_disabled':!policy.dailyEnabled?'mode_disabled':!timing.allowed?timing.reason:null;
  const now=new Date().toISOString();

  if(blockedStatus){db.prepare(`INSERT INTO games (id,user_id,mode,status,total_score,reward_atomic,reward_status,started_at,completed_at,client_version) VALUES (?,?,'daily','completed',?,0,?,?,?,?)`).run(gameId,user.id,score,blockedStatus,now,now,'web');return NextResponse.json({gameId,date:today,totalScore:score,distanceKm:km,amountYerb:0,status:blockedStatus,retryAfterSeconds:timing.retryAfterSeconds,rewardedGamesToday:timing.rewardedGamesToday},{status:201});}

  const baseReward=calculateDailyReward(score,policy);
  const dayStart=new Date().toISOString().slice(0,10)+'T00:00:00.000Z';
  const used=db.prepare(`SELECT COALESCE(SUM(amount_atomic),0) AS amount FROM wallet_ledger WHERE wallet_id=? AND reference_type='game_reward' AND status IN ('pending','held','posted') AND created_at>=?`).get(user.walletId,dayStart) as any;
  const remaining=Math.max(0,policy.dailyCapYerb-Number(used?.amount||0)/ATOMIC);
  const amountYerb=Number(Math.min(baseReward,remaining).toFixed(8));
  const amountAtomic=Math.round(amountYerb*ATOMIC);
  const ledgerStatus=policy.reviewRequired?'held':'posted';
  const rewardStatus=amountAtomic<=0?'daily_cap_reached':ledgerStatus;

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`INSERT INTO games (id,user_id,mode,status,total_score,reward_atomic,reward_status,started_at,completed_at,client_version) VALUES (?,?,'daily','completed',?,?,?,?,?,?)`).run(gameId,user.id,score,amountAtomic,rewardStatus,now,now,'web');
    if(amountAtomic>0){
      const ledgerId=`ledger-${crypto.randomUUID()}`;
      db.prepare(`INSERT INTO wallet_ledger (id,wallet_id,entry_type,amount_atomic,status,reference_type,reference_id,memo,metadata_json,created_at,posted_at) VALUES (?,?,?,?,?,'game_reward',?,'Daily Weedo reward',?,?,?)`).run(ledgerId,user.walletId,ledgerStatus==='posted'?'reward_credit':'reward_pending',amountAtomic,ledgerStatus,gameId,JSON.stringify({mode:'daily',date:today,targetId:daily.location.id,targetName:daily.location.name,sponsored:false,sponsorshipId:null,score,distanceKm:km,perfectRewardYerb:policy.dailyPerfectRewardYerb,reviewRequired:policy.reviewRequired}),now,ledgerStatus==='posted'?now:null);
      db.prepare(`INSERT INTO reward_claims (id,user_id,game_id,wallet_id,amount_atomic,status,ledger_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`).run(`claim-${crypto.randomUUID()}`,user.id,gameId,user.walletId,amountAtomic,ledgerStatus,ledgerId,now,now);
      if(ledgerStatus==='posted') postSystemLedgerEntry({accountCode:'rewards_pool',entryType:'reward_expense',amountAtomic:-amountAtomic,referenceType:'game_reward',referenceId:gameId,memo:'Daily Weedo reward',metadata:{userId:user.id,mode:'daily',date:today,targetId:daily.location.id,score,distanceKm:km}},db);
    }
    db.exec('COMMIT');
  } catch(error){db.exec('ROLLBACK');throw error;}

  return NextResponse.json({gameId,date:today,totalScore:score,distanceKm:km,amountYerb,status:amountAtomic<=0?'daily_cap_reached':mapStatus(ledgerStatus),dailyCapYerb:policy.dailyCapYerb,dailyRemainingYerb:Number(Math.max(0,remaining-amountYerb).toFixed(8)),reviewRequired:policy.reviewRequired,rewardedGamesToday:timing.rewardedGamesToday+(amountAtomic>0?1:0)},{status:201});
}
