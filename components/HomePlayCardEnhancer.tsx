'use client';

import { useEffect } from 'react';

function parseMeta(card: HTMLElement) {
  const values = Array.from(card.querySelectorAll<HTMLElement>('.home-play-meta span')).map((node) => node.textContent?.trim() || '');
  const find = (needle: string) => values.find((value) => value.toLowerCase().includes(needle)) || '';
  return {
    playable: find('playable'),
    mapped: find('mapped'),
    states: find('u.s. states'),
    countries: find('countr'),
    rewards: find('yerb') || find('rewards'),
  };
}

export default function HomePlayCardEnhancer() {
  useEffect(() => {
    let timer: number | undefined;

    const enhance = () => {
      const card = document.querySelector<HTMLElement>('.map-first-home .home-play-card');
      if (!card || card.dataset.promoEnhanced === 'true') return;

      const playButton = card.querySelector<HTMLButtonElement>('.home-play-button');
      if (!playButton) return;

      const meta = parseMeta(card);

      // Wait for the async map coverage response before replacing the live React markup.
      // This keeps the promo from freezing the initial approved-only mapped count and
      // prevents U.S. states / countries from becoming permanent em dashes.
      if (!meta.states || !meta.countries) return;

      card.dataset.promoEnhanced = 'true';
      card.classList.add('home-play-card-promo');

      const close = card.querySelector<HTMLButtonElement>('button[aria-label="Close game intro"]');
      if (close) close.classList.add('home-promo-close');

      const shell = document.createElement('div');
      shell.className = 'home-promo-shell';

      const tagline = document.createElement('div');
      tagline.className = 'home-promo-tagline';
      tagline.textContent = 'WEEDO SEARCH. WEEDO FIND. WEEDO PLAY.';

      const brand = document.createElement('div');
      brand.className = 'home-promo-brand';
      // favicon.ico contains the full multi-resolution GeoWeedo icon set. The browser
      // can select a much larger embedded frame than the old 48px PNG being enlarged.
      brand.innerHTML = '<img src="/assets/geoweedo/favicon.ico" alt="" class="home-promo-mascot"/><div class="home-promo-wordmark"><span>Geo</span><strong>Weedo</strong></div>';

      const divider = document.createElement('div');
      divider.className = 'home-promo-divider';
      divider.innerHTML = '<span></span><b>✦</b><span></span>';

      const intro = document.createElement('div');
      intro.className = 'home-promo-intro';
      intro.innerHTML = '<div class="home-promo-kicker">THE DISPENSARY DISCOVERY GAME</div><p>Explore real dispensaries around the world, test your geography skills, and <strong>earn YERB rewards.</strong></p>';

      playButton.textContent = playButton.disabled ? 'No quality-approved rounds yet' : 'Play GeoWeedo · 5 Random Rounds';
      playButton.classList.add('home-promo-play');

      const stats = document.createElement('div');
      stats.className = 'home-promo-stats';
      const items = [
        ['🎮', meta.playable.replace(/ playable/i, '') || '—', 'PLAYABLE', 'LOCATIONS', ''],
        ['📍', meta.mapped.replace(/ mapped/i, '') || '—', 'DISPENSARIES', 'MAPPED', ''],
        ['◆', meta.states.replace(/ u\.s\. states/i, '') || '—', 'U.S. STATES', 'COVERED', ''],
        ['◎', meta.countries.replace(/ countr(?:y|ies)/i, '') || '—', 'COUNTRIES', 'MAPPED', ''],
        ['✦', 'YERB', 'EARN', 'REWARDS', ' reward'],
      ];
      stats.innerHTML = items.map(([icon, value, line1, line2, extra]) => `<div class="home-promo-stat${extra}"><span class="home-promo-stat-icon">${icon}</span><strong>${value}</strong><small>${line1}<br/>${line2}</small></div>`).join('');

      const steps = document.createElement('div');
      steps.className = 'home-promo-steps';
      steps.innerHTML = [
        ['⌖', 'DROP IN', 'You’re dropped somewhere real.'],
        ['◉', 'LOOK AROUND', 'Explore your surroundings.'],
        ['◇', 'MAKE YOUR GUESS', 'Pinpoint the location on the map.'],
        ['★', 'EARN YERB', 'Rack up points. Earn rewards.'],
      ].map(([icon, title, text]) => `<div class="home-promo-step"><span>${icon}</span><div><strong>${title}</strong><small>${text}</small></div></div>`).join('');

      shell.append(tagline, brand, divider, intro, playButton, stats, steps);

      Array.from(card.children).forEach((child) => {
        if (child !== close && child !== playButton) child.remove();
      });
      card.appendChild(shell);
    };

    const observer = new MutationObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(enhance, 20);
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    enhance();

    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, []);

  return null;
}
