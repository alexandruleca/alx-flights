'use client';

import { useCallback, useEffect, useState } from 'react';
import type { VolumePayload } from '@alx/contracts';
import { SECOND_MS } from './time';

const TICK_MS = 200;
export const SPEEDS = [1, 4, 16, 60] as const;

/**
 * A cursor over the loaded timeline, in feed time (ms): seek, step by bucket,
 * play at `speed`× real time. A new timeline restarts where recording starts.
 */
export function usePlayback(volume: VolumePayload | null) {
  const [cursor, setCursor] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(4);

  const from = volume ? Date.parse(volume.from) : 0;
  const to = volume ? Date.parse(volume.to) : 0;
  const bucketMs = (volume?.bucketSeconds ?? 30) * SECOND_MS;
  const start = volume ? Date.parse(volume.points[0]?.start ?? volume.from) : null;

  useEffect(() => {
    setPlaying(false);
    setCursor(start);
    // Only a new timeline resets the cursor; `start` derives from it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [volume]);

  const clamp = useCallback((ms: number) => Math.min(to, Math.max(from, ms)), [from, to]);
  const seek = useCallback((ms: number) => setCursor(clamp(ms)), [clamp]);
  const step = useCallback(
    (buckets: number) =>
      setCursor((current) => (current === null ? null : clamp(current + buckets * bucketMs))),
    [clamp, bucketMs],
  );
  const toggle = useCallback(() => {
    if (!playing && cursor !== null && cursor >= to) setCursor(start);
    setPlaying((wasPlaying) => !wasPlaying);
  }, [playing, cursor, to, start]);

  useEffect(() => {
    if (!playing) return;
    const advance = () =>
      setCursor((current) => (current === null ? null : Math.min(to, current + TICK_MS * speed)));
    const timer = setInterval(advance, TICK_MS);
    return () => clearInterval(timer);
  }, [playing, speed, to]);

  useEffect(() => {
    if (playing && cursor !== null && cursor >= to) setPlaying(false);
  }, [playing, cursor, to]);

  return { cursor, playing, speed, setSpeed, seek, step, toggle, from, to, bucketMs };
}

export type Playback = ReturnType<typeof usePlayback>;
