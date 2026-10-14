'use client';

import { useState } from 'react';
import type { FramePayload } from '@alx/contracts';
import { apiPath } from '@/lib/api';
import { useLatest } from '@/lib/useLatest';
import { usePlayback } from '@/lib/usePlayback';
import { useTimeline, type Range } from '@/lib/useTimeline';
import { AppHeader, Clock } from './AppHeader';
import { OpsView } from './OpsView';
import { DEFAULT_PRESET, ReplayBar, presetRange } from './ReplayBar';
import { EventTape } from './Tapes';

/** The live desk, fed from the past: a frame per cursor position. */
export function ReplayDesk() {
  const [range, setRange] = useState<Range>(() => presetRange(DEFAULT_PRESET));
  const { volume, error } = useTimeline(range);
  const playback = usePlayback(volume);
  const at = playback.cursor === null ? null : new Date(playback.cursor).toISOString();
  const frame = useLatest<FramePayload>(at && apiPath('/history/frame', { at }));

  return (
    <div className="desk">
      <AppHeader airport={frame?.map.airport}>
        <span className="signal replay">Replay</span>
        <Clock iso={at} />
      </AppHeader>

      <ReplayBar
        range={range}
        onRange={setRange}
        volume={volume}
        error={error}
        playback={playback}
      />

      {frame && at ? (
        <OpsView
          board={frame.board}
          map={frame.map}
          alerts={frame.alerts}
          kpis={frame.kpis}
          at={Date.parse(frame.at)}
          tape={<EventTape at={at} />}
          alertLogUntil={frame.at}
        />
      ) : (
        <div className="desk-loading muted">Loading replay…</div>
      )}
    </div>
  );
}
