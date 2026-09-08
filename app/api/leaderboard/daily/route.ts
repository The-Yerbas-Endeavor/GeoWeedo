import {NextResponse} from 'next/server';
import {getDatabase} from '@/lib/sqlite';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const ATOMIC=100_000_000;

function dateKey(){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}

export async function GET(){
 const today=dateKey(),db=getDatabase();
 const rows=db.prepare(`
  SELECT g.id,g.user_id,g.total_score,g.reward_atomic,g.reward_status,g.completed_at,
         COALESCE(NULLIF(u.display_name,''),NULLIF(u.username,''),'Player') AS player,
         COALESCE((SELECT wl.amount_atomic FROM wallet_ledger wl WHERE wl.reference_type='game_reward' AND wl.reference_id=g.id AND wl.status IN ('pending','held','posted') ORDER BY wl.created_at ASC LIMIT 1),g.reward_atomic,0) AS earned_atomic
  FROM games g
  JOIN users u ON u.id=g.user_id
  WHERE g.mode='daily' AND g.status='completed' AND g.id LIKE ?
  ORDER BY g.total_score DESC,earned_atomic DESC,g.completed_at ASC
  LIMIT 25
 `).all(`daily-${today}-%`) as Array<{id:string;user_id:string;total_score:number;reward_atomic:number;reward_status:string;completed_at:string;player:string;earned_atomic:number}>;
 const leaders=rows.map((row,index)=>({rank:index+1,player:row.player,score:Number(row.total_score||0),earnedYerb:Number(row.earned_atomic||0)/ATOMIC,rewardStatus:String(row.reward_status||''),completedAt:row.completed_at}));
 return NextResponse.json({date:today,leaders,count:leaders.length},{headers:{'Cache-Control':'no-store, max-age=0'}});
}
