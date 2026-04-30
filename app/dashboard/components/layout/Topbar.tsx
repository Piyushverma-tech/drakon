'use client';
import { Bell, Clock, RefreshCcw, Search, Share } from 'lucide-react';

export function Topbar() {
  return (
    <header className="sticky top-0 z-10 h-14 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="h-full text-sm text-muted-foreground flex items-center justify-between gap-3 px-6">
        Live • 00:00:00 UTC
        <div className="relative flex-1 max-w-xl ml-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <input
            placeholder="Search..."
            className="w-full h-8 pl-9 pr-3 rounded-md bg-secondary text-sm border"
          />
        </div>
        <div className=" flex items-center justify-end gap-3 px-2">
          <Bell className="size-5" />
          <Clock className="size-5" />
          <Share className="size-5" />
          <RefreshCcw className="size-5" />
        </div>
      </div>
    </header>
  );
}


