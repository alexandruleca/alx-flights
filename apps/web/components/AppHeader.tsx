'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { AirportInfo } from '@alx/contracts';
import { hhmmss } from '@/lib/format';
import { SECOND_MS } from '@/lib/time';

const TABS = [
  { href: '/', label: 'Live' },
  { href: '/replay', label: 'Replay' },
];

export function AppHeader({
  airport,
  children,
}: {
  airport?: AirportInfo | null;
  /** Status badges on the right: connection live, cursor time in replay. */
  children?: ReactNode;
}) {
  const path = usePathname();
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-code">{airport?.code ?? 'ALX'}</span>
        <span className="brand-name">{airport?.name ?? 'Ops desk'}</span>
      </div>
      <nav className="tabs">
        {TABS.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className={`tab${path === tab.href ? ' active' : ''}`}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      <div className="topbar-status">{children}</div>
    </header>
  );
}

export function Clock({ iso }: { iso: string | null }) {
  return (
    <span className="clock mono">
      {iso ? hhmmss(iso) : '--:--:--'}
      <small>UTC</small>
    </span>
  );
}

/** Own component so the 1 s tick re-renders only the clock. */
export function UtcClock() {
  const [now, setNow] = useState<string | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date().toISOString());
    tick();
    const timer = setInterval(tick, SECOND_MS);
    return () => clearInterval(timer);
  }, []);
  return <Clock iso={now} />;
}
