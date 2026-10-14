import { describe, expect, it } from 'vitest';
import { applyMessage } from '../src/domain/apply';
import { AirportState } from '../src/domain/state';
import type { FlightRecord } from '../src/domain/types';
import { flight, hello, position } from './fixtures';

const T0 = '2026-10-13T12:00:00.000Z';
const T1 = '2026-10-13T12:00:10.000Z';

function started(): AirportState {
  const state = new AirportState();
  applyMessage(state, hello('ALX'), 'ALX');
  return state;
}

function snapshot(ts: string, flights: FlightRecord[]) {
  return { type: 'snapshot' as const, seq: 2, ts, flights };
}

function update(ts: string, record: FlightRecord) {
  return { type: 'flight' as const, seq: 3, ts, ...record };
}

describe('applyMessage', () => {
  it('locks on a hello for another airport and ignores the feed', () => {
    const state = new AirportState();
    const effects = applyMessage(state, hello('XYZ'), 'ALX');
    expect(state.link.lock).toEqual({ expected: 'ALX', got: 'XYZ' });
    expect(effects.linkChanged).toBe(true);
    expect(state.health()).toMatchObject({ locked: true, error: 'misconfigured' });
    expect(applyMessage(state, snapshot(T0, [flight()]), 'ALX').skipped?.reason).toBe('locked');
  });

  it('applies a snapshot and raises alerts for delayed flights', () => {
    const state = started();
    const effects = applyMessage(state, snapshot(T0, [flight({ delayMin: 20 })]), 'ALX');
    expect(state.flights.size).toBe(1);
    expect(effects.flightListComplete).toBe(true);
    expect(state.activeAlerts()).toHaveLength(1);
  });

  it('does not rewind a flight to an older version', () => {
    const state = started();
    applyMessage(state, update(T1, flight({ status: 'ON_STAND' })), 'ALX');
    const effects = applyMessage(state, update(T0, flight({ status: 'TAXI' })), 'ALX');
    expect(effects.skipped?.reason).toBe('stale_entity');
    expect(state.flights.get('X-1')?.status).toBe('ON_STAND');
  });

  it('counts a take-off once, however often the snapshot repeats it', () => {
    const state = started();
    const departed = flight({ kind: 'DEP', status: 'DEPARTED', actual: T0 });
    const first = applyMessage(state, snapshot(T0, [departed]), 'ALX');
    expect(first.movements).toEqual([expect.objectContaining({ kind: 'takeoff', ts: T0 })]);
    expect(applyMessage(state, snapshot(T1, [departed]), 'ALX').movements).toEqual([]);
  });

  it('closes alerts of flights the snapshot no longer carries', () => {
    const state = started();
    applyMessage(state, snapshot(T0, [flight({ delayMin: 30 })]), 'ALX');
    const effects = applyMessage(state, snapshot(T1, []), 'ALX');
    expect(state.activeAlerts()).toEqual([]);
    expect(effects.alerts).toEqual([expect.objectContaining({ active: false, ts: T1 })]);
  });

  it('ignores aircraft further than 15 km from the airport, listed or reporting', () => {
    const state = started();
    const near = position({ icao24: 'near', lat: 40.13 }); // 14.5 km north
    const far = position({ icao24: 'far', lat: 40.14 }); // 15.6 km north
    applyMessage(state, { ...snapshot(T0, []), aircraft: [near, far] }, 'ALX');
    expect([...state.positions.keys()]).toEqual(['near']);

    const report = applyMessage(state, { type: 'position', seq: 3, ts: T1, ...far }, 'ALX');
    expect(report.skipped?.reason).toBe('out_of_range');
    expect(report.positions).toEqual([]);
    expect(state.positions.has('far')).toBe(false);
  });
});
