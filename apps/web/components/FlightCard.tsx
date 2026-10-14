import type { BoardRow, MapAircraft } from '@alx/contracts';
import { delayMinutes, hhmm, hhmmss, humanize } from '@/lib/format';

/** Details of the selected flight, over the map. */
export function FlightCard({
  flight,
  turnaround,
  aircraft,
  onSelect,
}: {
  flight: BoardRow;
  /** The other half of this aircraft's turnaround, if on the board. */
  turnaround: BoardRow | null;
  aircraft: MapAircraft | null;
  onSelect: (flightId: string | null) => void;
}) {
  return (
    <aside className={`flight-card card-${flight.kind.toLowerCase()}`}>
      <header>
        <span className="book-side">{flight.kind}</span>
        <strong className="mono">{flight.callsign}</strong>
        {flight.delayed && <span className="alert-badge">+{delayMinutes(flight)} min</span>}
        {flight.standConflict && <span className="alert-badge conflict">stand conflict</span>}
        <button
          type="button"
          className="card-close"
          onClick={() => onSelect(null)}
          aria-label="Close"
        >
          ×
        </button>
      </header>
      <div className="card-route">
        {flight.origin} → {flight.destination}
      </div>
      <dl>
        <dt>Aircraft</dt>
        <dd className="mono">
          {flight.reg} <span className="muted">· {flight.icao24}</span>
        </dd>
        {turnaround && (
          <>
            <dt>{flight.kind === 'ARR' ? 'Departs as' : 'Arrived as'}</dt>
            <dd>
              <button
                type="button"
                className="link"
                onClick={() => onSelect(turnaround.flightId)}
              >
                {turnaround.callsign}
              </button>{' '}
              <span className="mono">{hhmm(turnaround.scheduled)}</span> ·{' '}
              {humanize(turnaround.status)}
            </dd>
          </>
        )}
        <dt>Sched</dt>
        <dd className="mono">{hhmm(flight.scheduled)}</dd>
        <dt>Est</dt>
        <dd className="mono">{hhmm(flight.estimated)}</dd>
        <dt>Actual</dt>
        <dd className="mono">{hhmm(flight.actual)}</dd>
        <dt>Stand</dt>
        <dd className="mono">{flight.stand ?? '—'}</dd>
        <dt>Status</dt>
        <dd>{humanize(flight.status)}</dd>
        {aircraft && !aircraft.transmitting ? (
          <>
            <dt>Signal</dt>
            <dd>parked · silent since {hhmmss(aircraft.ts)}</dd>
          </>
        ) : aircraft ? (
          <>
            <dt>Alt</dt>
            <dd className="mono">
              {aircraft.onGround ? 'on ground' : `${aircraft.alt.toLocaleString()} ft`}
            </dd>
            <dt>Speed</dt>
            <dd className="mono">
              {aircraft.gs} kt · {String(Math.round(aircraft.track)).padStart(3, '0')}°
            </dd>
          </>
        ) : (
          <>
            <dt>Signal</dt>
            <dd className="muted">not transmitting</dd>
          </>
        )}
      </dl>
    </aside>
  );
}
