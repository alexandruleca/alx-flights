'use client';

import { useEffect, useRef, useState } from 'react';
import { getJson } from './api';

interface Request {
  path: string;
  /** Bumped by the refresh timer, so the same path is asked for again. */
  generation: number;
}

const same = (a: Request | null, b: Request | null) =>
  a?.path === b?.path && a?.generation === b?.generation;

/**
 * Fetch JSON for an API path that changes faster than the server answers
 * (scrubbing, playback): at most one request in flight, and when it lands
 * the newest wanted path is fetched next. Intermediate paths are skipped.
 * With `refreshMs`, the current path is also re-fetched on that interval.
 */
export function useLatest<T>(path: string | null, refreshMs?: number): T | null {
  const [data, setData] = useState<T | null>(null);
  const [generation, setGeneration] = useState(0);
  const wanted = useRef<Request | null>(null);
  const busy = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!path || !refreshMs) return;
    const id = setInterval(() => setGeneration((g) => g + 1), refreshMs);
    return () => clearInterval(id);
  }, [path, refreshMs]);

  useEffect(() => {
    wanted.current = path ? { path, generation } : null;
    if (busy.current) return;
    busy.current = true;
    void (async () => {
      let fetched: Request | null = null;
      while (mounted.current && wanted.current && !same(wanted.current, fetched)) {
        fetched = wanted.current;
        try {
          const json = await getJson<T>(fetched.path);
          if (mounted.current) setData(json);
        } catch {
          /* keep the last good data; the next change or refresh retries */
        }
      }
      busy.current = false;
    })();
  }, [path, generation]);

  return data;
}
