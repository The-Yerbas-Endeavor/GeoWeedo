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

function numericText(value: string, suffix: RegExp) {
  const cleaned = value.replace(suffix, '').trim();
  return cleaned || '—';
}

export default function HomePlayCardEnhancer() {
  useEffect(() => {
    let cancelled = false;

    const enhance = () => {
      const card = document.querySelector<HTMLElement>('.map-first-home .home-play-card');
      if (!card || card.dataset.promoEnhanced === 'true') return;

      const playButton = card.querySelector<HTMLButtonElement>('.home-play-button');
      if (!playButton) return;

      // Build immediately from whatever HomeClient already has. Coverage values that
      // arrive asynchronously are populated in-place below instead of delaying the card.
      const meta = parseMeta(card);
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
      brand.innerHTML = '<img src="/assets/geoweedo/geoweedo-icon-48.png" alt="" width="48" height="48" class="home-promo-mascot"/><div class="home-promo-wordmark"><span>Geo</span><strong>Weedo</strong></div>';

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
        ['🎮', numericText(meta.playable, / playable/i), 'PLAYABLE', 'LOCATIONS', '', 'playable'],
        ['📍', numericText(meta.mapped, / mapped/i), 'DISPENSARIES', 'MAPPED', '', 'mapped'],
        ['◆', numericText(meta.states, / u\.s\. states/i), 'U.S. STATES', 'COVERED', '', 'states'],
        ['◎', numericText(meta.countries, / countr(?:y|ies)/i), 'COUNTRIES', 'MAPPED', '', 'countries'],
        ['✦', 'YERB', 'EARN', 'REWARDS', ' reward', 'rewards'],
      ];
      stats.innerHTML = items.map(([icon, value, line1, line2, extra, key]) => `<div class="home-promo-stat${extra}" data-promo-stat="${key}"><span class="home-promo-stat-icon">${icon}</span><strong>${value}</strong><small>${line1}<br/>${line2}</small></div>`).join('');

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

      // Coverage is deliberately non-blocking. The card is already visible while this runs.
      fetch('/api/map-candidates', { cache: 'no-store' })
        .then((response) => response.ok ? response.json() : Promise.reject())
        .then((data) => {
          if (cancelled || !data?.stats) return;
          const update = (key: string, value: unknown) => {
            const node = card.querySelector<HTMLElement>(`[data-promo-stat="${key}"] strong`);
            const number = Number(value);
            if (node && Number.isFinite(number)) node.textContent = number.toLocaleString();
          };
          update('mapped', data.stats.mapped);
          update('states', data.stats.states);
          update('countries', data.stats.countries || 1);
        })
        .catch(() => {});
    };

    // Enhance on the first client effect. Do not wait for asynchronous HomeClient fetches.
    enhance();
    const observer = new MutationObserver(() => enhance());
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, []);

  return null;
}
