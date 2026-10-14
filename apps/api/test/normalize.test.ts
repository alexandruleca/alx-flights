import { describe, expect, it } from 'vitest';
import { Normalizer } from '../src/domain/normalize';

describe('Normalizer', () => {
  it('accepts late seq after a higher one (49 after 50)', () => {
    const normalizer = new Normalizer();
    const first = normalizer.ingest(positionLine(50));
    const late = normalizer.ingest(positionLine(49));
    expect('message' in first).toBe(true);
    expect('message' in late).toBe(true);
  });

  it('drops duplicate seq and records anomaly', () => {
    const normalizer = new Normalizer();
    expect('message' in normalizer.ingest(positionLine(10))).toBe(true);
    const duplicate = normalizer.ingest(positionLine(10));
    expect('anomaly' in duplicate).toBe(true);
    if ('anomaly' in duplicate) {
      expect(duplicate.anomaly.reason).toBe('duplicate_seq');
    }
  });

  it('drops 0,0 coordinates', () => {
    const normalizer = new Normalizer();
    const atZeroZero = normalizer.ingest(
      JSON.stringify({
        type: 'position',
        seq: 1,
        ts: '2026-10-13T00:00:00.000Z',
        icao24: 'abc',
        callsign: 'X',
        lat: 0,
        lon: 0,
        alt: 0,
        gs: 0,
        track: 0,
        onGround: true,
      }),
    );
    expect('anomaly' in atZeroZero).toBe(true);
    if ('anomaly' in atZeroZero) expect(atZeroZero.anomaly.reason).toBe('bad_coords');
  });

  it('passes far positions on: real data, just not ours (the domain ignores them)', () => {
    const normalizer = new Normalizer();
    expect('message' in normalizer.ingest(positionLine(1, { lat: 51.5, lon: -0.1 }))).toBe(true);
  });

  it('clears seen set on reconnect', () => {
    const normalizer = new Normalizer();
    normalizer.ingest(positionLine(1));
    normalizer.resetConnection();
    expect('message' in normalizer.ingest(positionLine(1))).toBe(true);
  });
});

function positionLine(
  seq: number,
  coords: { lat: number; lon: number } = { lat: 40, lon: 20 },
): string {
  return JSON.stringify({
    type: 'position',
    seq,
    ts: '2026-10-13T00:00:00.000Z',
    icao24: 'abc',
    callsign: 'X',
    ...coords,
    alt: 0,
    gs: 0,
    track: 0,
    onGround: true,
  });
}
