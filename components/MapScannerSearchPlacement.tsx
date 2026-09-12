'use client';

import { useLayoutEffect } from 'react';

export default function MapScannerSearchPlacement() {
  useLayoutEffect(() => {
    let scanner: HTMLElement | null = null;
    let originalParent: Node | null = null;
    let originalNextSibling: ChildNode | null = null;
    let originalScannerStyle: string | null = null;
    let input: HTMLInputElement | null = null;
    let originalInputPaddingRight = '';
    let clearButton: HTMLButtonElement | null = null;
    let originalClearStyle: string | null = null;

    const placeScanner = () => {
      const search = document.querySelector<HTMLElement>('.map-first-home .map-unified-search');
      if (!search) return;

      const found = document.querySelector<HTMLElement>('[data-geoweedo-map-scanner]');
      if (found && found !== scanner) {
        scanner = found;
        originalParent = found.parentNode;
        originalNextSibling = found.nextSibling;
        originalScannerStyle = found.getAttribute('style');
      }
      if (!scanner) return;

      if (scanner.parentElement !== search) search.appendChild(scanner);
      search.dataset.mapScannerEmbedded = '1';
      search.style.position = 'relative';

      const nextInput = search.querySelector<HTMLInputElement>('.map-unified-search-input');
      if (nextInput && nextInput !== input) {
        input = nextInput;
        originalInputPaddingRight = nextInput.style.paddingRight;
      }
      if (input) input.style.paddingRight = '52px';

      const nextClear = search.querySelector<HTMLButtonElement>('button[aria-label="Clear search"]');
      if (nextClear && nextClear !== clearButton) {
        clearButton = nextClear;
        originalClearStyle = nextClear.getAttribute('style');
      }
      if (clearButton) {
        clearButton.style.position = 'absolute';
        clearButton.style.right = '43px';
        clearButton.style.top = '50%';
        clearButton.style.transform = 'translateY(-50%)';
        clearButton.style.zIndex = '4';
      }

      Object.assign(scanner.style, {
        position: 'absolute',
        right: '4px',
        top: '50%',
        transform: 'translateY(-50%)',
        width: '34px',
        height: '34px',
        minWidth: '34px',
        minHeight: '34px',
        margin: '0',
        padding: '0',
        display: 'grid',
        placeItems: 'center',
        borderRadius: '50%',
        zIndex: '5',
      });
    };

    placeScanner();
    const observer = new MutationObserver(placeScanner);
    observer.observe(document.body, { subtree: true, childList: true });

    return () => {
      observer.disconnect();
      const search = document.querySelector<HTMLElement>('.map-first-home .map-unified-search');
      search?.removeAttribute('data-map-scanner-embedded');

      if (input) input.style.paddingRight = originalInputPaddingRight;
      if (clearButton) {
        if (originalClearStyle === null) clearButton.removeAttribute('style');
        else clearButton.setAttribute('style', originalClearStyle);
      }
      if (scanner) {
        if (originalScannerStyle === null) scanner.removeAttribute('style');
        else scanner.setAttribute('style', originalScannerStyle);

        if (originalParent) {
          if (originalNextSibling && originalNextSibling.parentNode === originalParent) {
            originalParent.insertBefore(scanner, originalNextSibling);
          } else {
            originalParent.appendChild(scanner);
          }
        }
      }
    };
  }, []);

  return null;
}
