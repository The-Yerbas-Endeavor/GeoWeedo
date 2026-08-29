'use client';

import { useState } from 'react';

export default function AdminLoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState('Sign in with a GeoWeedo administrator account.');
  const [busy, setBusy] = useState(false);

  async function login() {
    setBusy(true);
    try {
      const response = await fetch('/api/admin/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Admin login failed.');
      window.location.href = '/admin';
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Admin login failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="result-shell">
      <section className="result-card">
        <div className="eyebrow">GEOWEEDO ADMIN</div>
        <h2>Administrator login</h2>
        <p>{status}</p>
        <div className="admin-form">
          <input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Username" />
          <input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" onKeyDown={(event) => { if (event.key === 'Enter') login(); }} />
          <button className="primary" disabled={busy || !username || !password} onClick={login}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </div>
      </section>
    </main>
  );
}
