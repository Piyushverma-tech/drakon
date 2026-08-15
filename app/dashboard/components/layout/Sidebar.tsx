'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  type LucideIcon,
  LayoutGrid,
  Radar,
  Move3D,
  ChartPie,
  Settings,
  Flame,
  Earth,
  CornerDownRight,
  X,
} from 'lucide-react';
import Image from 'next/image';

type NavChildConfig = {
  label: (segment: string) => string;
};

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
  child?: NavChildConfig;
};

const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutGrid, exact: true },
  { href: '/globe', label: 'Globe', icon: Earth },
  {
    href: '/dashboard/reentry',
    label: 'Re-entry Screening',
    icon: Flame,
    child: {
      label: (segment) => `NORAD ${segment}`,
    },
  },
  {
    href: '/dashboard/collisions',
    label: 'Collision Screening',
    icon: Radar,
  },
  { href: '/dashboard/maneuvers', label: 'Maneuver Design', icon: Move3D },
  { href: '/dashboard/reports', label: 'Reports', icon: ChartPie },
  { href: '/dashboard/profile', label: 'Profile & Settings', icon: Settings },
];

function getActiveChild(pathname: string, item: NavItem) {
  if (!item.child) {
    return null;
  }

  const childPathPrefix = `${item.href}/`;

  if (!pathname.startsWith(childPathPrefix)) {
    return null;
  }

  const childSegment = pathname.slice(childPathPrefix.length).split('/')[0];

  if (!childSegment) {
    return null;
  }

  const decodedSegment = decodeURIComponent(childSegment);

  return {
    href: `${childPathPrefix}${childSegment}`,
    label: item.child.label(decodedSegment),
  };
}

export function Sidebar() {
  const pathname = usePathname();

  return (
    <div className="flex h-dvh flex-col overflow-y-auto">
      <div className="h-14 mt-1 px-4 pt-1 ml-4 flex items-center border-b/50">
        <Link href="/dashboard" className="font-semibold tracking-tight">
          <Image alt="logo" src="/drakon.png" width={112} height={112} />
        </Link>
      </div>

      <nav className="px-2 mt-6 space-y-1">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = item.exact
            ? pathname === item.href
            : pathname === item.href || pathname.startsWith(`${item.href}/`);
          const child = getActiveChild(pathname, item);

          return (
            <div key={item.href} className="space-y-1">
              <Link
                href={item.href}
                className={cn(
                  'group relative flex items-center gap-3 px-3 py-2 rounded-md text-sm transition',
                  isActive
                    ? 'bg-cyan-400/20 text-sidebar-accent-foreground'
                    : 'hover:bg-sidebar-accent/60 text-accent-foreground/80 hover:text-accent-foreground'
                )}
              >
                {isActive && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-0.5 rounded-full bg-cyan-400" />
                )}
                <Icon className="size-4" />
                <span>{item.label}</span>
              </Link>

              {child && (
                <div className="ml-5 border-l border-cyan-400/30 pl-2">
                  <div className="group flex items-center rounded-md bg-sidebar-accent/70 text-sm text-sidebar-accent-foreground transition hover:bg-sidebar-accent">
                    <Link
                      href={child.href}
                      className="flex min-w-0 flex-1 items-center gap-2 px-2 py-2"
                    >
                      <CornerDownRight
                        className="size-4 shrink-0 text-cyan-300/80"
                        aria-hidden="true"
                      />
                      <span className="truncate text-xs font-medium">
                        {child.label}
                      </span>
                    </Link>
                    <Link
                      href={item.href}
                      aria-label={`Leave ${child.label}`}
                      title={`Leave ${child.label}`}
                      className="mr-1 flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground transition hover:bg-background/40 hover:text-foreground"
                    >
                      <X className="size-3.5" aria-hidden="true" />
                    </Link>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </nav>
      <div className="mt-auto border-t/50 p-3 text-xs text-muted-foreground">
        <div className="opacity-70">v0.1.0</div>
      </div>
    </div>
  );
}
