'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

type WalletDashboard = {
  rpc?: {
    connected?: boolean;
    walletBalanceYerb?: number;
  };
  summary?: {
    rawLedgerBalanceYerb?: number;
    heldYerb?: number;
  };
};

function formatYerb(value: number) {
  return `${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 8 })} YERB`;
}

export default function AdminTreasuryBalance() {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [data, setData] = useState<WalletDashboard | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || window.location.pathname !== '/admin/wallet') return;

    let cancelled = false;
    let interval: number | undefined;

    const findTarget = () => {
      const card = document.querySelector<HTMLElement>('#treasury');
      if (!card) return;
      let slot = card.querySelector<HTMLElement>('[data-treasury-balance-slot]');
      if (!slot) {
        slot = document.createElement('div');
        slot.dataset.treasuryBalanceSlot = 'true';
        const heading = card.querySelector('h3');
        if (heading?.nextSibling) heading.parentNode?.insertBefore(slot, heading.nextSibling);
        else card.appendChild(slot);
      }
      setTarget(slot);
    };

    const load = async () => {
      try {
        const response = await fetch('/api/admin/wallet', { cache: 'no-store' });
        if (!response.ok) return;
        const next = (await response.json()) as WalletDashboard;
        if (!cancelled) setData(next);
      } catch {
        // Keep the native wallet dashboard usable even if this enhancement cannot refresh.
      }
    };

    findTarget();
    load();

    const observer = new MutationObserver(findTarget);
    observer.observe(document.body, { childList: true, subtree: true });

    interval = window.setInterval(load, 10000);

    const onClick = (event: MouseEvent) => {
      const button = (event.target as HTMLElement | null)?.closest('button');
      if (button && /scan wallet now|scanning/i.test(button.textContent || '')) {
        window.setTimeout(load, 1500);
        window.setTimeout(load, 4000);
      }
    };
    document.addEventListener('click', onClick);

    return () => {
      cancelled = true;
      observer.disconnect();
      if (interval) window.clearInterval(interval);
      document.removeEventListener('click', onClick);
    };
  }, []);

  if (!target || !data?.rpc?.connected) return null;

  const custody = Number(data.rpc.walletBalanceYerb || 0);
  const playerLiability = Math.max(0, Number(data.summary?.rawLedgerBalanceYerb || 0));
  const held = Math.max(0, Number(data.summary?.heldYerb || 0));
  const treasuryBalance = custody - playerLiability;

  return createPortal(
    <div style={{ margin: '12px 0 14px', padding: '14px 16px', border: '1px solid rgba(103,214,110,.25)', borderRadius: 12, background: 'rgba(103,214,110,.055)' }}>
      <span style={{ display: 'block', color: '#67d66e', fontSize: 11, fontWeight: 800, letterSpacing: '.13em', textTransform: 'uppercase' }}>
        Current treasury balance
      </span>
      <strong style={{ display: 'block', marginTop: 4, fontSize: 30, lineHeight: 1.1, color: '#f4f7f4' }}>
        {formatYerb(treasuryBalance)}
      </strong>
      <div style={{ display: 'flex', gap: '8px 18px', flexWrap: 'wrap', marginTop: 9, color: '#9fb0a4', fontSize: 12 }}>
        <span>Wallet custody: <b style={{ color: '#c8d6cc' }}>{formatYerb(custody)}</b></span>
        <span>Player liabilities: <b style={{ color: '#c8d6cc' }}>{formatYerb(playerLiability)}</b></span>
        {held > 0 && <span>Held withdrawals: <b style={{ color: '#c8d6cc' }}>{formatYerb(held)}</b></span>}
      </div>
      <div style={{ marginTop: 7, color: '#7f9084', fontSize: 11 }}>
        Yerbas Core wallet custody − player ledger liabilities. Deposits, posted rewards/credits, and sent withdrawals reconcile through these balances.
      </div>
    </div>,
    target,
  );
}
