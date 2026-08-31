'use client';

import { useEffect, useState } from 'react';
import styles from '../admin.module.css';

const summaryCards = [
  ['Ledger balance', 'ledgerBalanceYerb', '#ledger-details'],
  ['Confirmed player deposits', 'confirmedDepositsYerb', '#deposit-details'],
  ['Treasury received', 'treasuryDepositsYerb', '#treasury-deposits'],
  ['Sent withdrawals', 'sentWithdrawalsYerb', '/admin/withdrawals'],
  ['Posted rewards', 'postedRewardsYerb', '/admin/rewards'],
  ['Wallets', 'wallets', '/admin/users'],
  ['Active deposit addresses', 'activeAddresses', '#deposit-addresses'],
  ['Pending deposits', 'pendingDeposits', '#deposit-details'],
  ['Pending withdrawals', 'pendingWithdrawals', '/admin/withdrawals'],
  ['Pending rewards', 'pendingRewards', '/admin/rewards'],
] as const;

const quickCommands = [
  ['getblockchaininfo', '[]'],
  ['getwalletinfo', '[]'],
  ['getbalance', '[]'],
  ['listtransactions', '["*",20,0]'],
  ['listunspent', '[]'],
  ['getnetworkinfo', '[]'],
  ['getpeerinfo', '[]'],
  ['getmempoolinfo', '[]'],
] as const;

export default function AdminWalletPage() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');
  const [selectedWallet, setSelectedWallet] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [scanBusy, setScanBusy] = useState(false);
  const [scanNotice, setScanNotice] = useState('');
  const [rpcMethod, setRpcMethod] = useState('getblockchaininfo');
  const [rpcParams, setRpcParams] = useState('[]');
  const [rpcBusy, setRpcBusy] = useState(false);
  const [rpcOutput, setRpcOutput] = useState('');

  async function load() {
    const r = await fetch('/api/admin/wallet', { cache: 'no-store' });
    if (r.status === 401) {
      location.href = '/admin/login';
      return null;
    }
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Failed to load wallet dashboard');
    setData(d);
    if (!selectedWallet && d.walletUsers?.length) setSelectedWallet(d.walletUsers[0].walletId);
    return d;
  }

  async function scanWallet(silent = false) {
    setScanBusy(true);
    if (!silent) setScanNotice('Scanning Yerbas wallet…');
    try {
      const r = await fetch('/api/admin/wallet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'scanDeposits' }),
      });
      const d = await r.json();
      if (r.status === 401) {
        location.href = '/admin/login';
        return;
      }
      if (!r.ok) throw new Error(d.error || 'Wallet scan failed.');
      const s = d.scan || {};
      setScanNotice(
        `Scan complete: ${Number(s.incoming || 0)} incoming · ${Number(s.playerDeposits || 0)} player · ${Number(s.treasuryDeposits || 0)} treasury · ${Number(s.newlyCredited || 0)} newly credited.`,
      );
      await load();
    } catch (e) {
      setScanNotice(e instanceof Error ? e.message : 'Wallet scan failed.');
    } finally {
      setScanBusy(false);
    }
  }

  useEffect(() => {
    load()
      .then((d) => {
        if (d?.rpc?.connected) scanWallet(true);
      })
      .catch((e) => setError(e.message));
    // Run once when the admin wallet dashboard opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fmt = (v: any) => (v ? new Date(v).toLocaleString() : '—');

  async function copyAddress(a: string) {
    await navigator.clipboard.writeText(a);
    setCopied(a);
    setTimeout(() => setCopied(''), 1500);
  }

  async function assignAddress() {
    if (!selectedWallet) return;
    setBusy(true);
    setNotice('');
    try {
      const r = await fetch('/api/admin/wallet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'assignAddress', walletId: selectedWallet }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not assign deposit address.');
      setNotice(
        d.existing
          ? `Existing deposit address assigned: ${d.address}`
          : `New deposit address created: ${d.address}`,
      );
      await load();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Could not assign deposit address.');
    } finally {
      setBusy(false);
    }
  }

  async function runRpc(method = rpcMethod, params = rpcParams) {
    setRpcBusy(true);
    setRpcOutput('Running…');
    try {
      const r = await fetch('/api/admin/wallet/console', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method, params }),
      });
      const d = await r.json();
      setRpcOutput(JSON.stringify(d, null, 2));
      if (r.status === 401) location.href = '/admin/login';
    } catch (e) {
      setRpcOutput(e instanceof Error ? e.message : 'RPC request failed.');
    } finally {
      setRpcBusy(false);
    }
  }

  const value = (key: string) => {
    const v = data.summary[key];
    return [
      'ledgerBalanceYerb',
      'confirmedDepositsYerb',
      'treasuryDepositsYerb',
      'sentWithdrawalsYerb',
      'postedRewardsYerb',
    ].includes(key)
      ? `${Number(v).toLocaleString()} YERB`
      : v;
  };

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div>
          <a href="/admin" className={styles.adminHomeLink}>
            <span className={styles.eyebrow}>GEOWEEDO ADMIN</span>
          </a>
          <h1>Yerbas wallet dashboard</h1>
          <p>Unified custody view for treasury and player wallets, deposits, rewards, withdrawals, and Yerbas Core diagnostics.</p>
        </div>
        <div className={styles.headerActions}>
          <a className={styles.ghost} href="/admin">Control center</a>
          <a className={styles.ghost} href="/admin/users">User information</a>
        </div>
      </header>

      {error ? (
        <section className={styles.section}><p>{error}</p></section>
      ) : !data ? (
        <div className={styles.loading}>Loading wallet dashboard…</div>
      ) : (
        <>
          <section className={styles.section}>
            <article id="treasury" className={styles.card} style={{ minHeight: 0, marginBottom: 14, borderColor: 'rgba(103,214,110,.35)' }}>
              <span className={styles.eyebrow}>TREASURY WALLET ADDRESS</span>
              <h3>GeoWeedo Treasury</h3>
              {data.rpc?.treasuryAddress ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <code style={{ fontSize: 15, color: '#c8d6cc', overflowWrap: 'anywhere', flex: '1 1 420px' }}>{data.rpc.treasuryAddress}</code>
                  <button type="button" className={styles.secondaryLink} onClick={() => copyAddress(data.rpc.treasuryAddress)}>
                    {copied === data.rpc.treasuryAddress ? 'Copied!' : 'Copy address'}
                  </button>
                </div>
              ) : <p style={{ color: '#f5c451' }}>Treasury address unavailable.</p>}
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 14 }}>
                <button className={styles.primaryLink} disabled={scanBusy || !data.rpc?.connected} onClick={() => scanWallet(false)}>
                  {scanBusy ? 'Scanning…' : 'Scan wallet now'}
                </button>
                <span style={{ opacity: .72, fontSize: 13 }}>
                  Last scan: {fmt(data.depositScan?.lastScanAt)} · confirm at {data.depositScan?.confirmationThreshold ?? 6} blocks
                </span>
              </div>
              {scanNotice && <p>{scanNotice}</p>}
              <a href="#treasury-deposits" className={styles.cardLinkHint}>Treasury transactions →</a>
            </article>

            <div className={styles.grid}>
              <a href="#rpc-console" className={`${styles.card} ${styles.cardLink}`} style={{ minHeight: 150, borderColor: data.rpc?.connected ? 'rgba(103,214,110,.45)' : 'rgba(245,196,81,.45)' }}>
                <span className={styles.eyebrow}>Yerbas Core RPC</span>
                <h3 style={{ fontSize: 28 }}>{data.rpc?.connected ? 'Connected' : data.rpc?.configured ? 'RPC error' : 'Not configured'}</h3>
                <p>{data.rpc?.connected ? `Block ${Number(data.rpc.blocks || 0).toLocaleString()} · ${Number(data.rpc.walletBalanceYerb || 0).toLocaleString()} YERB` : data.rpc?.error}</p>
                <span className={styles.cardLinkHint}>Open console / RPC details →</span>
              </a>
              {summaryCards.map(([label, key, href]) => (
                <a href={href} className={`${styles.card} ${styles.cardLink}`} key={key} style={{ minHeight: 150 }}>
                  <span className={styles.eyebrow}>{label}</span>
                  <h3 style={{ fontSize: 28 }}>{value(key)}</h3>
                  {key === 'pendingDeposits' && (
                    <p>{data.summary.pendingPlayerDeposits || 0} player · {data.summary.pendingTreasuryDeposits || 0} treasury</p>
                  )}
                  <span className={styles.cardLinkHint}>View details →</span>
                </a>
              ))}
            </div>
          </section>

          <section className={styles.section} id="treasury-deposits">
            <div className={styles.sectionHead}>
              <div><span className={styles.eyebrow}>TREASURY ACTIVITY</span><h2>Treasury deposits</h2></div>
              <button className={styles.secondaryLink} disabled={scanBusy || !data.rpc?.connected} onClick={() => scanWallet(false)}>Refresh from wallet</button>
            </div>
            <article className={styles.card} style={{ minHeight: 0 }}>
              {data.treasuryDeposits?.length ? data.treasuryDeposits.map((r: any) => (
                <div key={r.id} style={{ padding: '12px 0', borderTop: '1px solid rgba(255,255,255,.06)' }}>
                  <strong>{r.amountYerb} YERB</strong>
                  <div>{r.status} · {r.confirmations ?? 0}/{data.depositScan?.confirmationThreshold ?? 6} confirmations · {fmt(r.detected_at)}</div>
                  <code style={{ fontSize: 12, overflowWrap: 'anywhere' }}>{r.txid}:{r.vout ?? 0}</code>
                </div>
              )) : <p>No treasury transactions have been scanned yet.</p>}
            </article>
          </section>

          <section className={styles.section} id="rpc-console">
            <div className={styles.sectionHead}>
              <div><span className={styles.eyebrow}>YERBAS CORE</span><h2>RPC console</h2><p>Run approved read-only Yerbas RPC commands against the configured GeoWeedo wallet node.</p></div>
            </div>
            <article className={styles.card} style={{ minHeight: 0 }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                {quickCommands.map(([method, params]) => (
                  <button key={method} type="button" className={styles.secondaryLink} onClick={() => { setRpcMethod(method); setRpcParams(params); runRpc(method, params); }}>{method}</button>
                ))}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px,1fr) minmax(260px,2fr) auto', gap: 10, alignItems: 'end' }}>
                <label style={{ display: 'grid', gap: 6 }}><span>RPC method</span><input value={rpcMethod} onChange={e => setRpcMethod(e.target.value)} style={{ padding: 11, background: '#0f1411', color: '#fff', border: '1px solid rgba(255,255,255,.12)', borderRadius: 8 }} /></label>
                <label style={{ display: 'grid', gap: 6 }}><span>Parameters (JSON array)</span><input value={rpcParams} onChange={e => setRpcParams(e.target.value)} style={{ padding: 11, background: '#0f1411', color: '#fff', border: '1px solid rgba(255,255,255,.12)', borderRadius: 8, fontFamily: 'monospace' }} /></label>
                <button className={styles.primaryLink} disabled={rpcBusy || !data.rpc?.connected || !rpcMethod.trim()} onClick={() => runRpc()}>{rpcBusy ? 'Running…' : 'Run command'}</button>
              </div>
              <pre style={{ marginTop: 14, padding: 14, borderRadius: 10, background: '#070a08', border: '1px solid rgba(255,255,255,.08)', maxHeight: 420, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12 }}>{rpcOutput || 'Command output will appear here.'}</pre>
              <p style={{ opacity: .7, fontSize: 12 }}>This console intentionally blocks wallet-mutating commands such as send, import, dump, encrypt, wallet creation, and address generation.</p>
            </article>
          </section>

          <section className={styles.section} id="deposit-addresses">
            <div className={styles.sectionHead}><div><span className={styles.eyebrow}>DEPOSIT ADDRESSES</span><h2>Player deposit addresses</h2></div><a className={styles.secondaryLink} href="/admin/users">View users →</a></div>
            <article className={styles.card} style={{ minHeight: 0, marginBottom: 14 }}>
              <h3>Assign/Create Deposit Address</h3>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <select value={selectedWallet} onChange={e => setSelectedWallet(e.target.value)} style={{ minWidth: 320, padding: 11, background: '#0f1411', color: '#fff' }}>
                  {data.walletUsers.map((u: any) => <option key={u.walletId} value={u.walletId}>{u.displayName || u.username || u.yerbasAddress || u.userId}</option>)}
                </select>
                <button className={styles.primaryLink} disabled={!selectedWallet || busy || !data.rpc?.connected} onClick={assignAddress}>{busy ? 'Creating…' : 'Assign/Create Deposit Address'}</button>
              </div>
              {notice && <p>{notice}</p>}
            </article>
            <article className={styles.card} style={{ minHeight: 0 }}>
              {data.depositAddresses?.map((a: any) => (
                <div key={a.id} style={{ padding: 12, borderTop: '1px solid rgba(255,255,255,.06)', display: 'grid', gridTemplateColumns: '1fr 2fr auto', gap: 12 }}>
                  <a href="/admin/users" style={{ color: 'inherit' }}><strong>{a.display_name || a.username || a.user_id}</strong></a>
                  <code>{a.address}</code>
                  <button className={styles.secondaryLink} onClick={() => copyAddress(a.address)}>{copied === a.address ? 'Copied' : 'Copy'}</button>
                </div>
              ))}
            </article>
          </section>

          <section className={styles.section} id="deposit-details">
            <div className={styles.sectionHead}>
              <div><span className={styles.eyebrow}>PLAYER DEPOSIT ACTIVITY</span><h2>Player deposits</h2></div>
              <button className={styles.secondaryLink} disabled={scanBusy || !data.rpc?.connected} onClick={() => scanWallet(false)}>Refresh from wallet</button>
            </div>
            <article className={styles.card} style={{ minHeight: 0 }}>
              {data.recentDeposits?.length ? data.recentDeposits.map((r: any) => (
                <div key={r.id} style={{ padding: '12px 0', borderTop: '1px solid rgba(255,255,255,.06)' }}>
                  <strong>{r.amountYerb} YERB</strong>
                  <div>{r.status} · {r.confirmations ?? 0}/{data.depositScan?.confirmationThreshold ?? 6} confirmations · {fmt(r.detected_at)}</div>
                  <small>Player {r.user_id}</small><br />
                  <code style={{ fontSize: 12, overflowWrap: 'anywhere' }}>{r.txid}:{r.vout ?? 0}</code>
                </div>
              )) : <p>No player deposits recorded.</p>}
            </article>
          </section>

          <section className={styles.section} id="ledger-details">
            <div className={styles.sectionHead}><div><span className={styles.eyebrow}>WALLET LEDGER</span><h2>Recent ledger activity</h2></div></div>
            <article className={styles.card} style={{ minHeight: 0 }}>
              {data.recentLedger?.length ? data.recentLedger.map((r: any) => (
                <div key={r.id} style={{ padding: '12px 0', borderTop: '1px solid rgba(255,255,255,.06)' }}>
                  <strong>{r.amountYerb} YERB · {r.entry_type}</strong>
                  <div>{r.status} · {r.confirmations ?? '—'} confirmations · {fmt(r.created_at)}</div>
                  <small>{r.reference_type || '—'} {r.reference_id || ''}</small>
                </div>
              )) : <p>No ledger entries recorded.</p>}
            </article>
          </section>
        </>
      )}
    </main>
  );
}
