'use client';

import { useEffect, useState } from 'react';

type Candidate = { id: string; imageryStatus?: string };

export default function CandidatePipelineRunner() {
  const [busy, setBusy] = useState(false);
  const [playable, setPlayable] = useState(0);
  const [message, setMessage] = useState('Ready to process coordinate-ready candidates into playable rounds.');

  async function refreshPlayable() {
    try {
      const response = await fetch('/api/dispensaries', { cache: 'no-store' });
      const data = await response.json();
      if (response.ok) setPlayable(Array.isArray(data.dispensaries) ? data.dispensaries.length : 0);
    } catch {}
  }

  useEffect(() => { refreshPlayable(); }, []);

  async function run() {
    setBusy(true);
    setMessage('Checking KartaView quality for the next 10 coordinate-ready candidates…');
    try {
      const checkResponse = await fetch('/api/admin/candidates/check-imagery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 10 }),
      });
      if (checkResponse.status === 401) { window.location.href = '/admin/login'; return; }
      const checked = await checkResponse.json();
      if (!checkResponse.ok) throw new Error(checked.error || 'Imagery check failed.');

      const results = (Array.isArray(checked.results) ? checked.results : []).filter(Boolean) as Candidate[];
      const eligibleIds = results.filter((item) => item.imageryStatus === 'coverage').map((item) => item.id);

      let promoted = 0;
      let skipped = 0;
      if (eligibleIds.length) {
        setMessage(`${eligibleIds.length} candidate(s) passed quality. Promoting them into the gameplay pool…`);
        const approveResponse = await fetch('/api/admin/candidates', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: eligibleIds, action: 'approve' }),
        });
        if (approveResponse.status === 401) { window.location.href = '/admin/login'; return; }
        const approved = await approveResponse.json();
        if (!approveResponse.ok) throw new Error(approved.error || 'Gameplay promotion failed.');
        promoted = Number(approved.promoted || 0);
        skipped = Number(approved.skipped || 0);
      }

      await refreshPlayable();
      setMessage(
        `Checked ${Number(checked.checked || 0)} candidate(s): ${eligibleIds.length} passed quality, ${promoted} promoted to gameplay${skipped ? `, ${skipped} failed promotion revalidation` : ''}.`
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
          <p className="admin-help">Playable rounds currently: {playable}. This action checks imagery quality and immediately promotes every passing candidate.</p>
        </div>
        <button className="primary" disabled={busy} onClick={run}>{busy ? 'Processing…' : 'Process next 10 candidates'}</button>
      </div>
      <p className="admin-help">{message}</p>
    </section>
  );
}
