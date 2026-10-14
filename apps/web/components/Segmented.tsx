'use client';

export interface Option<T> {
  value: T;
  label: string;
  title?: string;
}

/** A row of mutually exclusive buttons (speed, range presets, map range). */
export function Segmented<T extends string | number>({
  label,
  options,
  value,
  onChange,
  className = '',
}: {
  label: string;
  options: Option<T>[];
  value: T | null;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div className={`segmented ${className}`} role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          className={option.value === value ? 'active' : undefined}
          aria-pressed={option.value === value}
          title={option.title}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
