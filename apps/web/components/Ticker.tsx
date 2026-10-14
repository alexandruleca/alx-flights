export interface Tick {
  label: string;
  value: number | string;
  tone?: 'warn' | 'danger';
}

/** The strip across the top of the desk: what needs attention right now. */
export function Ticker({ ticks }: { ticks: Tick[] }) {
  return (
    <div className="ticker">
      {ticks.map((tick) => (
        <div key={tick.label} className={`tick${tick.tone ? ` tone-${tick.tone}` : ''}`}>
          <span className="tick-label">{tick.label}</span>
          <span className="tick-value">{tick.value}</span>
        </div>
      ))}
    </div>
  );
}
