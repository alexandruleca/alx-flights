import { describe, expect, it } from 'vitest';
import { applyMessage } from '../src/domain/apply';
import { AirportState } from '../src/domain/state';
import { timelineOf } from '../src/domain/timeline';
import type { FeedMessage } from '../src/domain/types';
import { hello } from './fixtures';

describe('timeline rows', () => {
  it('logs a rejected hello but never an ignored snapshot', () => {
    const state = new AirportState();
    const run = (message: FeedMessage) =>
      timelineOf(message, applyMessage(state, message, 'ALX'), state);

    expect(run(hello('XYZ')).map((row) => row.summary)).toEqual([
      'hello XYZ rejected (expected ALX)',
    ]);

    const snapshot = run({ type: 'snapshot', seq: 2, ts: '2026-10-13T00:00:01.000Z', flights: [] });
    expect(snapshot).toEqual([]);
  });
});
