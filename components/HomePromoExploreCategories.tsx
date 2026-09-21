'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

const HOST_CLASS = 'home-explore-category-host';

function preparePromoShell() {
  const shell = document.querySelector<HTMLElement>('.home-promo-shell');
  if (!shell) return null;

  shell.classList.add('home-promo-explore-updated');

  let host = shell.querySelector<HTMLElement>(`:scope > .${HOST_CLASS}`);
  if (!host) {
    host = document.createElement('div');
    host.className = HOST_CLASS;
    const divider = shell.querySelector<HTMLElement>(':scope > .home-promo-divider');
    if (divider) divider.insertAdjacentElement('afterend', host);
    else shell.prepend(host);
  }

  const closeButton = shell.closest('.home-play-card')?.querySelector<HTMLButtonElement>('.home-promo-close');
  if (closeButton) closeButton.setAttribute('aria-label', 'Close GeoWeedo explorer');

  return { shell, host };
}

function updateClosedLauncher() {
  const launcher = document.querySelector<HTMLButtonElement>('button[aria-label="Choose a GeoWeedo game"]');
  if (!launcher) return;
  launcher.textContent = 'Explore GeoWeedo';
  launcher.setAttribute('aria-label', 'Explore GeoWeedo');
}

export default function HomePromoExploreCategories() {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [playOpen, setPlayOpen] = useState(false);

  useEffect(() => {
    const refresh = () => {
      const prepared = preparePromoShell();
      updateClosedLauncher();
      setTarget((current) => {
        const next = prepared?.host ?? null;
        return current === next ? current : next;
      });
    };

    refresh();
    const observer = new MutationObserver(refresh);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const shell = target?.closest<HTMLElement>('.home-promo-shell');
    if (!shell) return;
    shell.classList.toggle('home-promo-play-open', playOpen);
  }, [playOpen, target]);

  if (!target) return null;

  const openSearch = () => {
    const shell = target.closest<HTMLElement>('.home-promo-shell');
    const originalSearch = shell?.querySelector<HTMLButtonElement>('button[aria-label="Findo GeoWeedo on the dispensary map"]');
    originalSearch?.click();
  };

  return createPortal(
    playOpen ? (
      <div className="home-games-panel-head">
        <button type="button" className="home-games-back" onClick={() => setPlayOpen(false)}>
          ← Explore GeoWeedo
        </button>
        <div className="home-games-title">
          <span className="home-games-icon" aria-hidden="true">🎮</span>
          <div>
            <strong>Play GeoWeedo</strong>
            <small>Choose a game mode and start playing.</small>
          </div>
        </div>
      </div>
    ) : (
      <>
        <div className="home-explore-intro">
          <div className="home-explore-kicker">EXPLORE GEOWEEDO</div>
          <p>Search dispensaries, scan cannabis products, or jump into a GeoWeedo game.</p>
        </div>
        <div className="home-explore-categories" role="group" aria-label="Explore GeoWeedo">
          <button type="button" className="home-explore-card home-explore-search" onClick={openSearch}>
            <span className="home-explore-icon" aria-hidden="true">🔎</span>
            <span className="home-explore-copy">
              <strong>Search GeoWeedo</strong>
              <small>Find dispensaries, browse the map, and explore locations.</small>
            </span>
            <b>SEARCH →</b>
          </button>

          <a className="home-explore-card home-explore-scan" href="/geoweedo-facts">
            <span className="home-explore-icon" aria-hidden="true">📷</span>
            <span className="home-explore-copy">
              <strong>Scan GeoWeedo</strong>
              <small>Scan packages, QR codes, barcodes, batches, and COAs with GeoWeedo Facts.</small>
            </span>
            <b>SCAN →</b>
          </a>

          <button
            type="button"
            className="home-explore-card home-explore-play"
            onClick={() => setPlayOpen(true)}
            aria-haspopup="true"
          >
            <span className="home-explore-icon" aria-hidden="true">🎮</span>
            <span className="home-explore-copy">
              <strong>Play GeoWeedo</strong>
              <small>Classic GeoWeedo · GeoWeedo Hunt · Daily GeoWeedo · Sponsored Missions</small>
            </span>
            <b>PLAY →</b>
          </button>
        </div>
      </>
    ),
    target,
  );
}
