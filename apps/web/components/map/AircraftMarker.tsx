'use client';

import { memo, useMemo } from 'react';
import { Marker } from 'react-leaflet';
import L from 'leaflet';
import type { MapAircraft } from '@alx/contracts';
import { planeSvg, type PlaneKind } from './PlaneGlyph';

/** Plane color = ARR / DEP; ring = on time (green) / delayed (orange); dimmed when parked. */
export const AircraftMarker = memo(function AircraftMarker({
  aircraft,
  selected,
  onSelect,
}: {
  aircraft: MapAircraft;
  selected: boolean;
  onSelect: (flightId: string | null) => void;
}) {
  const kind: PlaneKind =
    aircraft.kind === 'ARR' ? 'arr' : aircraft.kind === 'DEP' ? 'dep' : 'none';
  const ring = aircraft.kind ? (aircraft.delayed ? 'late' : 'ok') : null;
  const parked = !aircraft.transmitting;
  const classes = [
    'aircraft',
    `aircraft-${kind}`,
    ring && `aircraft-${ring}`,
    parked && 'aircraft-parked',
    selected && 'aircraft-selected',
  ]
    .filter(Boolean)
    .join(' ');
  // Rebuilding the icon replaces the marker DOM, so only do it when the look changes.
  const icon = useMemo(
    () =>
      L.divIcon({
        className: 'aircraft-icon',
        html: `
          <div class="${classes}">
            ${ring ? '<span class="aircraft-ring"></span>' : ''}
            ${planeSvg(aircraft.track ?? 0)}
            <span class="aircraft-label">${escapeHtml(aircraft.callsign)}</span>
          </div>`,
        iconSize: [44, 44],
        iconAnchor: [22, 22],
      }),
    [classes, ring, aircraft.track, aircraft.callsign],
  );
  const handlers = useMemo(
    () => ({ click: () => onSelect(aircraft.flightId) }),
    [onSelect, aircraft.flightId],
  );
  return (
    <Marker
      position={[aircraft.lat, aircraft.lon]}
      icon={icon}
      zIndexOffset={selected ? 1000 : 0}
      eventHandlers={handlers}
      keyboard={false}
    />
  );
});

/** Callsigns come from the feed and go into divIcon HTML. */
function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}
