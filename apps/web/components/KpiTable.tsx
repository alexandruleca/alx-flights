'use client';

import type { CSSProperties } from 'react';
import type { KpisPayload } from '@alx/contracts';
import { hhmm, percent } from '@/lib/format';

/**
 * The KPIs per UTC hour, newest first: landings and take-offs, on-time
 * performance, and the minutes each stand was occupied, shaded by how much of
 * the hour that is. The hour in progress is emphasised.
 */
export function KpiTable({
  kpis,
  stands,
  currentHour,
}: {
  kpis: KpisPayload;
  /** Every stand, in order: one column each. */
  stands: string[];
  /** The hour shown as "this hour" (ISO, start of the hour). */
  currentHour: string;
}) {
  const hours = [...new Set([...kpis.movements, ...kpis.standUse].map((h) => h.hour))]
    .sort()
    .reverse();

  return (
    <section className="tape">
      <header className="tape-head">
        <h2>Per hour</h2>
        <span className="tape-count">stands: minutes occupied</span>
      </header>
      <div className="tape-body">
        {hours.length ? (
          <table className="kpi-table">
            <thead>
              <tr>
                <th>UTC</th>
                <th title="Landings">Land</th>
                <th title="Take-offs">T/O</th>
                <th title="Arrivals that landed within 15 min of schedule">On time</th>
                {stands.map((stand) => (
                  <th key={stand}>{stand}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {hours.map((hour) => {
                const moves = kpis.movements.find((m) => m.hour === hour);
                const minutesByStand = kpis.standUse.find((u) => u.hour === hour)?.minutes ?? {};
                const landings = moves?.landings ?? 0;
                const onTime = moves?.onTimeLandings ?? 0;
                return (
                  <tr key={hour} className={hour === currentHour ? 'is-current' : undefined}>
                    <td>{hhmm(hour)}</td>
                    <td>{landings}</td>
                    <td>{moves?.takeoffs ?? 0}</td>
                    <td
                      title={`${onTime} of ${landings} arrivals landed within 15 min of schedule`}
                    >
                      {percent(onTime, landings)}
                    </td>
                    {stands.map((stand) => {
                      const minutes = Math.round(minutesByStand[stand] ?? 0);
                      return (
                        <td
                          key={stand}
                          className={`stand-minutes${minutes ? '' : ' is-zero'}`}
                          style={{ '--share-of-hour': minutes / 60 } as CSSProperties}
                          title={`${stand}, ${hhmm(hour)} hour: ${minutes} min occupied`}
                        >
                          {minutes || '·'}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div className="tape-empty">Nothing measured yet</div>
        )}
      </div>
    </section>
  );
}
