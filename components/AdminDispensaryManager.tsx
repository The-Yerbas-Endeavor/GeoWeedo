'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Viewer } from '@photo-sphere-viewer/core';

type StreetPhoto = { id: string; lat: number; lng: number; heading: number; fieldOfView: number; projection: string; imageUrl: string; sequenceId: string; sequenceIndex: number; shotDate?: string | null };
type SavedDispensary = { id: string; name: string; city: string; region: string; country: string; imageryProvider: string; dataSource?: string; active: boolean };
type CandidateDraft = { name?: string; streetAddress?: string; city?: string; region?: string; country?: string; website?: string; latitude?: number; longitude?: number; dataSource?: string; sourceUrl?: string; sourceLicense?: string };

const emptyForm = {
  name: '', streetAddress: '', city: '', region: '', country: 'USA', website: '',
  dataSource: 'manual', sourceUrl: '', sourceLicense: '',
  latitude: '', longitude: '', recreational: true, medical: false,
};

export default function AdminDispensaryManager() {
  const [form, setForm] = useState(emptyForm);
  const [photos, setPhotos] = useState<StreetPhoto[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [imageryProvider, setImageryProvider] = useState<'kartaview' | 'geoweedo'>('kartaview');
  const [hostedFile, setHostedFile] = useState<File | null>(null);
  const [hosted360, setHosted360] = useState(false);
  const [saved, setSaved] = useState<SavedDispensary[]>([]);
  const [status, setStatus] = useState('Loading imagery validator…');
  const [busy, setBusy] = useState(false);
  const sphereRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<Viewer | null>(null);

  useEffect(() => {
    try {
      const draftRaw = sessionStorage.getItem('geoweedo-candidate-draft');
      if (draftRaw) {
        const draft = JSON.parse(draftRaw) as CandidateDraft;
        setForm((current) => ({ ...current,
          name: draft.name || '', streetAddress: draft.streetAddress || '', city: draft.city || '', region: draft.region || '', country: draft.country || 'USA', website: draft.website || '',
          latitude: draft.latitude === undefined ? '' : String(draft.latitude), longitude: draft.longitude === undefined ? '' : String(draft.longitude),
          dataSource: draft.dataSource || 'state-registry', sourceUrl: draft.sourceUrl || '', sourceLicense: draft.sourceLicense || '',
        }));
        setStatus('Candidate loaded from the import queue. Confirm coordinates and imagery before approval.');
        sessionStorage.removeItem('geoweedo-candidate-draft');
      }
    } catch {}
    loadSaved().catch((error) => setStatus(error.message));
  }, []);

  const selected = photos[selectedIndex];
  const isSphere = useMemo(() => Boolean(selected && (selected.projection === 'SPHERE' || selected.fieldOfView >= 300)), [selected]);

  useEffect(() => {
    viewerRef.current?.destroy(); viewerRef.current = null;
    if (!selected || !isSphere || !sphereRef.current) return;
    viewerRef.current = new Viewer({
      container: sphereRef.current,
      panorama: selected.imageUrl,
      navbar: ['zoom', 'move', 'fullscreen'],
      defaultYaw: ((selected.heading || 0) * Math.PI) / 180,
      mousemove: true,
      mousewheel: true,
      mousewheelCtrlKey: false,
      touchmoveTwoFingers: false,
    });
    return () => { viewerRef.current?.destroy(); viewerRef.current = null; };
  }, [selected, isSphere]);

  async function loadSaved() {
    const response = await fetch('/api/admin/dispensaries', { cache: 'no-store' });
    if (response.status === 401) { window.location.href = '/admin/login'; return; }
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Admin access failed.');
    setSaved(data.dispensaries || []);
    setStatus((current) => current.startsWith('Candidate loaded') ? current : 'Imagery validator ready.');
  }

  async function geocode() {
    const query = [form.streetAddress, form.city, form.region, form.country].filter(Boolean).join(', ');
    if (!query) return setStatus('Enter an address first.');
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/geocode?q=${encodeURIComponent(query)}`);
      if (response.status === 401) { window.location.href = '/admin/login'; return; }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Address lookup failed.');
      const hit = data.results?.[0]; if (!hit) throw new Error('No OpenStreetMap address match found.');
      setForm((current) => ({ ...current, latitude: String(hit.lat), longitude: String(hit.lng), city: current.city || hit.city || '', region: current.region || hit.region || '', country: current.country || hit.country || 'USA' }));
      setStatus(`Address matched: ${hit.displayName}`);
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Address lookup failed.'); }
    finally { setBusy(false); }
  }

  async function checkCoverage() {
    const lat = Number(form.latitude); const lng = Number(form.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return setStatus('Valid coordinates are required first.');
    setBusy(true); setPhotos([]); setImageryProvider('kartaview');
    try {
      const response = await fetch(`/api/street-imagery?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}`); const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'KartaView lookup failed.');
      const next = data.photos || []; setPhotos(next); setSelectedIndex(Math.min(Math.max(data.initialIndex || 0, 0), Math.max(0, next.length - 1)));
      setStatus(next.length ? `Found ${next.length} nearby KartaView frames. Review and choose the best starting image.` : (data.message || 'No KartaView coverage found. Upload GeoWeedo-hosted imagery instead.'));
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Coverage lookup failed.'); }
    finally { setBusy(false); }
  }

  async function uploadHosted() {
    const lat = Number(form.latitude); const lng = Number(form.longitude);
    if (!hostedFile) return setStatus('Choose a JPEG, PNG, or WebP image first.');
    if (!form.name.trim()) return setStatus('Enter the dispensary name before uploading.');
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return setStatus('Confirm dispensary coordinates before uploading imagery.');
    setBusy(true);
    try {
      const body = new FormData(); body.set('file', hostedFile); body.set('slug', form.name);
      const response = await fetch('/api/admin/imagery/upload', { method: 'POST', body });
      if (response.status === 401) { window.location.href = '/admin/login'; return; }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Image upload failed.');
      const photo: StreetPhoto = { id: data.photoId, lat, lng, heading: 0, fieldOfView: hosted360 ? 360 : 0, projection: hosted360 ? 'SPHERE' : 'FLAT', imageUrl: data.imageUrl, sequenceId: 'geoweedo', sequenceIndex: 0 };
      setImageryProvider('geoweedo'); setPhotos([photo]); setSelectedIndex(0);
      setStatus('GeoWeedo-hosted imagery uploaded. Review the frame, then approve it into the game pool.');
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Image upload failed.'); }
    finally { setBusy(false); }
  }

  async function approve() {
    if (!selected) return setStatus('Choose a validated starting image first.');
    setBusy(true);
    try {
      const response = await fetch('/api/admin/dispensaries', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, latitude: Number(form.latitude), longitude: Number(form.longitude), imageryProvider,
          imageryPhotoId: selected.id, imagerySequenceId: selected.sequenceId, imageryLatitude: selected.lat, imageryLongitude: selected.lng,
          imageryHeading: selected.heading, imageryFieldOfView: selected.fieldOfView, imageryProjection: selected.projection, imageryUrl: selected.imageUrl, active: true }),
      });
      if (response.status === 401) { window.location.href = '/admin/login'; return; }
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Approval failed.');
      setStatus(`${data.dispensary.name} approved with ${imageryProvider === 'geoweedo' ? 'GeoWeedo-hosted' : 'KartaView'} imagery.`);
      setForm(emptyForm); setPhotos([]); setSelectedIndex(0); setHostedFile(null); setHosted360(false); setImageryProvider('kartaview'); await loadSaved();
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Approval failed.'); }
    finally { setBusy(false); }
  }

  async function toggle(item: SavedDispensary) {
    const response = await fetch('/api/admin/dispensaries', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: item.id, active: !item.active }) });
    if (response.status === 401) { window.location.href = '/admin/login'; return; }
    if (response.ok) await loadSaved();
  }

  async function logout() {
    await fetch('/api/admin/auth/logout', { method: 'POST' });
    window.location.href = '/admin/login';
  }

  return (
    <main className="admin-shell">
      <header className="admin-header"><div><span className="eyebrow">GEOWEEDO ADMIN</span><h1>Dispensary imagery validation</h1></div><div className="admin-links"><a href="/admin/data">Data import</a><a href="/admin/rewards">Rewards</a><a href="/admin/sponsorships">Sponsorships</a><a href="/admin/withdrawals">Withdrawals</a><a href="/">Game</a><button className="ghost" onClick={logout}>Log out</button></div></header>
      <div className="admin-status">{status}</div>
      <section className="admin-grid">
        <div className="admin-panel">
          <h2>Dispensary</h2><div className="admin-form">
            <input placeholder="Dispensary name" value={form.name} onChange={(e) => setForm({...form, name:e.target.value})} />
            <input placeholder="Street address" value={form.streetAddress} onChange={(e) => setForm({...form, streetAddress:e.target.value})} />
            <div className="field-row"><input placeholder="City" value={form.city} onChange={(e) => setForm({...form, city:e.target.value})} /><input placeholder="State / region" value={form.region} onChange={(e) => setForm({...form, region:e.target.value})} /></div>
            <div className="field-row"><input placeholder="Country" value={form.country} onChange={(e) => setForm({...form, country:e.target.value})} /><input placeholder="Website (optional)" value={form.website} onChange={(e) => setForm({...form, website:e.target.value})} /></div>
            <div className="field-row"><select value={form.dataSource} onChange={(e) => setForm({...form, dataSource:e.target.value})}><option value="manual">Manual / business supplied</option><option value="state-registry">Official license registry</option><option value="open-data">Compatible open data</option><option value="weedmaps-authorized">Weedmaps authorized/API</option></select><input placeholder="Source URL (optional)" value={form.sourceUrl} onChange={(e) => setForm({...form, sourceUrl:e.target.value})} /></div>
            <input placeholder="Source license / permission note (optional)" value={form.sourceLicense} onChange={(e) => setForm({...form, sourceLicense:e.target.value})} />
            <button onClick={geocode} disabled={busy}>Find coordinates from address</button>
            <div className="field-row"><input placeholder="Latitude" value={form.latitude} onChange={(e) => setForm({...form, latitude:e.target.value})} /><input placeholder="Longitude" value={form.longitude} onChange={(e) => setForm({...form, longitude:e.target.value})} /></div>
            <div className="check-row"><label><input type="checkbox" checked={form.recreational} onChange={(e) => setForm({...form, recreational:e.target.checked})} /> Recreational</label><label><input type="checkbox" checked={form.medical} onChange={(e) => setForm({...form, medical:e.target.checked})} /> Medical</label></div>
            <button className="primary" onClick={checkCoverage} disabled={busy}>Check KartaView coverage</button>
            <div className="hosted-upload"><strong>Or use GeoWeedo-hosted imagery</strong><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setHostedFile(e.target.files?.[0] || null)} /><label><input type="checkbox" checked={hosted360} onChange={(e) => setHosted360(e.target.checked)} /> Equirectangular 360° panorama</label><button onClick={uploadHosted} disabled={busy || !hostedFile}>Upload hosted image</button></div>
          </div>
        </div>
        <div className="admin-panel preview-panel"><h2>Validate starting imagery</h2>{!selected ? <div className="empty-preview">No imagery selected yet.</div> : <><div className="admin-imagery">{isSphere ? <div ref={sphereRef} className="admin-sphere" /> : <img src={selected.imageUrl} alt="Selected starting frame" />}</div>{photos.length > 1 && <div className="frame-controls"><button onClick={() => setSelectedIndex(Math.max(0, selectedIndex - 1))} disabled={selectedIndex===0}>← Previous</button><strong>{selectedIndex + 1} / {photos.length}</strong><button onClick={() => setSelectedIndex(Math.min(photos.length - 1, selectedIndex + 1))} disabled={selectedIndex>=photos.length-1}>Next →</button></div>}<div className="frame-meta"><span>{imageryProvider === 'geoweedo' ? 'GeoWeedo hosted' : 'KartaView'}</span><span>Photo {selected.id}</span><span>{isSphere ? '360° imagery' : `${selected.fieldOfView || 'standard'}° FOV`}</span></div><button className="primary full" onClick={approve} disabled={busy}>Approve this starting frame</button></>}</div>
      </section>
      <section className="admin-panel approved-list"><h2>Approved game pool</h2>{saved.length === 0 ? <p>No approved real dispensaries yet.</p> : saved.map((item) => <div className="approved-row" key={item.id}><div><strong>{item.name}</strong><span>{item.city}, {item.region} · {item.imageryProvider} · {item.dataSource || 'manual'}</span></div><button onClick={() => toggle(item)}>{item.active ? 'Deactivate' : 'Activate'}</button></div>)}</section>
      <p className="admin-attribution">Address search © OpenStreetMap contributors. KartaView imagery © contributors. GeoWeedo-hosted images must be supplied with permission for game use.</p>
    </main>
  );
}
