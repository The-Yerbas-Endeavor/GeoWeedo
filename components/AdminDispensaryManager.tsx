'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Viewer } from '@photo-sphere-viewer/core';

type StreetPhoto = {
  id: string;
  lat: number;
  lng: number;
  heading: number;
  fieldOfView: number;
  projection: string;
  imageUrl: string;
  sequenceId: string;
  sequenceIndex: number;
  shotDate?: string | null;
};

type SavedDispensary = {
  id: string;
  name: string;
  city: string;
  region: string;
  country: string;
  imageryProvider: string;
  active: boolean;
};

const emptyForm = {
  name: '', streetAddress: '', city: '', region: '', country: 'USA', website: '',
  latitude: '', longitude: '', recreational: true, medical: false,
};

export default function AdminDispensaryManager() {
  const [secret, setSecret] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [photos, setPhotos] = useState<StreetPhoto[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [saved, setSaved] = useState<SavedDispensary[]>([]);
  const [status, setStatus] = useState('Enter the admin secret to begin.');
  const [busy, setBusy] = useState(false);
  const sphereRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<Viewer | null>(null);

  useEffect(() => {
    const remembered = sessionStorage.getItem('geoweedo-admin-secret');
    if (remembered) setSecret(remembered);
  }, []);

  const selected = photos[selectedIndex];
  const isSphere = useMemo(() => Boolean(selected && (selected.projection === 'SPHERE' || selected.fieldOfView >= 300)), [selected]);

  useEffect(() => {
    viewerRef.current?.destroy();
    viewerRef.current = null;
    if (!selected || !isSphere || !sphereRef.current) return;
    viewerRef.current = new Viewer({
      container: sphereRef.current,
      panorama: selected.imageUrl,
      navbar: ['zoom', 'move', 'fullscreen'],
      defaultYaw: ((selected.heading || 0) * Math.PI) / 180,
    });
    return () => { viewerRef.current?.destroy(); viewerRef.current = null; };
  }, [selected, isSphere]);

  const headers = { 'x-geoweedo-admin': secret };

  async function loadSaved() {
    sessionStorage.setItem('geoweedo-admin-secret', secret);
    const response = await fetch('/api/admin/dispensaries', { headers });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Admin access failed.');
    setSaved(data.dispensaries || []);
    setStatus('Admin unlocked. Enter a dispensary and validate its imagery.');
  }

  async function geocode() {
    const query = [form.streetAddress, form.city, form.region, form.country].filter(Boolean).join(', ');
    if (!query) return setStatus('Enter an address first.');
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/geocode?q=${encodeURIComponent(query)}`, { headers });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Address lookup failed.');
      const hit = data.results?.[0];
      if (!hit) throw new Error('No OpenStreetMap address match found.');
      setForm((current) => ({
        ...current,
        latitude: String(hit.lat), longitude: String(hit.lng),
        city: current.city || hit.city || '', region: current.region || hit.region || '', country: current.country || hit.country || 'USA',
      }));
      setStatus(`Address matched: ${hit.displayName}`);
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Address lookup failed.'); }
    finally { setBusy(false); }
  }

  async function checkCoverage() {
    const lat = Number(form.latitude); const lng = Number(form.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return setStatus('Valid coordinates are required first.');
    setBusy(true); setPhotos([]);
    try {
      const response = await fetch(`/api/street-imagery?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'KartaView lookup failed.');
      const next = data.photos || [];
      setPhotos(next);
      setSelectedIndex(Math.min(Math.max(data.initialIndex || 0, 0), Math.max(0, next.length - 1)));
      setStatus(next.length ? `Found ${next.length} nearby KartaView frames. Review and choose the best starting image.` : (data.message || 'No KartaView coverage found.'));
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Coverage lookup failed.'); }
    finally { setBusy(false); }
  }

  async function approve() {
    if (!selected) return setStatus('Choose a validated starting image first.');
    setBusy(true);
    try {
      const response = await fetch('/api/admin/dispensaries', {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          latitude: Number(form.latitude), longitude: Number(form.longitude),
          imageryProvider: 'kartaview', imageryPhotoId: selected.id, imagerySequenceId: selected.sequenceId,
          imageryLatitude: selected.lat, imageryLongitude: selected.lng, imageryHeading: selected.heading,
          imageryFieldOfView: selected.fieldOfView, imageryProjection: selected.projection, imageryUrl: selected.imageUrl,
          active: true,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Approval failed.');
      setStatus(`${data.dispensary.name} approved and added to the live game pool.`);
      setForm(emptyForm); setPhotos([]); setSelectedIndex(0);
      await loadSaved();
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Approval failed.'); }
    finally { setBusy(false); }
  }

  async function toggle(item: SavedDispensary) {
    const response = await fetch('/api/admin/dispensaries', {
      method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: item.id, active: !item.active }),
    });
    if (response.ok) await loadSaved();
  }

  return (
    <main className="admin-shell">
      <header className="admin-header"><div><span className="eyebrow">GEOWEEDO ADMIN</span><h1>Dispensary imagery validation</h1></div><a href="/">← Game</a></header>
      <div className="admin-status">{status}</div>

      <section className="admin-grid">
        <div className="admin-panel">
          <h2>1. Admin access</h2>
          <div className="field-row"><input type="password" placeholder="GEOWEEDO_ADMIN_SECRET" value={secret} onChange={(e) => setSecret(e.target.value)} /><button onClick={() => loadSaved().catch((e) => setStatus(e.message))}>Unlock</button></div>

          <h2>2. Dispensary</h2>
          <div className="admin-form">
            <input placeholder="Dispensary name" value={form.name} onChange={(e) => setForm({...form, name:e.target.value})} />
            <input placeholder="Street address" value={form.streetAddress} onChange={(e) => setForm({...form, streetAddress:e.target.value})} />
            <div className="field-row"><input placeholder="City" value={form.city} onChange={(e) => setForm({...form, city:e.target.value})} /><input placeholder="State / region" value={form.region} onChange={(e) => setForm({...form, region:e.target.value})} /></div>
            <div className="field-row"><input placeholder="Country" value={form.country} onChange={(e) => setForm({...form, country:e.target.value})} /><input placeholder="Website (optional)" value={form.website} onChange={(e) => setForm({...form, website:e.target.value})} /></div>
            <button onClick={geocode} disabled={busy || !secret}>Find coordinates from address</button>
            <div className="field-row"><input placeholder="Latitude" value={form.latitude} onChange={(e) => setForm({...form, latitude:e.target.value})} /><input placeholder="Longitude" value={form.longitude} onChange={(e) => setForm({...form, longitude:e.target.value})} /></div>
            <div className="check-row"><label><input type="checkbox" checked={form.recreational} onChange={(e) => setForm({...form, recreational:e.target.checked})} /> Recreational</label><label><input type="checkbox" checked={form.medical} onChange={(e) => setForm({...form, medical:e.target.checked})} /> Medical</label></div>
            <button className="primary" onClick={checkCoverage} disabled={busy || !secret}>Check KartaView coverage</button>
          </div>
        </div>

        <div className="admin-panel preview-panel">
          <h2>3. Validate starting imagery</h2>
          {!selected ? <div className="empty-preview">No imagery selected yet.</div> : <>
            <div className="admin-imagery">
              {isSphere ? <div ref={sphereRef} className="admin-sphere" /> : <img src={selected.imageUrl} alt="Selected KartaView frame" />}
            </div>
            <div className="frame-controls"><button onClick={() => setSelectedIndex(Math.max(0, selectedIndex - 1))} disabled={selectedIndex===0}>← Previous</button><strong>{selectedIndex + 1} / {photos.length}</strong><button onClick={() => setSelectedIndex(Math.min(photos.length - 1, selectedIndex + 1))} disabled={selectedIndex>=photos.length-1}>Next →</button></div>
            <div className="frame-meta"><span>Photo {selected.id}</span><span>Sequence {selected.sequenceId || '—'}</span><span>{isSphere ? '360° imagery' : `${selected.fieldOfView || 'standard'}° FOV`}</span></div>
            <button className="primary full" onClick={approve} disabled={busy}>Approve this starting frame</button>
          </>}
        </div>
      </section>

      <section className="admin-panel approved-list"><h2>Approved game pool</h2>{saved.length === 0 ? <p>No approved real dispensaries yet.</p> : saved.map((item) => <div className="approved-row" key={item.id}><div><strong>{item.name}</strong><span>{item.city}, {item.region} · {item.imageryProvider}</span></div><button onClick={() => toggle(item)}>{item.active ? 'Deactivate' : 'Activate'}</button></div>)}</section>
      <p className="admin-attribution">Address search © OpenStreetMap contributors. Street imagery © KartaView contributors.</p>
    </main>
  );
}
