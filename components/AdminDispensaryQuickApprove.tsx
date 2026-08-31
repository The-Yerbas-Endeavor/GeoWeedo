'use client';

import { useEffect, useState } from 'react';

type Draft = {
  id?: string;
  name?: string;
  streetAddress?: string;
  city?: string;
  region?: string;
  country?: string;
  website?: string;
  latitude?: number;
  longitude?: number;
  dataSource?: string;
  sourceUrl?: string;
  sourceLicense?: string;
};

type Form = {
  name: string;
  streetAddress: string;
  city: string;
  region: string;
  country: string;
  website: string;
  latitude: string;
  longitude: string;
  dataSource: string;
  sourceUrl: string;
  sourceLicense: string;
  recreational: boolean;
  medical: boolean;
};

type StreetPhoto = {
  id: string;
  lat: number;
  lng: number;
  heading?: number;
  fieldOfView?: number;
  projection?: string;
  imageUrl: string;
  sequenceId?: string;
};

const EMPTY: Form = {
  name: '', streetAddress: '', city: '', region: '', country: 'USA', website: '',
  latitude: '', longitude: '', dataSource: 'manual', sourceUrl: '', sourceLicense: '',
  recreational: true, medical: false,
};

export default function AdminDispensaryQuickApprove() {
  const [form, setForm] = useState<Form>(EMPTY);
  const [candidateId, setCandidateId] = useState<string | null>(null);
  const [status, setStatus] = useState('Street View readiness is checked automatically when you approve a dispensary.');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('geoweedo-candidate-draft');
      if (!raw) return;
      const d = JSON.parse(raw) as Draft;
      setCandidateId(d.id || null);
      setForm({
        name: d.name || '', streetAddress: d.streetAddress || '', city: d.city || '', region: d.region || '',
        country: d.country || 'USA', website: d.website || '', latitude: d.latitude == null ? '' : String(d.latitude),
        longitude: d.longitude == null ? '' : String(d.longitude), dataSource: d.dataSource || 'state-registry',
        sourceUrl: d.sourceUrl || '', sourceLicense: d.sourceLicense || '', recreational: true, medical: false,
      });
      setStatus('Candidate loaded. Approve will check Street View automatically.');
      sessionStorage.removeItem('geoweedo-candidate-draft');
    } catch {}
  }, []);

  async function geocode() {
    const query = [form.streetAddress, form.city, form.region, form.country].filter(Boolean).join(', ');
    if (!query) return setStatus('Enter an address first.');
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/geocode?q=${encodeURIComponent(query)}`, { cache: 'no-store' });
      if (response.status === 401) { location.href = '/admin/login'; return; }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Address lookup failed.');
      const hit = data.results?.[0];
      if (!hit) throw new Error('No address match found.');
      setForm(current => ({ ...current, latitude: String(hit.lat), longitude: String(hit.lng), city: current.city || hit.city || '', region: current.region || hit.region || '', country: current.country || hit.country || 'USA' }));
      setStatus(`Coordinates found: ${Number(hit.lat).toFixed(6)}, ${Number(hit.lng).toFixed(6)}.`);
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Address lookup failed.'); }
    finally { setBusy(false); }
  }

  async function approve() {
    const latitude = Number(form.latitude), longitude = Number(form.longitude);
    if (!form.name.trim() || !form.city.trim() || !form.region.trim() || !form.country.trim()) return setStatus('Name, city, state / region, and country are required.');
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return setStatus('Valid coordinates are required.');
    setBusy(true);
    setStatus('Checking Street View readiness…');
    try {
      const imageryResponse = await fetch(`/api/street-imagery?lat=${encodeURIComponent(latitude)}&lng=${encodeURIComponent(longitude)}`, { cache: 'no-store' });
      const imagery = await imageryResponse.json();
      if (!imageryResponse.ok) throw new Error(imagery.error || 'Street View lookup failed.');
      const photos: StreetPhoto[] = Array.isArray(imagery.photos) ? imagery.photos : [];
      const index = Math.min(Math.max(Number(imagery.initialIndex || 0), 0), Math.max(photos.length - 1, 0));
      const photo = photos[index] || photos[0];
      if (!photo || !imagery.quality?.playable) {
        const provider = imagery.provider === 'google' ? 'Google Street View' : 'Street View fallback';
        throw new Error(`${provider} is not gameplay-ready here: ${imagery.quality?.reason || imagery.message || 'no usable imagery found.'}`);
      }

      const saveResponse = await fetch('/api/admin/dispensaries', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form, latitude, longitude, imageryProvider: imagery.provider,
          imageryPhotoId: photo.id, imagerySequenceId: photo.sequenceId,
          imageryLatitude: photo.lat, imageryLongitude: photo.lng,
          imageryHeading: photo.heading, imageryFieldOfView: photo.fieldOfView,
          imageryProjection: photo.projection, imageryUrl: photo.imageUrl, active: true,
        }),
      });
      if (saveResponse.status === 401) { location.href = '/admin/login'; return; }
      const saved = await saveResponse.json();
      if (!saveResponse.ok) throw new Error(saved.error || 'Dispensary approval failed.');

      if (candidateId) {
        await fetch('/api/admin/candidates', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: candidateId, status: 'reviewing' }) }).catch(() => null);
      }
      const providerLabel = imagery.provider === 'google' ? 'Google 360°' : 'Street View fallback';
      setStatus(`${saved.dispensary.name} approved · ${providerLabel} · Grade ${imagery.quality.grade} · gameplay ready.`);
      setCandidateId(null);
      setForm(EMPTY);
      window.dispatchEvent(new Event('geoweedo-dispensaries-updated'));
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Approval failed.'); }
    finally { setBusy(false); }
  }

  return <section className="admin-panel" style={{ marginBottom: 24 }}>
    <div><span className="eyebrow">QUICK APPROVAL</span><h2 style={{ margin: '4px 0' }}>Add / approve dispensary</h2><p style={{ margin: 0, color: 'var(--muted)' }}>No separate imagery-validator step. GeoWeedo checks the configured Street View provider automatically and only enables gameplay when the imagery qualifies.</p></div>
    <div className="admin-status" style={{ margin: '14px 0' }}>{status}</div>
    <div className="admin-form">
      <input placeholder="Dispensary name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}/>
      <input placeholder="Street address" value={form.streetAddress} onChange={e => setForm({ ...form, streetAddress: e.target.value })}/>
      <div className="field-row"><input placeholder="City" value={form.city} onChange={e => setForm({ ...form, city: e.target.value })}/><input placeholder="State / region" value={form.region} onChange={e => setForm({ ...form, region: e.target.value })}/></div>
      <div className="field-row"><input placeholder="Country" value={form.country} onChange={e => setForm({ ...form, country: e.target.value })}/><input placeholder="Website (optional)" value={form.website} onChange={e => setForm({ ...form, website: e.target.value })}/></div>
      <div className="field-row"><select value={form.dataSource} onChange={e => setForm({ ...form, dataSource: e.target.value })}><option value="manual">Manual / business supplied</option><option value="state-registry">Official license registry</option><option value="open-data">Compatible open data</option><option value="weedmaps-authorized">Weedmaps authorized/API</option></select><input placeholder="Source URL (optional)" value={form.sourceUrl} onChange={e => setForm({ ...form, sourceUrl: e.target.value })}/></div>
      <input placeholder="Source license / permission note (optional)" value={form.sourceLicense} onChange={e => setForm({ ...form, sourceLicense: e.target.value })}/>
      <button type="button" onClick={geocode} disabled={busy}>Find coordinates from address</button>
      <div className="field-row"><input placeholder="Latitude" value={form.latitude} onChange={e => setForm({ ...form, latitude: e.target.value })}/><input placeholder="Longitude" value={form.longitude} onChange={e => setForm({ ...form, longitude: e.target.value })}/></div>
      <div className="check-row"><label><input type="checkbox" checked={form.recreational} onChange={e => setForm({ ...form, recreational: e.target.checked })}/> Recreational</label><label><input type="checkbox" checked={form.medical} onChange={e => setForm({ ...form, medical: e.target.checked })}/> Medical</label></div>
      <button type="button" className="primary" onClick={approve} disabled={busy}>{busy ? 'Checking Street View…' : 'Approve + check Street View'}</button>
    </div>
  </section>;
}
