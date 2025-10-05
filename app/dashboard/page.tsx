import SatelliteGlobe from '@/components/SatelliteGlobe';
import Link from 'next/link';
import React from 'react';

export default function DashboardPage() {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-[1fr_1.5fr_1fr] auto-rows-min">
      {/* Fleet Health */}
      <div className="border rounded-xl p-4 bg-card">
        <h2 className="text-lg font-semibold mb-4">Fleet Health</h2>
        <div className="h-40 flex items-center justify-center text-gray-500">
          Fleet Health Content
        </div>
      </div>

      {/*Globe */}
      <div className="border md:row-span-2 rounded-xl p-2 bg-black">
        <h2 className="text-lg font-semibold mb-2 w-full border-b-2">Globe</h2>
        <div className="h-[280px] md:h-[400px] rounded-lg overflow-hidden">
          <SatelliteGlobe />
        </div>
        <div className="mt-2 text-right text-xs">
          <Link
            href="/globe"
            className="underline text-muted-foreground hover:text-foreground"
          >
            Open full view →
          </Link>
        </div>
      </div>

      {/* Critical Alerts */}
      <div className="border rounded-xl p-4 bg-card">
        <h2 className="text-lg font-semibold mb-4">Critical Alerts</h2>
        <div className="space-y-2">
          <div className="text-sm">Alert 1</div>
          <div className="text-sm">Alert 2</div>
          <div className="text-sm">Alert 3</div>
        </div>
      </div>

      {/* Proximity Timeline*/}
      <div className="border rounded-xl p-4 bg-card">
        <h2 className="text-lg font-semibold mb-4">
          Proximity Timeline (Next 24h)
        </h2>
        <div className="h-40 flex items-center justify-center text-gray-500">
          Proximity Timeline Content
        </div>
      </div>

      {/* Historical Trends */}
      <div className="border rounded-xl p-4 bg-card">
        <h2 className="text-lg font-semibold mb-4">Risk Distribution</h2>
        <div className="h-40 flex items-center justify-center text-gray-500">
          Trends Content
        </div>
      </div>

      {/* Widget 6 */}
      <div className="border rounded-xl p-4 bg-card">
        <h2 className="text-lg font-semibold mb-4">Collision Risk Index</h2>
        <div className="h-32 flex items-center justify-center text-gray-500">
          Widget Content
        </div>
      </div>

      {/* Widget 7 */}
      <div className="border rounded-xl p-4 bg-card">
        <h2 className="text-lg font-semibold mb-4">Historical Trends</h2>
        <div className="h-32 flex items-center justify-center text-gray-500">
          Widget Content
        </div>
      </div>

      {/* Widget 8 */}
      <div className="border rounded-xl p-4 bg-card">
        <h2 className="text-lg font-semibold mb-4">Operational Cost Impact</h2>
        <div className="h-32 flex items-center justify-center text-gray-500">
          Widget Content
        </div>
      </div>
    </div>
  );
}
