'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  LayoutGrid,
  Radar,
  Move3D,
  ChartPie,
  Settings,
  Flame,
  Earth,
} from 'lucide-react';
import Image from 'next/image';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutGrid, exact: true },
  { href: '/globe', label: 'Globe', icon: Earth },
  { href: '/dashboard/reentry', label: 'Re-entry Screening', icon: Flame },
  {
    href: '/dashboard/collisions',
    label: 'Collision Screening',
    icon: Radar,
  },
  { href: '/dashboard/maneuvers', label: 'Maneuver Design', icon: Move3D },
  { href: '/dashboard/reports', label: 'Reports', icon: ChartPie },
  { href: '/dashboard/profile', label: 'Profile & Settings', icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <div className="flex h-dvh flex-col overflow-y-auto">
      <div className="h-14 mt-1 px-4 flex items-center border-b/50">
        <Link href="/dashboard" className="font-semibold tracking-tight">
          <Image alt="logo" src="/drakon.png" width={150} height={150} />
        </Link>
      </div>

      <nav className="px-2 mt-6 space-y-1">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = item.exact
            ? pathname === item.href
            : pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'group relative flex items-center gap-3 px-3 py-2 rounded-md text-sm transition',
                isActive
                  ? 'bg-cyan-400/20 text-sidebar-accent-foreground'
                  : 'hover:bg-sidebar-accent/60 text-accent-foreground/70 hover:text-accent-foreground'
              )}
            >
              {isActive && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-0.5 rounded-full bg-cyan-400" />
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
