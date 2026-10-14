'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { VolumePayload } from '@alx/contracts';
import { hhmm, hhmmss } from '@/lib/format';
import { MINUTE_MS, SECOND_MS } from '@/lib/time';

const BAR_HEIGHT = 52;
const AXIS_HEIGHT = 16;
const TICK_STEPS_MIN = [1, 2, 5, 10, 15, 30, 60, 120, 180, 360];
const MIN_TICK_GAP_PX = 110;

/**
 * Event volume over the replay range, doubling as the seek bar: click or drag
 * to move the cursor; bars left of it are played. Keyboard steps are handled
 * by the replay bar's shortcuts.
 */
export function VolumeScrubber({
  volume,
  cursor,
  onSeek,
}: {
  volume: VolumePayload;
  cursor: number;
  onSeek: (ms: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hoverMs, setHoverMs] = useState<number | null>(null);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(track);
    return () => observer.disconnect();
  }, []);

  const fromMs = Date.parse(volume.from);
  const spanMs = Math.max(1, Date.parse(volume.to) - fromMs);
  const bucketMs = volume.bucketSeconds * SECOND_MS;
  /** Where a feed time sits on the track, in pixels. */
  const toX = (ms: number) => ((ms - fromMs) / spanMs) * width;
  const peak = Math.max(1, ...volume.points.map((p) => p.count));

  const ticks = useMemo(() => timeTicks(fromMs, spanMs, width), [fromMs, spanMs, width]);

  /** The feed time under the pointer. */
  const timeAt = (clientX: number) => {
    const rect = trackRef.current!.getBoundingClientRect();
    return fromMs + Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * spanMs;
  };

  const hovered =
    hoverMs === null
      ? null
      : (volume.points.find((point) => {
          const start = Date.parse(point.start);
          return hoverMs >= start && hoverMs < start + bucketMs;
        }) ?? null);

  return (
    <div className="scrubber">
      <div
        ref={trackRef}
        className="scrubber-track"
        role="slider"
        tabIndex={0}
        aria-label="Replay position"
        aria-valuemin={fromMs}
        aria-valuemax={fromMs + spanMs}
        aria-valuenow={cursor}
        aria-valuetext={`${hhmmss(new Date(cursor).toISOString())} UTC`}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          onSeek(timeAt(e.clientX));
        }}
        onPointerMove={(e) => {
          const time = timeAt(e.clientX);
          setHoverMs(time);
          if (e.buttons === 1) onSeek(time);
        }}
        onPointerLeave={() => setHoverMs(null)}
      >
        {width > 0 && (
          <svg width={width} height={BAR_HEIGHT + AXIS_HEIGHT} aria-hidden>
            {ticks.map((tick) => (
              <line
                key={tick}
                x1={toX(tick)}
                x2={toX(tick)}
                y1={0}
                y2={BAR_HEIGHT}
                className="scrubber-grid"
              />
            ))}
            {volume.points.map((point) => {
              const start = Date.parse(point.start);
              const barWidth = Math.max(1, toX(start + bucketMs) - toX(start) - 2);
              const barHeight = Math.max(2, (point.count / peak) * (BAR_HEIGHT - 6));
              return (
                <path
                  key={point.start}
                  d={topRounded(
                    toX(start) + 1,
                    BAR_HEIGHT - barHeight,
                    barWidth,
                    barHeight,
                    Math.min(2, barWidth / 2),
                  )}
                  className={`scrubber-bar${start + bucketMs <= cursor ? ' played' : ''}${
                    point === hovered ? ' hover' : ''
                  }`}
                />
              );
            })}
            <line x1={0} x2={width} y1={BAR_HEIGHT} y2={BAR_HEIGHT} className="scrubber-base" />
            {ticks.map((tick) => (
              <text key={tick} x={toX(tick)} y={BAR_HEIGHT + 12} className="scrubber-tick">
                {hhmm(new Date(tick).toISOString())}
              </text>
            ))}
            {hoverMs !== null && (
              <line
                x1={toX(hoverMs)}
                x2={toX(hoverMs)}
                y1={0}
                y2={BAR_HEIGHT}
                className="scrubber-hover"
              />
            )}
            <line
              x1={toX(cursor)}
              x2={toX(cursor)}
              y1={0}
              y2={BAR_HEIGHT + 4}
              className="scrubber-cursor"
            />
            <circle cx={toX(cursor)} cy={3} r={4} className="scrubber-knob" />
          </svg>
        )}
      </div>
      <div className="scrubber-meta">
        <span>
          {hoverMs !== null ? (
            <>
              <b className="mono">{hhmmss(new Date(hoverMs).toISOString())}</b>{' '}
              {hovered ? (
                <>
                  · <b>{hovered.count}</b> events ({breakdown(hovered.byType)})
                </>
              ) : (
                '· no events'
              )}
            </>
          ) : (
            <>
              Events per {volume.bucketSeconds}s · peak {peak}
            </>
          )}
        </span>
        <span className="muted">←/→ step · shift ×10 · space play · Home/End</span>
      </div>
    </div>
  );
}

/** Round-minute ticks, spaced at least MIN_TICK_GAP_PX apart. */
function timeTicks(fromMs: number, spanMs: number, width: number): number[] {
  if (!width) return [];
  const maxTicks = Math.max(2, Math.floor(width / MIN_TICK_GAP_PX));
  const stepMin =
    TICK_STEPS_MIN.find((minutes) => spanMs / (minutes * MINUTE_MS) <= maxTicks) ?? 720;
  const stepMs = stepMin * MINUTE_MS;
  const ticks: number[] = [];
  for (let tick = Math.ceil(fromMs / stepMs) * stepMs; tick <= fromMs + spanMs; tick += stepMs) {
    ticks.push(tick);
  }
  return ticks;
}

/** `38 position, 3 flight` — largest first. */
function breakdown(byType: Record<string, number | undefined>): string {
  return Object.entries(byType)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
    .map(([type, count]) => `${count} ${type}`)
    .join(', ');
}

/** Bar path with rounded top corners and a square baseline. */
function topRounded(
  left: number,
  top: number,
  width: number,
  height: number,
  radius: number,
): string {
  const right = left + width;
  const bottom = top + height;
  return (
    `M${left},${bottom}V${top + radius}Q${left},${top} ${left + radius},${top}` +
    `H${right - radius}Q${right},${top} ${right},${top + radius}V${bottom}Z`
  );
}
