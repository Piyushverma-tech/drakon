'use client';

import { useEffect, useState } from 'react';

function formatUtcClock(date: Date): string {
  return date.toISOString().slice(11, 19);
}

export function UtcClock() {
  const [utcTime, setUtcTime] = useState<string | null>(null);

  useEffect(() => {
    const tick = () => setUtcTime(formatUtcClock(new Date()));
    tick();
    const intervalId = window.setInterval(tick, 1000);
    return () => window.clearInterval(intervalId);
  }, []);

  return (
    <span className="inline-flex items-center gap-2 text-[12px] tabular-nums">
      <span className="inline-flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
        Live
      </span>
      <span aria-live="polite">
        {utcTime ? `${utcTime} UTC` : '--:--:-- UTC'}
      </span>
    </span>
  );
}
