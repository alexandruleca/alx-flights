'use client';

import { useState, type ReactNode } from 'react';
import type {
  AlertLogPayload,
  AlertRecord,
  AnomalyPayload,
  EventsPayload,
  TimelineEventType,
} from '@alx/contracts';
import { apiPath } from '@/lib/api';
import { hhmmss, humanize } from '@/lib/format';
import { MINUTE_MS, SECOND_MS } from '@/lib/time';
import { useLatest } from '@/lib/useLatest';
import { Segmented } from './Segmented';

/** A scrolling log panel: title, optional header extras, rows newest first. */
function Tape<T>({
  title,
  aside,
  items,
  empty,
  row,
}: {
  title: string;
  aside?: ReactNode;
  items: T[];
  empty: string;
  row: (item: T) => ReactNode;
}) {
  return (
    <section className="tape">
      <header className="tape-head">
        <h2>{title}</h2>
        {aside}
      </header>
      <div className="tape-body">
        {items.length ? items.map(row) : <div className="tape-empty">{empty}</div>}
      </div>
    </section>
  );
}

/** time · kind · detail — clickable when it points at a flight. */
function TapeRow({
  ts,
  kind,
  label = kind,
  detail,
  fresh = false,
  dim = false,
  selected = false,
  onClick,
}: {
  ts: string;
  kind: string;
  label?: string;
  detail: string;
  fresh?: boolean;
  /** Over: a cleared alert in the log. */
  dim?: boolean;
  selected?: boolean;
  onClick?: () => void;
}) {
  const className = `tape-row${fresh ? ' is-fresh' : ''}${dim ? ' is-dim' : ''}${
    selected ? ' is-selected' : ''
  }`;
  const cells = (
    <>
      <span className="mono muted">{hhmmss(ts)}</span>
      <span className={`event-tag event-${kind}`}>{label}</span>
      <span className="detail" title={detail}>
        {detail}
      </span>
    </>
  );
  return onClick ? (
    <button type="button" className={className} onClick={onClick}>
      {cells}
    </button>
  ) : (
    <div className={className}>{cells}</div>
  );
}

/** Live, the persisted log is refreshed this often; replay follows the cursor instead. */
const ALERT_LOG_REFRESH_MS = 5 * SECOND_MS;

/**
 * Active alerts, or the persisted log of every alert (open and cleared).
 * Replay passes `logUntil` so the log shows what was known at the cursor.
 */
export function AlertsTape({
  alerts,
  selectedId,
  onSelect,
  logUntil,
}: {
  alerts: AlertRecord[];
  selectedId: string | null;
  onSelect: (flightId: string) => void;
  logUntil?: string;
}) {
  const [view, setView] = useState<'active' | 'log'>('active');
  const log = useLatest<AlertLogPayload>(
    view === 'log' ? apiPath('/alerts/log', { until: logUntil }) : null,
    logUntil ? undefined : ALERT_LOG_REFRESH_MS,
  );
  const until = logUntil ?? new Date().toISOString();
  const clearedBy = (alert: AlertRecord) => alert.closedAt !== null && alert.closedAt <= until;
  const items =
    view === 'active'
      ? [...alerts].sort((a, b) => b.raisedAt.localeCompare(a.raisedAt))
      : (log?.alerts ?? []);

  return (
    <Tape
      title="Alerts"
      aside={
        <Segmented
          label="Alerts view"
          className="small"
          options={[
            { value: 'active', label: `Active ${alerts.length}` },
            { value: 'log', label: 'Log', title: 'Every persisted alert, open and cleared' },
          ]}
          value={view}
          onChange={setView}
        />
      }
      items={items}
      empty={view === 'active' ? 'No active alerts' : 'No alerts recorded yet'}
      row={(alert) => (
        <TapeRow
          key={alert.id}
          ts={alert.raisedAt}
          kind={alert.type === 'stand_conflict' ? 'conflict' : 'alert'}
          label={humanize(alert.type)}
          detail={
            view === 'active'
              ? alert.message
              : `${alert.message} · ${
                  clearedBy(alert) ? `cleared ${hhmmss(alert.closedAt)}` : 'open'
                }`
          }
          dim={view === 'log' && clearedBy(alert)}
          selected={alert.flightId === selectedId}
          onClick={() => onSelect(alert.flightId)}
        />
      )}
    />
  );
}

/** Live: what the normalizer rejected from the feed. */
export function AnomalyTape({ anomalies }: { anomalies: AnomalyPayload }) {
  return (
    <Tape
      title="Feed anomalies"
      aside={
        <div className="tape-chips">
          {Object.entries(anomalies.counts).map(([reason, count]) => (
            <span className="chip" key={reason}>
              {humanize(reason)} <b>{count}</b>
            </span>
          ))}
        </div>
      }
      items={anomalies.recent.slice(0, 30)}
      empty="Feed clean so far"
      row={(anomaly) => (
        <TapeRow
          key={anomaly.id}
          ts={anomaly.at}
          kind="anomaly"
          label={humanize(anomaly.reason)}
          detail={anomaly.detail}
        />
      )}
    />
  );
}

const EVENT_TYPES: TimelineEventType[] = [
  'flight',
  'movement',
  'alert',
  'anomaly',
  'snapshot',
  'hello',
  'position',
];
const LOOKBACK_MS = 10 * MINUTE_MS;
const FRESH_MS = 5 * SECOND_MS;

/** Replay: the event log leading up to the cursor, newest first. */
export function EventTape({ at }: { at: string }) {
  const [types, setTypes] = useState<TimelineEventType[]>(
    EVENT_TYPES.filter((type) => type !== 'position'),
  );
  const atMs = Date.parse(at);
  const data = useLatest<EventsPayload>(
    types.length
      ? apiPath('/history/events', {
          from: new Date(atMs - LOOKBACK_MS).toISOString(),
          to: at,
          types: types.join(','),
          order: 'desc',
          limit: 150,
        })
      : null,
  );
  const toggle = (type: TimelineEventType) =>
    setTypes((shown) =>
      shown.includes(type) ? shown.filter((other) => other !== type) : [...shown, type],
    );

  return (
    <Tape
      title="Event log"
      aside={
        <div className="tape-chips">
          {EVENT_TYPES.map((type) => (
            <button
              type="button"
              key={type}
              className={`chip toggle${types.includes(type) ? ' on' : ''}`}
              aria-pressed={types.includes(type)}
              onClick={() => toggle(type)}
            >
              <i className={`event-dot event-${type}`} />
              {type}
            </button>
          ))}
        </div>
      }
      items={types.length ? (data?.events ?? []) : []}
      empty="Nothing in the 10 minutes before the cursor"
      row={(event) => (
        <TapeRow
          key={event.id}
          ts={event.ts}
          kind={event.type}
          detail={event.summary}
          fresh={atMs - Date.parse(event.ts) < FRESH_MS}
        />
      )}
    />
  );
}
