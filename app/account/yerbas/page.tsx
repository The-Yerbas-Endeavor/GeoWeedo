'use client';

import { useEffect, useState } from 'react';
import AccountWorkspaceTabs from '@/components/AccountWorkspaceTabs';

type Summary={
  user:{handle:string;yerbasAddress?:string|null;walletVerifiedAt?:string|null};
  wallet:{balanceAtomic:number;heldAtomic:number;availableAtomic:number;balanceYerb:number;availableYerb:number;depositAddress:string|null};
  deposits:Array<any>;withdrawals:Array<any>;
};
const ATOMIC=100_000_000;

export default function YerbasAccountPage(){
  const[summary,setSummary]=useState<Summary|null>(null),[handle,setHandle]=useState(''),[address,setAddress]=useState(''),[challenge,setChallenge]=useState(''),[signature,setSignature]=useState('');
  const[withdrawAddress,setWithdrawAddress]=useState(''),[withdrawAmount,setWithdrawAmount]=useState(''),[status,setStatus]=useState('Loading Yerbas account details…'),[busy,setBusy]=useState(false);

  async function loadSummary(){
    const r=await fetch('/api/account/summary',{cache:'no-store'});
    if(r.status===401){setSummary(null);setStatus('Sign in with a Yerbas wallet signature, or use the Account tab for email/password login.');return null;}
    const d=await r.json();if(!r.ok)throw new Error(d.error||'Could not load Yerbas account details.');
    setSummary(d);setHandle(d.user.handle||'');setAddress(d.user.yerbasAddress||'');setStatus('Yerbas details loaded.');return d as Summary;
  }
  useEffect(()=>{void loadSummary().catch(e=>setStatus(e instanceof Error?e.message:'Could not load Yerbas account details.'));},[]);
  async function requestChallenge(){setBusy(true);try{const r=await fetch('/api/player/challenge',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({address})}),d=await r.json();if(!r.ok)throw new Error(d.error||'Could not create verification message.');setChallenge(d.message);setStatus('Sign the exact message with the Yerbas wallet that owns this address, then paste the signature below.');}catch(e){setStatus(e instanceof Error?e.message:'Challenge failed.');}finally{setBusy(false);}}
  async function verify(){setBusy(true);try{const r=await fetch('/api/player/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({handle,address,signature})}),d=await r.json();if(!r.ok)throw new Error(d.error||'Wallet verification failed.');setChallenge('');setSignature('');await loadSummary();setStatus('Yerbas wallet verified and signed in.');}catch(e){setStatus(e instanceof Error?e.message:'Wallet verification failed.');}finally{setBusy(false);}}
  async function createDepositAddress(){setBusy(true);try{const r=await fetch('/api/account/deposit-address',{method:'POST'}),d=await r.json();if(!r.ok)throw new Error(d.error||'Could not generate deposit address.');await loadSummary();setStatus(d.existing?'Using your existing GeoWeedo deposit address.':'New GeoWeedo YERB deposit address created.');}catch(e){setStatus(e instanceof Error?e.message:'Could not generate deposit address.');}finally{setBusy(false);}}
  async function requestWithdrawal(){if(!confirm(`Request withdrawal of ${withdrawAmount} YERB to ${withdrawAddress}?`))return;setBusy(true);try{const r=await fetch('/api/account/withdrawals',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({destinationAddress:withdrawAddress,amountYerb:Number(withdrawAmount)})}),d=await r.json();if(!r.ok)throw new Error(d.error||'Withdrawal request failed.');setWithdrawAmount('');setWithdrawAddress('');await loadSummary();if(d.status==='sent'&&d.txid)setStatus(`Withdrawal sent: ${Number(d.amountYerb||0).toFixed(8)} YERB · txid ${d.txid}`);else if(d.status==='approved'&&d.autoApproved)setStatus(`Withdrawal ${d.id} was auto-approved but could not be sent automatically. It is ready for Admin retry.`);else if(d.autoApproved)setStatus(`Withdrawal ${d.id} was automatically approved.`);else setStatus(`Withdrawal ${d.id} is awaiting administrator review.`);}catch(e){setStatus(e instanceof Error?e.message:'Withdrawal request failed.');}finally{setBusy(false);}}

  return <main className="info-shell">
<AccountWorkspaceTabs/>
    <section className="account-card" style={{marginTop:28}}>
      <div className="account-status">{status}</div>
      {!summary?<>
        <div className="account-section"><h2>Yerbas wallet login</h2><p className="account-note">Prove ownership of a Yerbas address to sign into the same GeoWeedo account without a password.</p><label>User name<input value={handle} onChange={e=>setHandle(e.target.value)}/></label><label>Yerbas address<input value={address} onChange={e=>setAddress(e.target.value)}/></label><button className="secondary" disabled={busy||address.length<20} onClick={requestChallenge}>1. Create login message</button>{challenge&&<><label>Message to sign<textarea readOnly value={challenge} rows={5}/></label><button className="ghost" onClick={()=>navigator.clipboard.writeText(challenge)}>Copy message</button><label>Wallet signature<textarea value={signature} onChange={e=>setSignature(e.target.value)} rows={4}/></label><button className="primary" disabled={busy||!signature} onClick={verify}>2. Verify & sign in</button></>}</div>
        <p className="account-note">For email/password login or account creation, use the <a href="/account">Account tab</a>.</p>
      </>:<>
        {summary.user.yerbasAddress?<div className="verified-card"><strong>Linked Yerbas wallet</strong><span>{summary.user.yerbasAddress}</span><small>{summary.user.walletVerifiedAt?'Wallet signature verified':'Linked to this GeoWeedo account'}</small></div>:<div className="account-section"><h2>Link a Yerbas wallet</h2><p className="account-note">This GeoWeedo account does not have a verified Yerbas address yet.</p><label>Yerbas address<input value={address} onChange={e=>setAddress(e.target.value)}/></label><button className="secondary" disabled={busy||address.length<20} onClick={requestChallenge}>Create verification message</button>{challenge&&<><label>Message to sign<textarea readOnly value={challenge} rows={5}/></label><button className="ghost" onClick={()=>navigator.clipboard.writeText(challenge)}>Copy message</button><label>Wallet signature<textarea value={signature} onChange={e=>setSignature(e.target.value)} rows={4}/></label><button className="primary" disabled={busy||!signature} onClick={verify}>Verify wallet</button></>}</div>}
        <div className="feature-row"><div><strong>{summary.wallet.balanceYerb.toFixed(8)}</strong><span>Total YERB balance</span></div><div><strong>{summary.wallet.availableYerb.toFixed(8)}</strong><span>Available YERB</span></div><div><strong>{(summary.wallet.heldAtomic/ATOMIC).toFixed(8)}</strong><span>Held YERB</span></div></div>
        <div className="account-section"><h2>Deposit YERB</h2>{summary.wallet.depositAddress?<><div className="verified-card"><strong>Deposit address</strong><span>{summary.wallet.depositAddress}</span></div><button className="ghost" onClick={()=>navigator.clipboard.writeText(summary.wallet.depositAddress||'')}>Copy deposit address</button></>:<button className="primary" disabled={busy} onClick={createDepositAddress}>Create deposit address</button>}</div>
        <div className="account-section"><h2>Withdraw YERB</h2><p className="account-note">Withdrawals under 100 YERB are automatically approved and submitted when the Yerbas wallet is available. Withdrawals of 100 YERB or more require administrator review.</p><label>Destination address<input value={withdrawAddress} onChange={e=>setWithdrawAddress(e.target.value)}/></label><label>Amount<input type="number" min="0" step="0.00000001" value={withdrawAmount} onChange={e=>setWithdrawAmount(e.target.value)}/></label><button className="primary" disabled={busy||withdrawAddress.length<20||Number(withdrawAmount)<=0} onClick={requestWithdrawal}>{busy?'Processing…':Number(withdrawAmount)>0&&Number(withdrawAmount)<100?'Withdraw YERB':'Request withdrawal'}</button></div>
        <div className="account-section"><h2>Recent deposits</h2>{summary.deposits.length===0?<p className="account-note">No deposits detected yet.</p>:summary.deposits.map((i:any)=><div className="approved-row" key={i.id}><div><strong>{(Number(i.amount_atomic)/ATOMIC).toFixed(8)} YERB</strong><span>{i.status} · {i.confirmations} confirmations</span><small>{i.txid}</small></div></div>)}</div>
        <div className="account-section"><h2>Recent withdrawals</h2>{summary.withdrawals.length===0?<p className="account-note">No withdrawals requested yet.</p>:summary.withdrawals.map((i:any)=><div className="approved-row" key={i.id}><div><strong>{(Number(i.amount_atomic)/ATOMIC).toFixed(8)} YERB</strong><span>{i.status} · {i.destination_address}</span>{i.txid&&<small>{i.txid}</small>}</div></div>)}</div>
        <p className="account-note">Never paste a private key or seed phrase here.</p>
      </>}
    </section>
  </main>;
}
