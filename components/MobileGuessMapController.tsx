'use client';

import { useEffect } from 'react';

export default function MobileGuessMapController() {
  useEffect(() => {
    const mobileQuery = window.matchMedia('(max-width: 1024px), (pointer: coarse)');

    const sync = () => {
      const toggle = document.querySelector<HTMLElement>('.mobile-guess-toggle');
      const card = document.querySelector<HTMLElement>('.live-guess-card');
      const mobile = mobileQuery.matches;

      if (toggle) {
        if (mobile) {
          toggle.style.setProperty('display', 'inline-flex', 'important');
        } else {
          toggle.style.removeProperty('display');
        }
      }

      if (card) {
        if (mobile) {
          const open = card.classList.contains('mobile-open');
          card.style.setProperty('display', open ? 'block' : 'none', 'important');
          card.setAttribute('aria-hidden', open ? 'false' : 'true');
        } else {
          card.style.removeProperty('display');
          card.removeAttribute('aria-hidden');
        }
      }
    };

    sync();

    const observer = new MutationObserver(sync);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class'],
    });

    mobileQuery.addEventListener?.('change', sync);
    window.addEventListener('resize', sync);

    return () => {
      observer.disconnect();
      mobileQuery.removeEventListener?.('change', sync);
      window.removeEventListener('resize', sync);
    };
  }, []);

  return null;
}
