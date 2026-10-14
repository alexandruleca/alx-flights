'use client';

import { memo, useEffect, useRef } from 'react';
import type { BoardRow } from '@alx/contracts';
import { delayMinutes, hhmm, humanize } from '@/lib/format';

/**
 * One side of the board: arrivals or departures. Rows select their flight; the
 * other half of the selected flight's turnaround is marked as linked.
 */
export const BookPanel = memo(function BookPanel({
  side,
  rows,
  selectedId,
  linkedId,
  onSelect,
}: {
  side: 'arr' | 'dep';
  rows: BoardRow[];
  selectedId: string | null;
  linkedId: string | null;
  onSelect: (flightId: string | null) => void;
}) {
  const isArr = side === 'arr';
  const delayed = rows.filter((f) => f.delayed).length;
  const focusRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    focusRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedId, linkedId]);

  return (
    <section className={`book book-${side}`}>
      <header className="book-head">
        <span className="book-side">{isArr ? 'ARR' : 'DEP'}</span>
        <h2>{isArr ? 'Arrivals' : 'Departures'}</h2>
        {delayed > 0 && <span className="book-delayed">{delayed} delayed</span>}
        <span className="book-count">{rows.length}</span>
      </header>
      <div className="book-cols">
        <span>Flight</span>
        <span>{isArr ? 'From' : 'To'}</span>
        <span>Sched</span>
        <span>Est</span>
        <span>Stand</span>
        <span>Status</span>
      </div>
      <div className="book-body">
        {rows.map((flight) => {
          const selected = flight.flightId === selectedId;
          const linked = flight.flightId === linkedId;
          const lateMinutes = delayMinutes(flight);
          return (
            <button
              type="button"
              key={flight.flightId}
              ref={selected || linked ? focusRef : undefined}
              className={`book-row phase-${flight.phase}${flight.delayed ? ' is-delayed' : ''}${
                selected ? ' is-selected' : ''
              }${linked ? ' is-linked' : ''}`}
              onClick={() => onSelect(selected ? null : flight.flightId)}
              aria-pressed={selected}
              title={linked ? 'Same aircraft as the selected flight' : undefined}
            >
              <span className="flight">
                <span className="callsign">{flight.callsign}</span>
                <span className="reg">{flight.reg}</span>
              </span>
              <span>{isArr ? flight.origin : flight.destination}</span>
              <span className="mono">{hhmm(flight.scheduled)}</span>
              <span className="mono estimated">
                {hhmm(flight.estimated)}
                {lateMinutes > 0 && <small className="late">+{lateMinutes}</small>}
              </span>
              <span
                className={`mono${flight.standConflict ? ' stand-conflict' : ''}`}
                title={flight.standConflict ? 'Stand conflict' : undefined}
              >
                {flight.stand ?? '—'}
              </span>
              <span>
                <span className={`status status-${flight.phase}`}>{humanize(flight.status)}</span>
              </span>
            </button>
          );
        })}
        {!rows.length && (
          <div className="book-empty">No open {isArr ? 'arrivals' : 'departures'}</div>
        )}
      </div>
    </section>
  );
});
