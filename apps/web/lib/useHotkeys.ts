'use client';

import { useEffect, useRef } from 'react';

type Handlers = Partial<Record<string, (event: KeyboardEvent) => void>>;

/** Window-level shortcuts, keyed by `KeyboardEvent.key`. */
export function useHotkeys(handlers: Handlers): void {
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const handler = latest.current[event.key];
      if (!handler || handledNatively(event)) return;
      event.preventDefault();
      handler(event);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/** Leave keys to the focused control when it already uses them. */
function handledNatively(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement;
  if (target.closest('input, select, textarea')) return true;
  return (event.key === ' ' || event.key === 'Enter') && target.closest('button, a') !== null;
}
