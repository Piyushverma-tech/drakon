'use client';

import { Bell, RefreshCcw, Search, Share } from 'lucide-react';
import { useDashboardSearchContext } from '@/app/dashboard/context/DashboardSearchContext';
import { UtcClock } from './UtcClock';

export function Topbar() {
  const { query, setQuery, placeholder } = useDashboardSearchContext();

  return (
    <header className="sticky top-0 z-10 h-14 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="h-full text-sm text-muted-foreground flex items-center justify-between gap-3 px-6">
        <UtcClock />
        <div className="relative flex-1 max-w-xl ml-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={placeholder}
            className="w-full h-[30px] pl-9 pr-3 rounded-md bg-secondary/60 text-sm border focus:outline-none focus:ring-1 focus:ring-cyan-700"
          />
        </div>
        <div className=" flex items-center justify-end gap-4 px-2">
          <RefreshCcw className="size-4" />
          <Bell className="size-4" />
          <Share className="size-4" />
        </div>
      </div>
    </header>
  );
}
