import { ReactNode } from 'react';
import { Sidebar } from '@/components/layout/Sidebar';
import { Topbar } from '@/components/layout/Topbar';

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh grid grid-cols-1 md:grid-cols-[240px_1fr]">
      <aside className="hidden md:block border-r bg-sidebar text-sidebar-foreground">
        <Sidebar />
      </aside>
      <div className="flex flex-col min-w-0">
        <Topbar />
        <main className="p-4  min-w-0">{children}</main>
      </div>
    </div>
  );
}



