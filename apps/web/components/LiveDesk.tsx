'use client';

import { useLiveDesk } from '@/lib/useLiveDesk';
import { AppHeader, UtcClock } from './AppHeader';
import { OpsView } from './OpsView';
import { AnomalyTape } from './Tapes';

export function LiveDesk() {
  const live = useLiveDesk();
  const { status } = live;
  const anomalyTotal = Object.values(live.anomaly.counts).reduce(
    (sum, count) => sum + (count ?? 0),
    0,
  );

  return (
    <div className="desk">
      <AppHeader airport={status.airport ?? live.map.airport}>
        <span className={`signal ${live.connected ? 'on' : 'off'}`}>
          {live.connected ? 'Live' : 'Reconnecting'}
        </span>
        {status.feed && <span className="pill">{status.feed} feed</span>}
        <span className="pill">reconnects {status.reconnects}</span>
        <UtcClock />
      </AppHeader>

      {status.locked ? (
        <div className="banner">
          Feed misconfigured: expected <strong>{status.expected}</strong>, got{' '}
          <strong>{status.got}</strong>. Ingest is ignoring it.
        </div>
      ) : (
        <OpsView
          board={live.board}
          map={live.map}
          alerts={live.alert.alerts}
          kpis={live.kpis}
          at={Date.now()}
          extraTicks={[{ label: 'Feed anomalies', value: anomalyTotal }]}
          tape={<AnomalyTape anomalies={live.anomaly} />}
        />
      )}
    </div>
  );
}
