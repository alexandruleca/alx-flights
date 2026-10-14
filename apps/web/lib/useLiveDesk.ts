'use client';

import { useEffect, useState } from 'react';
import type { DeskStream, DeskTopic, KpisPayload } from '@alx/contracts';
import { apiUrl, getJson } from './api';
import { SECOND_MS } from './time';

const EMPTY: DeskStream = {
  status: { ok: false, locked: false, error: 'starting', reconnects: 0 },
  board: { arrivals: [], departures: [] },
  map: { airport: null, zones: null, aircraft: [] },
  alert: { alerts: [] },
  anomaly: { counts: {}, recent: [] },
};
const TOPICS = Object.keys(EMPTY) as DeskTopic[];

/** KPIs are aggregations, not a stream; refreshing every few seconds is enough. */
const KPI_REFRESH_MS = 5 * SECOND_MS;

/** The live desk: every stream topic kept current over SSE, plus the KPIs. */
export function useLiveDesk() {
  const [desk, setDesk] = useState<DeskStream>(EMPTY);
  const [connected, setConnected] = useState(false);
  const [kpis, setKpis] = useState<KpisPayload>({ movements: [], standUse: [] });

  useEffect(() => {
    // The stream opens with every topic once, then pushes each one as it changes.
    const eventSource = new EventSource(apiUrl('/stream'));
    eventSource.onopen = () => setConnected(true);
    eventSource.onerror = () => setConnected(false);
    for (const topic of TOPICS) {
      eventSource.addEventListener(topic, (event) => {
        const payload = JSON.parse((event as MessageEvent<string>).data);
        setDesk((current) => ({ ...current, [topic]: payload }));
      });
    }
    return () => eventSource.close();
  }, []);

  useEffect(() => {
    const load = () =>
      getJson<KpisPayload>('/kpis')
        .then(setKpis)
        .catch(() => undefined);
    void load();
    const timer = setInterval(load, KPI_REFRESH_MS);
    return () => clearInterval(timer);
  }, []);

  return { ...desk, connected, kpis };
}
