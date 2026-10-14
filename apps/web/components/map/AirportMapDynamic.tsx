'use client';

import dynamic from 'next/dynamic';

/** Leaflet touches `window`, so the map only renders client-side. */
export const AirportMapDynamic = dynamic(
  () => import('./AirportMap').then((loaded) => loaded.AirportMap),
  {
    ssr: false,
    loading: () => <div className="map-wrap map-loading">Loading map…</div>,
  },
);
