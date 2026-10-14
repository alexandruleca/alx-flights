import { randomUUID } from 'node:crypto';
import type { Anomaly, AnomalyPayload, AnomalyReason } from '@alx/contracts';

const RAW_MAX = 240;
const LOG_MAX = 500;

export function makeAnomaly(
  reason: AnomalyReason,
  detail: string,
  seq?: number,
  raw?: string,
): Anomaly {
  return {
    id: randomUUID(),
    at: new Date().toISOString(),
    reason,
    detail,
    seq,
    raw: raw && (raw.length <= RAW_MAX ? raw : `${raw.slice(0, RAW_MAX)}…`),
  };
}

/** Recent rejects (newest first) plus running counts per reason. */
export class AnomalyLog {
  private readonly recent: Anomaly[] = [];
  private readonly counts: Partial<Record<AnomalyReason, number>> = {};

  /** Add in chronological order. */
  add(anomaly: Anomaly): void {
    this.recent.unshift(anomaly);
    if (this.recent.length > LOG_MAX) this.recent.length = LOG_MAX;
    this.counts[anomaly.reason] = (this.counts[anomaly.reason] ?? 0) + 1;
  }

  view(limit: number): AnomalyPayload {
    return { counts: { ...this.counts }, recent: this.recent.slice(0, limit) };
  }
}
