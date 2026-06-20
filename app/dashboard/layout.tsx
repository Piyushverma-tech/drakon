import { ReactNode } from 'react';
import { Sidebar } from '@/app/dashboard/components/layout/Sidebar';
import { Topbar } from '@/app/dashboard/components/layout/Topbar';
import { DashboardSearchProvider } from '@/app/dashboard/context/DashboardSearchContext';

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <DashboardSearchProvider>
      <div className="min-h-dvh md:pl-[240px]">
        <aside className="hidden md:block fixed inset-y-0 left-0 z-20 w-[240px] border-r bg-black text-sidebar-foreground">
          <Sidebar />
        </aside>
        <div className="flex flex-col min-w-0">
          <Topbar />
          <main className="p-4 min-w-0">{children}</main>
        </div>
      </div>
    </DashboardSearchProvider>
  );
}
