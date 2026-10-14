'use client';

import { useMemo, useState, type ReactNode } from 'react';
import type { AlertRecord, BoardPayload, KpisPayload, MapPayload } from '@alx/contracts';
import { startOfHour } from '@/lib/time';
import { useHotkeys } from '@/lib/useHotkeys';
import { BookPanel } from './BookPanel';
import { FlightCard } from './FlightCard';
import { KpiTable } from './KpiTable';
import { AirportMapDynamic } from './map/AirportMapDynamic';
import { AlertsTape } from './Tapes';
import { Ticker, type Tick } from './Ticker';

/**
 * The airport picture: what needs attention now, both books, the map, alerts
 * and the KPIs per hour. Live and replay render this same view; only where the
 * payloads come from differs.
 */
export function OpsView({
  board,
  map,
  alerts,
  kpis,
  at,
  extraTicks = [],
  tape,
  alertLogUntil,
}: {
  board: BoardPayload;
  map: MapPayload;
  alerts: AlertRecord[];
  kpis: KpisPayload;
  /** The instant shown (ms): now live, the cursor in replay. */
  at: number;
  extraTicks?: Tick[];
  /** The bottom-right log: feed anomalies live, the event log in replay. */
  tape: ReactNode;
  /** Replay: show the persisted alert log as of this instant (live: now). */
  alertLogUntil?: string;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useHotkeys({ Escape: () => setSelectedId(null) });

  const flights = useMemo(() => [...board.arrivals, ...board.departures], [board]);
  const selected = flights.find((f) => f.flightId === selectedId) ?? null;
  const linked = flights.find((f) => f.flightId === selected?.turnaround) ?? null;
  const aircraft = map.aircraft.find((a) => a.icao24 === selected?.icao24) ?? null;
  const currentHour = hourOf(at);

  return (
    <>
      <Ticker
        ticks={[
          { label: 'Delayed', value: count(alerts, 'delayed'), tone: 'warn' },
          { label: 'Stand conflicts', value: count(alerts, 'stand_conflict'), tone: 'danger' },
          { label: 'Transmitting', value: map.aircraft.filter((a) => a.transmitting).length },
          ...extraTicks,
        ]}
      />

      <div className="trade">
        <BookPanel
          side="arr"
          rows={board.arrivals}
          selectedId={selectedId}
          linkedId={linked?.flightId ?? null}
          onSelect={setSelectedId}
        />
        <div className="trade-map">
          <AirportMapDynamic
            data={map}
            selectedIcao={selected?.icao24 ?? null}
            onSelect={setSelectedId}
          />
          {selected && (
            <FlightCard
              flight={selected}
              turnaround={linked}
              aircraft={aircraft}
              onSelect={setSelectedId}
            />
          )}
        </div>
        <BookPanel
          side="dep"
          rows={board.departures}
          selectedId={selectedId}
          linkedId={linked?.flightId ?? null}
          onSelect={setSelectedId}
        />
      </div>

      <div className="ops-bottom">
        <AlertsTape
          alerts={alerts}
          selectedId={selectedId}
          onSelect={setSelectedId}
          logUntil={alertLogUntil}
        />
        <KpiTable kpis={kpis} stands={standsOf(map, kpis)} currentHour={currentHour} />
        {tape}
      </div>
    </>
  );
}

function count(alerts: AlertRecord[], type: AlertRecord['type']): number {
  return alerts.filter((a) => a.type === type).length;
}

/** Start of the UTC clock hour containing `atMs`, as the KPIs key it. */
function hourOf(atMs: number): string {
  return new Date(startOfHour(atMs)).toISOString();
}

/** The airport's stands (from its zones) and any the KPIs mention, A1 … A10. */
function standsOf(map: MapPayload, kpis: KpisPayload): string[] {
  const stands = new Set(
    (map.zones?.features ?? [])
      .filter((f) => f.properties.kind === 'STAND')
      .map((f) => f.properties.name),
  );
  for (const hour of kpis.standUse) Object.keys(hour.minutes).forEach((stand) => stands.add(stand));
  return [...stands].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}
