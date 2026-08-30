'use client';

import { useEffect } from 'react';

function isAdminHeader(target: Element | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.classList.contains('eyebrow') && target.textContent?.trim() === 'GEOWEEDO ADMIN';
}

export default function AdminHeaderHomeLink() {
  useEffect(() => {
    const prepare = () => {
      document.querySelectorAll<HTMLElement>('.eyebrow').forEach((item) => {
        if (item.textContent?.trim() !== 'GEOWEEDO ADMIN' || item.closest('a')) return;
        item.setAttribute('role', 'link');
        item.setAttribute('tabindex', '0');
        item.setAttribute('aria-label', 'GeoWeedo Admin home');
        item.style.cursor = 'pointer';
      });
    };

    const click = (event: MouseEvent) => {
      const target = (event.target as Element | null)?.closest('.eyebrow');
      if (!isAdminHeader(target) || target?.closest('a')) return;
      window.location.href = '/admin';
    };

    const keydown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const target = (event.target as Element | null)?.closest('.eyebrow');
      if (!isAdminHeader(target) || target?.closest('a')) return;
      event.preventDefault();
      window.location.href = '/admin';
    };

    prepare();
    const observer = new MutationObserver(prepare);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('click', click);
    document.addEventListener('keydown', keydown);
    return () => {
      observer.disconnect();
      document.removeEventListener('click', click);
      document.removeEventListener('keydown', keydown);
    };
  }, []);

  return null;
}
