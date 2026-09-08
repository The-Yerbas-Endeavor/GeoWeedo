import {NextRequest,NextResponse} from 'next/server';
import {getDatabase} from '@/lib/sqlite';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const ATOMIC=100_000_000;
type BoardKey='classic'|'hunt'|'daily';

type Row={id:string;user_id:string;total_score:number;reward_atomic:number;reward_status:string;completed_at:string;player:string;earned_atomic:number};

function dateKey(){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}

function board(mode:string,key:BoardKey,today:string,limit:number){
 const db=getDatabase();
 const dailyFilter=key==='daily'?' AND g.id LIKE ?':'';
 const sql=`
  SELECT g.id,g.user_id,g.total_score,g.reward_atomic,g.reward_status,g.completed_at,
         COALESCE(NULLIF(u.display_name,''),NULLIF(u.username,''),'Player') AS player,
         COALESCE((SELECT wl.amount_atomic FROM wallet_ledger wl WHERE wl.reference_type='game_reward' AND wl.reference_id=g.id AND wl.status IN ('pending','held','posted') ORDER BY wl.created_at ASC LIMIT 1),g.reward_atomic,0) AS earned_atomic
  FROM games g
  JOIN users u ON u.id=g.user_id
  WHERE g.mode=? AND g.status='completed'${dailyFilter}
  ORDER BY g.total_score DESC,earned_atomic DESC,g.completed_at ASC
  LIMIT ?`;
 const rows=(key==='daily'?db.prepare(sql).all(mode,`daily-${today}-%`,limit):db.prepare(sql).all(mode,limit)) as Row[];
 return rows.map((row,index)=>({rank:index+1,gameId:row.id,player:row.player,score:Number(row.total_score||0),earnedYerb:Number(row.earned_atomic||0)/ATOMIC,rewardStatus:String(row.reward_status||''),completedAt:row.completed_at}));
}

export async function GET(request:NextRequest){
 const today=dateKey();
 const requested=Math.max(1,Math.min(100,Number(new URL(request.url).searchParams.get('limit')||50)||50));
 const boards={
  classic:board('standard','classic',today,requested),
  hunt:board('hunt','hunt',today,requested),
  daily:board('daily','daily',today,requested),
 };
 return NextResponse.json({date:today,boards,limits:{classic:25000,hunt:5000,daily:5000},periods:{classic:'All time',hunt:'All time',daily:`Today · ${today}`}},{headers:{'Cache-Control':'no-store, max-age=0'}});
}
