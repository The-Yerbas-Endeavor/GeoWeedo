'use client';

import { useEffect, useState } from 'react';

type Candidate = { id: string; imageryStatus?: string; imageryMessage?: string };

export default function CandidatePipelineRunner() {
  const [busy, setBusy] = useState(false);
  const [playable, setPlayable] = useState(0);
  const [message, setMessage] = useState('Ready to process coordinate-ready candidates into playable rounds.');

  async function refreshPlayable() {
    try {
      const response = await fetch('/api/dispensaries', { cache: 'no-store' });
      const data = await response.json();
      const count = response.ok && Array.isArray(data.dispensaries) ? data.dispensaries.length : 0;
      setPlayable(count);
      return count;
    } catch {
      return playable;
    }
  }

  useEffect(() => { refreshPlayable(); }, []);

  async function run() {
    setBusy(true);
    try {
      let totalChecked = 0;
      let totalPassed = 0;
      let totalPromoted = 0;
      let totalSkipped = 0;
      const rejectionReasons: Record<string, number> = {};

      for (let batch = 1; batch <= 5; batch++) {
        setMessage(`Batch ${batch}/5: checking the next 10 coordinate-ready candidates…`);
        const checkResponse = await fetch('/api/admin/candidates/check-imagery', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ limit: 10 }),
        });
        if (checkResponse.status === 401) { window.location.href = '/admin/login'; return; }
        const checked = await checkResponse.json();
        if (!checkResponse.ok) throw new Error(checked.error || 'Imagery check failed.');

        const results = (Array.isArray(checked.results) ? checked.results : []).filter(Boolean) as Candidate[];
        const checkedCount = Number(checked.checked || results.length || 0);
        totalChecked += checkedCount;
        if (!checkedCount) break;

        const eligibleIds = results.filter((item) => item.imageryStatus === 'coverage').map((item) => item.id);
        totalPassed += eligibleIds.length;
        for (const item of results) {
          if (item.imageryStatus === 'coverage') continue;
          const reason = String(item.imageryMessage || item.imageryStatus || 'unknown imagery rejection').replace(/^Not gameplay quality:\s*/i, '');
          rejectionReasons[reason] = (rejectionReasons[reason] || 0) + 1;
        }

        if (eligibleIds.length) {
          setMessage(`Batch ${batch}/5: ${eligibleIds.length} passed quality; promoting to gameplay…`);
          const approveResponse = await fetch('/api/admin/candidates', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: eligibleIds, action: 'approve' }),
          });
          if (approveResponse.status === 401) { window.location.href = '/admin/login'; return; }
          const approved = await approveResponse.json();
          if (!approveResponse.ok) throw new Error(approved.error || 'Gameplay promotion failed.');
          totalPromoted += Number(approved.promoted || 0);
          totalSkipped += Number(approved.skipped || 0);
        }

        if (totalPromoted >= 5) break;
      }

      const playableNow = await refreshPlayable();
      const topReasons = Object.entries(rejectionReasons)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([reason, count]) => `${count}× ${reason}`)
        .join(' · ');

      setMessage(
        `Checked ${totalChecked}: ${totalPassed} passed quality, ${totalPromoted} promoted, ${playableNow} playable now${totalSkipped ? `, ${totalSkipped} failed promotion revalidation` : ''}.${topReasons ? ` Rejections: ${topReasons}` : ''}`
      );
      window.dispatchEvent(new Event('geoweedo-pipeline-updated'));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Candidate processing failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="admin-panel approved-list">
      <div className="queue-toolbar">
        <div>
          <h2>Gameplay pipeline</h2>
          <p className="admin-help">Playable rounds currently: {playable}. Scans up to 50 coordinate-ready candidates per run, blocks bad portrait/short coverage, and promotes every passing location.</p>
        </div>
        <button className="primary" disabled={busy} onClick={run}>{busy ? 'Processing…' : 'Process candidates'}</button>
      </div>
      <p className="admin-help">{message}</p>
    </section>
  );
}
