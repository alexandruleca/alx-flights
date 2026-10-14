'use client';

import { useState } from 'react';
import type { VolumePayload } from '@alx/contracts';
import { duration, hhmmss } from '@/lib/format';
import { HOUR_MS, MINUTE_MS } from '@/lib/time';
import { useHotkeys } from '@/lib/useHotkeys';
import { SPEEDS, type Playback } from '@/lib/usePlayback';
import type { Range } from '@/lib/useTimeline';
import { Segmented, type Option } from './Segmented';
import { VolumeScrubber } from './VolumeScrubber';

const PRESETS = [
  { key: '10m', label: '10 min', ms: 10 * MINUTE_MS },
  { key: '30m', label: '30 min', ms: 30 * MINUTE_MS },
  { key: '1h', label: '1 h', ms: HOUR_MS },
  { key: '6h', label: '6 h', ms: 6 * HOUR_MS },
  { key: '24h', label: '24 h', ms: 24 * HOUR_MS },
] as const;

type PresetKey = (typeof PRESETS)[number]['key'];
export const DEFAULT_PRESET: PresetKey = '30m';

/** The last `preset` of time, ending now. */
export function presetRange(key: PresetKey): Range {
  const preset = PRESETS.find((candidate) => candidate.key === key)!;
  const to = Date.now();
  return { from: new Date(to - preset.ms).toISOString(), to: new Date(to).toISOString() };
}

/** Transport, speed, range and the scrubber — everything that moves the replay cursor. */
export function ReplayBar({
  range,
  onRange,
  volume,
  error,
  playback,
}: {
  range: Range;
  onRange: (range: Range) => void;
  volume: VolumePayload | null;
  error: string | null;
  playback: Playback;
}) {
  useHotkeys({
    ' ': playback.toggle,
    ArrowLeft: (e) => playback.step(e.shiftKey ? -10 : -1),
    ArrowRight: (e) => playback.step(e.shiftKey ? 10 : 1),
    Home: () => playback.seek(playback.from),
    End: () => playback.seek(playback.to),
  });
  const { cursor } = playback;

  return (
    <section className="replay-bar">
      <div className="replay-controls">
        <Transport playback={playback} disabled={!volume} />
        <Segmented
          label="Speed"
          options={SPEEDS.map((speed) => ({ value: speed, label: `${speed}×` }))}
          value={playback.speed}
          onChange={playback.setSpeed}
        />
        <div className="replay-at">
          <span className="replay-time mono">
            {cursor === null ? '--:--:--' : hhmmss(new Date(cursor).toISOString())}
          </span>
          {cursor !== null && (
            <>
              <span className="muted">{new Date(cursor).toISOString().slice(0, 10)} UTC</span>
              <span className="mono muted" title="Time left to the end of the range">
                −{duration(playback.to - cursor)}
              </span>
            </>
          )}
        </div>
        <RangePicker range={range} onRange={onRange} />
      </div>

      {error && <div className="banner">{error}</div>}
      {volume && cursor !== null && (
        <VolumeScrubber volume={volume} cursor={cursor} onSeek={playback.seek} />
      )}
      {volume && !volume.points.length && (
        <p className="muted">Nothing recorded in this range — is ingest running?</p>
      )}
    </section>
  );
}

const ICONS = {
  start: 'M5 4h2v16H5zM20 4v16L9 12z',
  back: 'M11 5v14L3 12zM21 5v14l-8-7z',
  play: 'M7 4v16l13-8z',
  pause: 'M6 4h4v16H6zM14 4h4v16h-4z',
  forward: 'M3 5v14l8-7zM13 5v14l8-7z',
  end: 'M4 4v16l11-8zM17 4h2v16h-2z',
};

function Transport({ playback, disabled }: { playback: Playback; disabled: boolean }) {
  const buttons = [
    { icon: ICONS.start, title: 'To start (Home)', run: () => playback.seek(playback.from) },
    { icon: ICONS.back, title: 'Step back (←)', run: () => playback.step(-1) },
    {
      icon: playback.playing ? ICONS.pause : ICONS.play,
      title: 'Play / pause (space)',
      run: playback.toggle,
      primary: true,
    },
    { icon: ICONS.forward, title: 'Step forward (→)', run: () => playback.step(1) },
    { icon: ICONS.end, title: 'To end (End)', run: () => playback.seek(playback.to) },
  ];
  return (
    <div className="transport" role="group" aria-label="Playback">
      {buttons.map((button) => (
        <button
          key={button.title}
          type="button"
          className={`transport-button${button.primary ? ' play' : ''}`}
          title={button.title}
          aria-label={button.title}
          onClick={button.run}
          disabled={disabled}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d={button.icon} />
          </svg>
        </button>
      ))}
    </div>
  );
}

const RANGE_OPTIONS: Option<PresetKey | 'custom'>[] = [
  ...PRESETS.map((preset) => ({
    value: preset.key,
    label: preset.label,
    title: `Last ${preset.label}, ending now`,
  })),
  { value: 'custom', label: 'Custom' },
];

/** Presets end "now"; Custom takes any UTC range. */
function RangePicker({ range, onRange }: { range: Range; onRange: (range: Range) => void }) {
  const [active, setActive] = useState<PresetKey | 'custom'>(DEFAULT_PRESET);
  const [draft, setDraft] = useState<Range | null>(null);

  const pick = (key: PresetKey | 'custom') => {
    setActive(key);
    if (key === 'custom') {
      setDraft({ from: toUtcInput(range.from), to: toUtcInput(range.to) });
    } else {
      setDraft(null);
      onRange(presetRange(key));
    }
  };

  return (
    <div className="range-picker">
      <Segmented label="Range" options={RANGE_OPTIONS} value={active} onChange={pick} />
      {draft && (
        <form
          className="custom-range"
          onSubmit={(e) => {
            e.preventDefault();
            onRange({ from: fromUtcInput(draft.from), to: fromUtcInput(draft.to) });
          }}
        >
          {(['from', 'to'] as const).map((edge) => (
            <label key={edge}>
              {edge === 'from' ? 'From' : 'To'} (UTC)
              <input
                type="datetime-local"
                value={draft[edge]}
                onChange={(e) => setDraft({ ...draft, [edge]: e.target.value })}
              />
            </label>
          ))}
          <button type="submit" className="btn">
            Load range
          </button>
        </form>
      )}
    </div>
  );
}

/** `datetime-local` has no zone; the desk reads it as UTC like every other time. */
function toUtcInput(iso: string): string {
  return iso.slice(0, 16);
}

function fromUtcInput(value: string): string {
  return new Date(`${value}:00.000Z`).toISOString();
}
