'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import GuessMap, { LatLng } from '@/components/GuessMap';
import SiteHeader from '@/components/SiteHeader';
import StreetViewStage from '@/components/StreetViewStage';
import { dispensaries, type Dispensary } from '@/data/dispensaries';
import { DEFAULT_YERB_PER_POINT, yerbFromScore } from '@/lib/yerbasRewards';

const MAX_SCORE = 5000;

function distanceKm(a: LatLng, b: LatLng) {
  const radiusKm = 6371.0088;
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const haversine = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return radiusKm * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function scoreFromDistance(km: number) {
  return Math.max(0, Math.min(MAX_SCORE, Math.round(MAX_SCORE * Math.exp(-km / 500))));
}

export default function HomePage() {
  const [started, setStarted] = useState(false);
  const [round, setRound] = useState(0);
  const [scores, setScores] = useState<number[]>([]);
  const [guess, setGuess] = useState<LatLng | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [roundDistance, setRoundDistance] = useState<number | null>(null);
  const [roundScore, setRoundScore] = useState<number | null>(null);
  const [approvedDispensaries, setApprovedDispensaries] = useState<Dispensary[]>([]);

  useEffect(() => {
    fetch('/api/dispensaries', { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error('Failed to load approved dispensaries.')))
      .then((data) => setApprovedDispensaries(Array.isArray(data.dispensaries) ? data.dispensaries : []))
      .catch(() => setApprovedDispensaries([]));
  }, []);

  const rounds = useMemo(() => {
    const approved = approvedDispensaries.filter((item) => item.active && item.verified && item.imageryPhotoId);
    const demos = dispensaries.filter((item) => item.active);
    const pool = approved.length >= 5 ? approved : [...approved, ...demos.filter((demo) => !approved.some((item) => item.id === demo.id))];
    return pool.slice(0, 5);
  }, [approvedDispensaries]);

  const current = rounds[round];
  const total = scores.reduce((sum, value) => sum + value, 0);
  const completedTotal = total + (revealed && roundScore !== null ? roundScore : 0);
  const estimatedYerb = yerbFromScore(completedTotal, DEFAULT_YERB_PER_POINT);
  const onGuess = useCallback((value: LatLng) => setGuess(value), []);

  const beginGame = () => {
    setStarted(true);
    setRound(0);
    setScores([]);
    setGuess(null);
    setRevealed(false);
    setRoundDistance(null);
    setRoundScore(null);
  };

  const revealGuess = () => {
    if (!guess || !current) return;
    const actual = { lat: current.latitude, lng: current.longitude };
    const distance = distanceKm(guess, actual);
    setRoundDistance(distance);
    setRoundScore(scoreFromDistance(distance));
    setRevealed(true);
  };

  const nextRound = () => {
    if (roundScore === null) return;
    setScores((previous) => [...previous, roundScore]);
    setRound((previous) => previous + 1);
    setGuess(null);
    setRevealed(false);
    setRoundDistance(null);
    setRoundScore(null);
  };

  if (!started) {
    return (
      <main className="landing-shell">
        <SiteHeader />
        <section className="hero">
          <div className="eyebrow">THE DISPENSARY GEOGRAPHY GAME</div>
          <h1>How well do you know<br /><span>weed geography?</span></h1>
          <p>Explore the surroundings, find the clues, pinpoint the dispensary, and build a score that can become eligible for YERB rewards.</p>
          <div className="hero-actions">
            <button className="primary" onClick={beginGame}>Play GeoWeedo</button>
            <button className="secondary" onClick={beginGame}>Daily Challenge</button>
          </div>
          <div className="feature-row">
            <div><strong>5</strong><span>rounds per game</span></div>
            <div><strong>25K</strong><span>maximum score</span></div>
            <div><strong>YERB</strong><span>skill-based reward layer</span></div>
          </div>
        </section>

        <section className="preview-card">
          <div className="street-preview">
            <div className="preview-overlay">OPEN STREET IMAGERY</div>
            <div className="road-line" />
            <div className="storefront">DISPENSARY?</div>
          </div>
          <div className="preview-copy">
            <span>LOOK AROUND</span>
            <h2>Every storefront tells a story.</h2>
            <p>Architecture, mountains, road markings, signs and neighboring businesses can all give the location away.</p>
            <p><Link className="yerb-score" href="/rewards">See how YERB rewards work →</Link></p>
          </div>
        </section>
      </main>
    );
  }

  if (!current) {
    return (
      <main className="result-shell">
        <div className="result-card">
          <div className="eyebrow">GAME COMPLETE</div>
          <h1>{total.toLocaleString()} <small>/ 25,000</small></h1>
          <p className="yerb-score">Estimated eligible reward: {yerbFromScore(total, DEFAULT_YERB_PER_POINT)} YERB</p>
          <p>Rewards are not automatically paid yet; wallet verification and anti-abuse checks come before on-chain payouts.</p>
          <div className="score-list">{scores.map((score, index) => <div key={index}><span>Round {index + 1}</span><strong>{score.toLocaleString()}</strong></div>)}</div>
          <button className="primary" onClick={beginGame}>Play again</button>
        </div>
      </main>
    );
  }

  const actual = { lat: current.latitude, lng: current.longitude };

  return (
    <main className="game-shell">
      <header className="game-header">
        <Link className="brand brand-link" href="/"><span className="brand-pin">✦</span> GEOWEEDO</Link>
        <div className="round-meter">ROUND {round + 1} / {rounds.length}</div>
        <div className="running-score">{completedTotal.toLocaleString()} pts · <span className="yerb-score">~{estimatedYerb} YERB</span></div>
      </header>

      <section className="panorama-stage live-panorama">
        <StreetViewStage
          latitude={current.imageryLatitude ?? current.latitude}
          longitude={current.imageryLongitude ?? current.longitude}
          heading={current.imageryHeading ?? current.heading}
          photoId={current.imageryPhotoId}
        />

        <aside className="guess-card live-guess-card">
          <GuessMap guess={guess} actual={actual} revealed={revealed} onGuess={onGuess} />

          {!revealed ? (
            <div className="guess-actions">
              <div className="guess-status">{guess ? 'Pin placed — move it by clicking elsewhere.' : 'Place a pin where you think the dispensary is.'}</div>
              <button className="primary full" disabled={!guess} onClick={revealGuess}>{guess ? 'Make Guess' : 'Place a Pin First'}</button>
            </div>
          ) : (
            <div className="reveal">
              <span className="eyebrow">ACTUAL LOCATION</span>
              <h3>{current.name}</h3>
              <p>{current.city}, {current.region}</p>
              <div className="reveal-stat"><span>Distance</span><strong>{roundDistance === null ? '—' : roundDistance < 1 ? `${Math.round(roundDistance * 1000)} m` : `${roundDistance.toFixed(1)} km`}</strong></div>
              <div className="reveal-stat"><span>Score</span><strong>{roundScore?.toLocaleString() ?? '—'}</strong></div>
              <div className="reveal-stat"><span>Estimated YERB</span><strong className="yerb-score">{roundScore === null ? '—' : yerbFromScore(roundScore, DEFAULT_YERB_PER_POINT)}</strong></div>
              <button className="primary full" onClick={nextRound}>{round + 1 === rounds.length ? 'See Results' : 'Next Round'}</button>
            </div>
          )}
        </aside>
      </section>
    </main>
  );
}
