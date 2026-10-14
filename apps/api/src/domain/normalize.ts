import { makeAnomaly } from './anomalies';
import type { Anomaly, FeedMessage } from './types';

const MESSAGE_TYPES = new Set<string>(['hello', 'snapshot', 'flight', 'position']);

export type Normalized = { message: FeedMessage } | { anomaly: Anomaly };

/**
 * Per-connection gate between JSON lines and the domain: passes messages that
 * can be trusted and says why the others were rejected. Duplicates are detected
 * by `seq` (unique per connection). Distance is not a matter of trust: a far
 * position is real, just not ours, so the domain ignores it (`inRange`).
 */
export class Normalizer {
  private seenSeqs = new Set<number>();

  resetConnection(): void {
    this.seenSeqs.clear();
  }

  ingest(line: string): Normalized {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return reject('invalid_json', 'Line is not JSON', undefined, line);
    }
    if (!isObject(parsed) || typeof parsed.type !== 'string') {
      return reject('invalid_shape', 'Missing type', undefined, line);
    }

    const seq = asNumber(parsed.seq);
    if (!MESSAGE_TYPES.has(parsed.type)) {
      return reject('invalid_shape', `Unknown type ${parsed.type}`, seq, line);
    }
    if (seq === undefined) {
      return reject('invalid_shape', 'Missing seq', undefined, line);
    }
    if (this.seenSeqs.has(seq)) {
      return reject('duplicate_seq', `Duplicate seq ${seq}`, seq, line);
    }
    this.seenSeqs.add(seq);

    const message = parsed as unknown as FeedMessage;
    if (message.type === 'position' && !realCoords(message.lat, message.lon)) {
      return reject(
        'bad_coords',
        `Position ${message.icao24} lat=${message.lat} lon=${message.lon}`,
        seq,
        line,
      );
    }
    return { message };
  }
}

/** GPS garbage: not numbers, or exactly 0,0. */
function realCoords(lat: number, lon: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lon) && !(lat === 0 && lon === 0);
}

function reject(...args: Parameters<typeof makeAnomaly>): Normalized {
  return { anomaly: makeAnomaly(...args) };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
