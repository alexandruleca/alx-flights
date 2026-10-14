'use client';

import { useEffect, useState } from 'react';
import type { VolumePayload } from '@alx/contracts';
import { apiPath, getJson } from './api';

export interface Range {
  from: string;
  to: string;
}

/** The scrubber's event volume for a range; the server picks the bucket size. */
export function useTimeline(range: Range) {
  const [volume, setVolume] = useState<VolumePayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    setError(null);
    getJson<VolumePayload>(apiPath('/history/volume', { ...range }))
      .then((loaded) => current && setVolume(loaded))
      .catch((reason: unknown) => {
        if (current) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      current = false;
    };
  }, [range]);

  return { volume, error };
}
