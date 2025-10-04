'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
 import { LayoutGrid, Radar, Move3D, ChartPie, Settings } from 'lucide-react';

 const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutGrid },
   { href: '/globe', label: 'Globe', icon: Radar },
  { href: '/collision', label: 'Collision Screening', icon: Radar },
  { href: '/maneuvers', label: 'Maneuver Design', icon: Move3D },
  { href: '/reports', label: 'Reports', icon: ChartPie },
  { href: '/settings', label: 'Profile & Settings', icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <div className="h-full flex flex-col">
      <div className="h-14 px-4 flex items-center border-b/50">
        <Link href="/dashboard" className="font-semibold tracking-tight">
          DRAKON
        </Link>
      </div>

      <nav className="px-2 mt-8 space-y-1">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'group relative flex items-center gap-3 px-3 py-2 rounded-md text-sm transition',
                isActive
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'hover:bg-sidebar-accent/60'
              )}
            >
              {isActive && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-0.5 rounded-full bg-sidebar-primary" />
              )}
              <Icon className="size-4" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto border-t/50 p-3 text-xs text-muted-foreground">
        <div>
          Live Status: <span className="text-emerald-400">Online</span>
        </div>
        <div className="opacity-70">v0.1.0</div>
      </div>
    </div>
  );
}
