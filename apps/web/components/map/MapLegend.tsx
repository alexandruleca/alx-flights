import type { MapAircraft } from '@alx/contracts';
import { PlaneGlyph } from './PlaneGlyph';

export function MapLegend({ aircraft }: { aircraft: MapAircraft[] }) {
  const delayed = aircraft.filter((a) => a.delayed).length;
  const parked = aircraft.filter((a) => !a.transmitting).length;
  return (
    <div className="map-legend">
      <span className="legend-item">
        <PlaneGlyph kind="arr" /> Arrival
      </span>
      <span className="legend-item">
        <PlaneGlyph kind="dep" /> Departure
      </span>
      <span className="legend-item">
        <i className="legend-ring ok" /> On time
      </span>
      <span className="legend-item">
        <i className="legend-ring late" /> Delayed
      </span>
      <span className="legend-item legend-summary">
        {aircraft.length - parked} transmitting
        {parked ? ` · ${parked} parked` : ''}
        {delayed ? ` · ${delayed} delayed` : ''}
      </span>
    </div>
  );
}
