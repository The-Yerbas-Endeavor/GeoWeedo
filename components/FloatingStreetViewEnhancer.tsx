'use client';

import { useEffect } from 'react';

const MIN_WIDTH = 360;
const MIN_HEIGHT = 260;
const VIEWPORT_GAP = 8;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

export default function FloatingStreetViewEnhancer() {
  useEffect(() => {
    const cleanups = new Map<HTMLElement, () => void>();

    const minimizeHomeCard = () => {
      const close = document.querySelector<HTMLButtonElement>('.home-play-card button[aria-label="Close game intro"]');
      close?.click();
    };

    const enhance = (panel: HTMLElement) => {
      if (panel.dataset.floatingStreetview === 'true') return;
      panel.dataset.floatingStreetview = 'true';
      minimizeHomeCard();

      const header = panel.querySelector<HTMLElement>('.map-streetview-head');
      if (!header) return;

      const rect = panel.getBoundingClientRect();
      const initialWidth = Math.min(rect.width || 720, Math.max(MIN_WIDTH, window.innerWidth - VIEWPORT_GAP * 2));
      const initialHeight = Math.min(rect.height || 470, Math.max(MIN_HEIGHT, window.innerHeight - VIEWPORT_GAP * 2));
      const initialLeft = clamp(rect.left, VIEWPORT_GAP, window.innerWidth - initialWidth - VIEWPORT_GAP);
      const initialTop = clamp(rect.top, VIEWPORT_GAP, window.innerHeight - initialHeight - VIEWPORT_GAP);

      Object.assign(panel.style, {
        position: 'fixed',
        left: `${initialLeft}px`,
        top: `${initialTop}px`,
        right: 'auto',
        bottom: 'auto',
        width: `${initialWidth}px`,
        height: `${initialHeight}px`,
        minWidth: `${MIN_WIDTH}px`,
        minHeight: `${MIN_HEIGHT}px`,
        maxWidth: `calc(100vw - ${VIEWPORT_GAP * 2}px)`,
        maxHeight: `calc(100vh - ${VIEWPORT_GAP * 2}px)`,
        overflow: 'hidden',
      });

      header.style.cursor = 'move';
      header.style.userSelect = 'none';
      header.style.touchAction = 'none';
      header.title = 'Drag to move Street View';

      const handle = document.createElement('div');
      handle.className = 'map-streetview-resize-handle';
      handle.setAttribute('role', 'separator');
      handle.setAttribute('aria-label', 'Resize Street View panel');
      handle.title = 'Drag to resize';
      Object.assign(handle.style, {
        position: 'absolute',
        right: '0',
        bottom: '0',
        width: '26px',
        height: '26px',
        cursor: 'nwse-resize',
        zIndex: '20',
        touchAction: 'none',
        background: 'linear-gradient(135deg, transparent 48%, rgba(255,255,255,.28) 49%, rgba(255,255,255,.28) 56%, transparent 57%, transparent 67%, rgba(255,255,255,.28) 68%, rgba(255,255,255,.28) 75%, transparent 76%)',
      });
      panel.appendChild(handle);

      const clampPanel = () => {
        const current = panel.getBoundingClientRect();
        const width = Math.min(Math.max(current.width, MIN_WIDTH), Math.max(MIN_WIDTH, window.innerWidth - VIEWPORT_GAP * 2));
        const height = Math.min(Math.max(current.height, MIN_HEIGHT), Math.max(MIN_HEIGHT, window.innerHeight - VIEWPORT_GAP * 2));
        const left = clamp(current.left, VIEWPORT_GAP, window.innerWidth - width - VIEWPORT_GAP);
        const top = clamp(current.top, VIEWPORT_GAP, window.innerHeight - height - VIEWPORT_GAP);
        panel.style.width = `${width}px`;
        panel.style.height = `${height}px`;
        panel.style.left = `${left}px`;
        panel.style.top = `${top}px`;
      };

      const startDrag = (event: PointerEvent) => {
        if ((event.target as HTMLElement | null)?.closest('button')) return;
        event.preventDefault();
        const start = panel.getBoundingClientRect();
        const startX = event.clientX;
        const startY = event.clientY;
        header.setPointerCapture?.(event.pointerId);

        const move = (moveEvent: PointerEvent) => {
          const left = clamp(start.left + moveEvent.clientX - startX, VIEWPORT_GAP, window.innerWidth - start.width - VIEWPORT_GAP);
          const top = clamp(start.top + moveEvent.clientY - startY, VIEWPORT_GAP, window.innerHeight - start.height - VIEWPORT_GAP);
          panel.style.left = `${left}px`;
          panel.style.top = `${top}px`;
        };
        const stop = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', stop);
          window.removeEventListener('pointercancel', stop);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', stop, { once: true });
        window.addEventListener('pointercancel', stop, { once: true });
      };

      const startResize = (event: PointerEvent) => {
        event.preventDefault();
        event.stopPropagation();
        const start = panel.getBoundingClientRect();
        const startX = event.clientX;
        const startY = event.clientY;
        handle.setPointerCapture?.(event.pointerId);

        const move = (moveEvent: PointerEvent) => {
          const maxWidth = Math.max(MIN_WIDTH, window.innerWidth - start.left - VIEWPORT_GAP);
          const maxHeight = Math.max(MIN_HEIGHT, window.innerHeight - start.top - VIEWPORT_GAP);
          panel.style.width = `${clamp(start.width + moveEvent.clientX - startX, MIN_WIDTH, maxWidth)}px`;
          panel.style.height = `${clamp(start.height + moveEvent.clientY - startY, MIN_HEIGHT, maxHeight)}px`;
        };
        const stop = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', stop);
          window.removeEventListener('pointercancel', stop);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', stop, { once: true });
        window.addEventListener('pointercancel', stop, { once: true });
      };

      header.addEventListener('pointerdown', startDrag);
      handle.addEventListener('pointerdown', startResize);
      window.addEventListener('resize', clampPanel);

      cleanups.set(panel, () => {
        header.removeEventListener('pointerdown', startDrag);
        handle.removeEventListener('pointerdown', startResize);
        window.removeEventListener('resize', clampPanel);
        handle.remove();
      });
    };

    const scan = () => {
      document.querySelectorAll<HTMLElement>('.map-streetview-panel').forEach(enhance);
      for (const [panel, cleanup] of cleanups) {
        if (!panel.isConnected) {
          cleanup();
          cleanups.delete(panel);
        }
      }
    };

    scan();
    const observer = new MutationObserver(scan);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      cleanups.forEach((cleanup) => cleanup());
      cleanups.clear();
    };
  }, []);

  return null;
}
