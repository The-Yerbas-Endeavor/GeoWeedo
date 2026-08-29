import { NextRequest,NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/adminAuth';
import { getDatabase } from '@/lib/sqlite';
import { yerbasRpc } from '@/lib/yerbasRpc';

export const runtime='nodejs';
const ATOMIC=100_000_000;
const y=(n:any)=>Number(n||0)/ATOMIC;

type BlockchainInfo={blocks?:number;headers?:number;chain?:string;verificationprogress?:number};
type WalletInfo={walletversion?:number;balance?:number;unconfirmed_balance?:number;immature_balance?:number;txcount?:number};

async function getRpcStatus(){
 const configured=Boolean(process.env.YERB_RPC_URL&&process.env.YERB_RPC_USER&&process.env.YERB_RPC_PASSWORD);
 if(!configured)return{configured:false,connected:false,error:'Yerbas RPC is not configured.'};
 try{
  const [chain,wallet]=await Promise.all([yerbasRpc<BlockchainInfo>('getblockchaininfo'),yerbasRpc<WalletInfo>('getwalletinfo')]);
  return{configured:true,connected:true,url:process.env.YERB_RPC_URL,chain:chain.chain||'main',blocks:Number(chain.blocks||0),headers:Number(chain.headers||0),verificationProgress:Number(chain.verificationprogress||0),walletVersion:Number(wallet.walletversion||0),walletBalanceYerb:Number(wallet.balance||0),unconfirmedBalanceYerb:Number(wallet.unconfirmed_balance||0),immatureBalanceYerb:Number(wallet.immature_balance||0),txCount:Number(wallet.txcount||0)};
 }catch(error){return{configured:true,connected:false,url:process.env.YERB_RPC_URL,error:error instanceof Error?error.message:String(error)};}
}

export async function GET(request:NextRequest){if(!getAdminFromRequest(request))return NextResponse.json({error:'Unauthorized.'},{status:401});const db=getDatabase();
 const counts=db.prepare(`SELECT (SELECT COUNT(*) FROM wallets) wallets,(SELECT COUNT(*) FROM wallet_addresses WHERE active=1) activeAddresses,(SELECT COUNT(*) FROM deposits WHERE status NOT IN ('credited','confirmed')) pendingDeposits,(SELECT COUNT(*) FROM withdrawals WHERE status IN ('requested','held','approved','processing')) pendingWithdrawals,(SELECT COUNT(*) FROM reward_claims WHERE status IN ('pending','held')) pendingRewards`).get() as any;
 const totals=db.prepare(`SELECT COALESCE((SELECT SUM(amount_atomic) FROM wallet_ledger WHERE status='posted'),0) ledgerBalance,COALESCE((SELECT SUM(amount_atomic) FROM deposits WHERE status IN ('credited','confirmed')),0) deposits,COALESCE((SELECT SUM(amount_atomic+fee_atomic) FROM withdrawals WHERE status IN ('sent','completed')),0) withdrawals,COALESCE((SELECT SUM(amount_atomic) FROM wallet_ledger WHERE status='posted' AND (entry_type='reward_credit' OR reference_type IN ('reward','game_reward','admin_reward'))),0) rewards`).get() as any;
 const recentDeposits=db.prepare(`SELECT d.id,d.address,d.txid,d.amount_atomic,d.confirmations,d.status,d.detected_at,w.user_id FROM deposits d JOIN wallets w ON w.id=d.wallet_id ORDER BY d.detected_at DESC LIMIT 25`).all();
 const recentWithdrawals=db.prepare(`SELECT x.id,x.destination_address,x.txid,x.amount_atomic,x.fee_atomic,x.status,x.requested_at,x.sent_at,w.user_id FROM withdrawals x JOIN wallets w ON w.id=x.wallet_id ORDER BY x.requested_at DESC LIMIT 25`).all();
 const recentLedger=db.prepare(`SELECT l.id,l.entry_type,l.amount_atomic,l.status,l.reference_type,l.reference_id,l.txid,l.created_at,w.user_id FROM wallet_ledger l JOIN wallets w ON w.id=l.wallet_id ORDER BY l.created_at DESC LIMIT 30`).all();
 const rpc=await getRpcStatus();
 return NextResponse.json({rpc,summary:{wallets:Number(counts.wallets||0),activeAddresses:Number(counts.activeAddresses||0),pendingDeposits:Number(counts.pendingDeposits||0),pendingWithdrawals:Number(counts.pendingWithdrawals||0),pendingRewards:Number(counts.pendingRewards||0),ledgerBalanceYerb:y(totals.ledgerBalance),confirmedDepositsYerb:y(totals.deposits),sentWithdrawalsYerb:y(totals.withdrawals),postedRewardsYerb:y(totals.rewards)},recentDeposits:recentDeposits.map((r:any)=>({...r,amountYerb:y(r.amount_atomic)})),recentWithdrawals:recentWithdrawals.map((r:any)=>({...r,amountYerb:y(r.amount_atomic),feeYerb:y(r.fee_atomic)})),recentLedger:recentLedger.map((r:any)=>({...r,amountYerb:y(r.amount_atomic)}))},{headers:{'Cache-Control':'no-store'}});}
