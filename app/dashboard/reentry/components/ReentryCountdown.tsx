'use client';

import { useEffect, useState } from 'react';

function formatCountdown(targetIso: string): string {
  const remainingMs = new Date(targetIso).getTime() - Date.now();
  if (remainingMs <= 0) return 'Imminent';

  const totalSeconds = Math.floor(remainingMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) {
    return `${days}d ${hours.toString().padStart(2, '0')}h ${minutes
      .toString()
      .padStart(2, '0')}m`;
  }

  return `${hours.toString().padStart(2, '0')}:${minutes
    .toString()
    .padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

type Props = {
  targetIso: string;
  className?: string;
};

export function ReentryCountdown({ targetIso, className }: Props) {
  const [label, setLabel] = useState('—');

  useEffect(() => {
    const tick = () => setLabel(formatCountdown(targetIso));
    tick();
    const intervalId = window.setInterval(tick, 1000);
    return () => window.clearInterval(intervalId);
  }, [targetIso]);

  return (
    <div className={className}>
      <div className="text-[10px] uppercase tracking-widest text-gray-500 mb-1">
        Predicted Re-entry in
      </div>
      <div className="font-mono text-[13px] tabular-nums text-cyan-300/90">
        {label}
      </div>
    </div>
  );
}
