'use client';

import { useEffect, useMemo, useState } from 'react';
import SiteHeader from '@/components/SiteHeader';
import OwnerMenuScanner from '@/components/OwnerMenuScanner';
import styles from './shop.module.css';

type Assigned = { location_id:string; name:string; city?:string; region?:string; kind?:string; menu_ready?:number; verified_at?:string };
const days = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];

export default function AccountShopPage() {
  const [assigned,setAssigned] = useState<Assigned[]>([]);
  const [selected,setSelected] = useState('');
  const [overview,setOverview] = useState('');
  const [phone,setPhone] = useState('');
  const [website,setWebsite] = useState('');
  const [amenities,setAmenities] = useState('');
  const [hours,setHours] = useState<Record<string,string>>({});
  const [instagram,setInstagram] = useState('');
  const [facebook,setFacebook] = useState('');
  const [message,setMessage] = useState<string|null>(null);
  const [error,setError] = useState<string|null>(null);
  const [loading,setLoading] = useState(true);
  const [saving,setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/account/owner-profile',{cache:'no-store'}).then(async response => {
      if (response.status === 401) { window.location.href = '/account'; return null; }
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Could not load your verified shops.');
      const rows = Array.isArray(body.locations) ? body.locations : [];
      setAssigned(rows);
      if (rows[0]) setSelected(rows[0].location_id);
      return body;
    }).catch(loadError => setError(loadError instanceof Error ? loadError.message : 'Could not load your verified shops.'))
      .finally(() => setLoading(false));
  },[]);

  useEffect(() => {
    if (!selected) return;
    setError(null);
    setMessage(null);
    fetch(`/api/account/owner-profile/${encodeURIComponent(selected)}`,{cache:'no-store'}).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Could not load shop profile.');
      const profile = body.profile || {};
      setOverview(profile.overview || '');
      setPhone(profile.phone || body.location?.phone || '');
      setWebsite(profile.website || body.location?.website || '');
      setAmenities((profile.amenities || []).join(', '));
      setHours(profile.hours || {});
      setInstagram(profile.social?.instagram || '');
      setFacebook(profile.social?.facebook || '');
    }).catch(profileError => setError(profileError instanceof Error ? profileError.message : 'Could not load shop profile.'));
  },[selected]);

  const selectedAssignment = useMemo(() => assigned.find(row => row.location_id === selected) || null,[assigned,selected]);

  async function save() {
    if (!selected) return;
    setSaving(true); setMessage(null); setError(null);
    try {
      const response = await fetch(`/api/account/owner-profile/${encodeURIComponent(selected)}`,{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          overview,phone,website,hours,
          amenities:amenities.split(',').map(value=>value.trim()).filter(Boolean),
          social:{instagram,facebook},
        }),
      });
      const body = await response.json().catch(()=>({}));
      if (!response.ok) throw new Error(body.error || 'Could not save your shop profile.');
      setMessage('Shop profile saved.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save your shop profile.');
    } finally { setSaving(false); }
  }

  return <main className={styles.shell}>
    <SiteHeader/>
    <div className={styles.page}>
      <header className={styles.hero}>
        <div><span>VERIFIED DISPENSARY OWNER</span><h1>Manage your shop</h1><p>Update your public dispensary profile and scan QR codes or barcodes directly into your live GeoWeedo menu.</p></div>
        <a className={styles.back} href="/account">← Back to account</a>
      </header>

      {loading ? <div className={styles.loading}>Loading your verified dispensary…</div> : assigned.length === 0 ? <div className={styles.empty}>This account does not currently own an approved dispensary. Once an ownership claim is approved, the shop workspace appears here automatically.</div> : <>
        <section className={styles.panel}>
          <div className={styles.verified}><strong>✓ VERIFIED DISPENSARY OWNER</strong><span>{assigned.length === 1 ? assigned[0].name : `${assigned.length} verified shops`}</span></div>
          <div className={styles.form}>
            <label>Shop<select value={selected} onChange={event=>setSelected(event.target.value)}>{assigned.map(row=><option key={row.location_id} value={row.location_id}>{row.name} · {[row.city,row.region].filter(Boolean).join(', ')}</option>)}</select></label>
            <label>Overview<textarea value={overview} maxLength={5000} onChange={event=>setOverview(event.target.value)} placeholder="Tell visitors about the shop, specialties, atmosphere, accessibility, and what makes it useful."/></label>
            <div className={styles.grid}><label>Phone<input value={phone} onChange={event=>setPhone(event.target.value)}/></label><label>Website<input value={website} onChange={event=>setWebsite(event.target.value)} placeholder="https://…"/></label><label>Instagram<input value={instagram} onChange={event=>setInstagram(event.target.value)}/></label><label>Facebook<input value={facebook} onChange={event=>setFacebook(event.target.value)}/></label></div>
            <label>Amenities<input value={amenities} onChange={event=>setAmenities(event.target.value)} placeholder="Delivery, ATM, Parking, Wheelchair accessible…"/></label>
            <div className={styles.hours}><strong>Hours</strong>{days.map(day=><label key={day}><span>{day}</span><input value={hours[day]||''} onChange={event=>setHours(current=>({...current,[day]:event.target.value}))} placeholder="9:00 AM – 8:00 PM"/></label>)}</div>
            <div className={styles.actions}><button className={styles.primary} type="button" onClick={save} disabled={saving}>{saving?'Saving…':'Save public profile'}</button></div>
            {message?<div className={styles.notice}>{message}</div>:null}{error?<div className={styles.error}>{error}</div>:null}
            <p className={styles.scope}>Official license/source fields, coordinates, gameplay approval, reviews, user accounts, rewards, and finance records remain protected from owner editing.</p>
          </div>
        </section>

        {selectedAssignment?.menu_ready ? <OwnerMenuScanner dispensaryId={selected} apiBase="/api/account/owner-menu"/> : <section className={styles.panel}><h2>Menu scanning becomes available when this location is live</h2><p>Your ownership is verified, but this location is still a candidate or is not currently active/verified in the public dispensary database. Once it goes live, the QR/barcode product scanner appears here automatically.</p></section>}
      </>}
    </div>
  </main>;
}
