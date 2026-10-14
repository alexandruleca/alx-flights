import { describe, expect, it } from 'vitest';
import { evaluateDelayed } from '../src/domain/alerts';
import { flight } from './fixtures';

const T1 = '2026-10-13T12:00:00.000Z';
const T2 = '2026-10-13T12:01:00.000Z';
const T3 = '2026-10-13T12:02:00.000Z';

describe('alert lifecycle (Delayed)', () => {
  it('raises an alert for a delayed flight', () => {
    expect(evaluateDelayed(flight({ delayMin: 25 }), undefined, T1)).toMatchObject({
      active: true,
      raisedAt: T1,
      closedAt: null,
      message: 'X1 delayed ~25 min (ARR)',
    });
  });

  it('records nothing for an on-time flight without an alert', () => {
    expect(evaluateDelayed(flight({ delayMin: 5 }), undefined, T1)).toBeNull();
  });

  it('records nothing when an open alert has not changed', () => {
    const open = evaluateDelayed(flight({ delayMin: 25 }), undefined, T1)!;
    expect(evaluateDelayed(flight({ delayMin: 25 }), open, T2)).toBeNull();
  });

  it('updates an open alert in place, keeping when it was raised', () => {
    const open = evaluateDelayed(flight({ delayMin: 25 }), undefined, T1)!;
    expect(evaluateDelayed(flight({ delayMin: 40 }), open, T2)).toMatchObject({
      message: 'X1 delayed ~40 min (ARR)',
      ts: T2,
      raisedAt: T1,
      active: true,
    });
  });

  it('closes when the flight reaches the stand, recording when', () => {
    const open = evaluateDelayed(flight({ delayMin: 25 }), undefined, T1)!;
    expect(evaluateDelayed(flight({ status: 'ON_STAND', delayMin: 25 }), open, T3)).toMatchObject({
      id: open.id,
      active: false,
      raisedAt: T1,
      closedAt: T3,
    });
  });

  it('raises a new alert when a flight is delayed again, leaving the closed one as it was', () => {
    const first = evaluateDelayed(flight({ delayMin: 25 }), undefined, T1)!;
    const closed = evaluateDelayed(flight({ delayMin: 5 }), first, T2)!;
    const again = evaluateDelayed(flight({ delayMin: 40 }), closed, T3)!;
    expect(again).toMatchObject({ subject: first.subject, active: true, raisedAt: T3 });
    expect(again.id).not.toBe(first.id);
  });
});
