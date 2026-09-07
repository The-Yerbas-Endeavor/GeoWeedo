'use client';

import type { ReactNode } from 'react';
import { setWorkerUrl } from 'maplibre-gl';

setWorkerUrl('/maplibre/maplibre-gl-worker.mjs');

export default function MapLibreWorkerProvider({ children }: { children: ReactNode }) {
  return children;
}
