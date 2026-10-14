import type { Provenance } from '@alx/contracts';
import type { FlightRecord, HelloMessage, PositionRecord } from '../src/domain/types';

const SCHEDULED = '2026-10-13T12:00:00.000Z';

/** An arrival on approach, `delayMin` minutes behind schedule. */
export function flight(
  overrides: Partial<FlightRecord> & { delayMin?: number } = {},
): FlightRecord {
  const { delayMin = 0, ...rest } = overrides;
  return {
    flightId: 'X-1',
    callsign: 'X1',
    airline: 'X',
    reg: 'X',
    icao24: 'abc',
    kind: 'ARR',
    origin: 'LHR',
    destination: 'ALX',
    scheduled: SCHEDULED,
    estimated: new Date(Date.parse(SCHEDULED) + delayMin * 60_000).toISOString(),
    actual: null,
    status: 'APPROACH',
    stand: 'A1',
    runway: '09',
    ...rest,
  };
}

export function position(overrides: Partial<PositionRecord> = {}): PositionRecord {
  return {
    icao24: 'abc',
    callsign: 'X1',
    lat: 40,
    lon: 20,
    alt: 1200,
    gs: 150,
    track: 90,
    onGround: false,
    ...overrides,
  };
}

/** A record as ingest stores it. */
export function stored<T extends object>(record: T, ts: string): T & Provenance {
  return { ...record, ts, seq: 1, connectionEpoch: 1 };
}

export function hello(code: string): HelloMessage {
  return {
    type: 'hello',
    seq: 1,
    ts: '2026-10-13T00:00:00.000Z',
    feed: 'clean',
    airport: { code, name: 'Test', lat: 40, lon: 20 },
    zones: { type: 'FeatureCollection', features: [] },
  };
}
