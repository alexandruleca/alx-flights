import { describe, expect, it } from 'vitest';
import { isDelayed, movementHappened, phaseOf } from '../src/domain/flight';
import type { FlightStatus } from '../src/domain/types';
import { flight } from './fixtures';

describe('flight lifecycle', () => {
  it('maps every status to a phase', () => {
    const phases = (['AIRBORNE', 'APPROACH', 'TAXI', 'ON_STAND', 'CANCELLED'] as FlightStatus[]).map(
      (status) => phaseOf({ status }),
    );
    expect(phases).toEqual(['planned', 'active', 'ground', 'done', 'irregular']);
  });

  it('knows when the scheduled movement has happened', () => {
    expect(movementHappened(flight({ kind: 'ARR', status: 'TAXI' }))).toBe(true);
    expect(movementHappened(flight({ kind: 'DEP', status: 'TAXI' }))).toBe(false);
    expect(movementHappened(flight({ kind: 'DEP', status: 'DEPARTED' }))).toBe(true);
  });
});

describe('Delayed rule', () => {
  it('fires when the estimate is more than 15 minutes late', () => {
    expect(isDelayed(flight({ status: 'APPROACH', delayMin: 16 }))).toBe(true);
    expect(isDelayed(flight({ status: 'APPROACH', delayMin: 14 }))).toBe(false);
  });

  it('stays closed once the movement happened or will not happen', () => {
    for (const status of ['LANDED', 'TAXI', 'ON_STAND', 'DIVERTED'] as FlightStatus[]) {
      expect(isDelayed(flight({ kind: 'ARR', status, delayMin: 45 }))).toBe(false);
    }
    for (const status of ['DEPARTED', 'CANCELLED'] as FlightStatus[]) {
      expect(isDelayed(flight({ kind: 'DEP', status, delayMin: 45 }))).toBe(false);
    }
  });

  it('still applies to a departure taxiing out', () => {
    expect(isDelayed(flight({ kind: 'DEP', status: 'TAXI', delayMin: 45 }))).toBe(true);
  });
});
