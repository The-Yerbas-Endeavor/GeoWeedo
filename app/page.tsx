'use client';

import { useMemo, useState } from 'react';
import { dispensaries } from '@/data/dispensaries';

const MAX_SCORE = 5000;

function scoreFromDistance(km: number) {
  return Math.max(0, Math.round(MAX_SCORE * Math.exp(-km / 500)));
}

export default function HomePage() {
  const [started, setStarted] = useState(false);
  const [round, setRound] = useState(0);
  const [scores, setScores] = useState<number[]>([]);
  const [revealed, setRevealed] = useState(false);

  const rounds = useMemo(() => dispensaries.slice(0, 5), []);
  const current = rounds[round];
  const total = scores.reduce((sum, value) => sum + value, 0);

  if (!started) {
    return (
      <main className="landing-shell">
        <nav className="topbar">
          <div className="brand"><span className="brand-pin">✦</span> GEOWEEDO</div>
          <div className="nav-actions"><button className="ghost">How to play</button><button className="ghost">About</button></div>
        </nav>

        <section className="hero">
          <div className="eyebrow">THE DISPENSARY GEOGRAPHY GAME</div>
          <h1>How well do you know<br /><span>weed geography?</span></h1>
          <p>Explore the surroundings, find the clues, and pinpoint the dispensary on the map.</p>
          <div className="hero-actions">
            <button className="primary" onClick={() => setStarted(true)}>Play GeoWeedo</button>
            <button className="secondary" onClick={() => setStarted(true)}>Daily Challenge</button>
          </div>
          <div className="feature-row">
            <div><strong>5</strong><span>rounds per game</span></div>
            <div><strong>25K</strong><span>maximum score</span></div>
            <div><strong>∞</strong><span>places to learn</span></div>
          </div>
        </section>

        <section className="preview-card">
          <div className="street-preview">
            <div className="preview-overlay">STREET VIEW PROVIDER</div>
            <div className="road-line" />
            <div className="storefront">DISPENSARY?</div>
          </div>
          <div className="preview-copy">
            <span>LOOK AROUND</span>
            <h2>Every storefront tells a story.</h2>
            <p>Architecture, mountains, road markings, signs and neighboring businesses can all give the location away.</p>
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
          <p>GeoWeedo 🌿</p>
          <div className="score-list">{scores.map((score, index) => <div key={index}><span>Round {index + 1}</span><strong>{score.toLocaleString()}</strong></div>)}</div>
          <button className="primary" onClick={() => { setRound(0); setScores([]); setRevealed(false); }}>Play again</button>
        </div>
      </main>
    );
  }

  const demoDistance = 6.8 + round * 14.7;
  const demoScore = scoreFromDistance(demoDistance);

  return (
    <main className="game-shell">
      <header className="game-header">
        <div className="brand"><span className="brand-pin">✦</span> GEOWEEDO</div>
        <div className="round-meter">ROUND {round + 1} / 5</div>
        <div className="running-score">{total.toLocaleString()} pts</div>
      </header>

      <section className="panorama-stage">
        <div className="panorama-copy">
          <span>Panorama adapter ready</span>
          <h2>Explore. Read the clues.<br />Find the dispensary.</h2>
          <p>Google Street View or another panorama provider plugs into this stage without changing the game logic.</p>
        </div>
        <button className="map-toggle">Open guessing map</button>

        <aside className="guess-card">
          {!revealed ? (
            <>
              <div className="mini-map"><div className="pin">●</div><span>Drop your pin</span></div>
              <button className="primary full" onClick={() => setRevealed(true)}>Make Guess</button>
            </>
          ) : (
            <div className="reveal">
              <span className="eyebrow">ACTUAL LOCATION</span>
              <h3>{current.name}</h3>
              <p>{current.city}, {current.region}</p>
              <div className="reveal-stat"><span>Distance</span><strong>{demoDistance.toFixed(1)} km</strong></div>
              <div className="reveal-stat"><span>Score</span><strong>{demoScore.toLocaleString()}</strong></div>
              <button className="primary full" onClick={() => { setScores([...scores, demoScore]); setRound(round + 1); setRevealed(false); }}>Next Round</button>
            </div>
          )}
        </aside>
      </section>
    </main>
  );
}
