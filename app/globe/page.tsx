'use client';
import Link from 'next/link';
import { ArrowLeft, Search } from 'lucide-react';
import Image from 'next/image';
import { useState } from 'react';
import GlobeContainer from './GlobeContent/GlobeContainer';
import MobileViewNotice from './GlobeContent/components/MobileViewNotice';
import { useAppDispatch, useAppSelector } from '@/lib/store';
import { setViewMode } from '@/lib/visualization-slice';

function GlobeContent() {
  const dispatch = useAppDispatch();
  const viewMode = useAppSelector((state) => state.visualization.viewMode);
  const [searchQuery, setSearchQuery] = useState('');

  function handleClearSearch() {
    setSearchQuery('');
  }

  return (
    <div className="fixed inset-0 bg-black flex flex-col overflow-hidden">
      <div className="absolute inset-0 bg-gradient-radial from-transparent via-transparent to-blue-950/20 pointer-events-none" />

      <header className="relative z-20 flex items-center px-5 h-14 shrink-0">
        {/* LEFT */}
        <div className="flex-1">
          <Link
            href="/dashboard"
            className="relative inline-flex items-center gap-2 px-4 py-2 bg-black/40 backdrop-blur-md border border-gray-400/30 rounded-md"
          >
            <div className="absolute top-0 left-0 w-2 h-2 border-l border-t border-cyan-400" />
            <div className="absolute top-0 right-0 w-2 h-2 border-r border-t border-cyan-400" />
            <div className="absolute bottom-0 left-0 w-2 h-2 border-l border-b border-cyan-400" />
            <div className="absolute bottom-0 right-0 w-2 h-2 border-r border-b border-cyan-400" />

            <ArrowLeft className="w-4 h-4 text-white" />
            <span className="text-gray-200 text-sm font-medium">
              Back to Dashboard
            </span>
          </Link>
        </div>

        {/* CENTER (Search + Toggle together) */}
        <div className="flex items-center gap-4 ml-[8rem]">
          {/* Search */}
          <div className="relative w-[580px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by name or NORAD ID..."
              className="w-full h-8 pl-9 pr-3 rounded-md bg-secondary text-sm focus:outline-none focus:ring-1 focus:ring-cyan-700"
            />
          </div>

          {/* Toggle */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-medium uppercase tracking-wide text-gray-200">
              View Mode
            </span>
            <div className="flex rounded border border-cyan-400/30 overflow-hidden">
              <button
                type="button"
                onClick={() => dispatch(setViewMode('3D'))}
                className={`px-2.5 py-1 text-xs cursor-pointer ${
                  viewMode === '3D'
                    ? 'bg-cyan-500/30 text-cyan-200'
                    : 'text-gray-300 hover:bg-cyan-500/10'
                }`}
              >
                3D
              </button>
              <button
                type="button"
                onClick={() => dispatch(setViewMode('2D'))}
                className={`px-2.5 py-1 text-xs cursor-pointer ${
                  viewMode === '2D'
                    ? 'bg-cyan-500/30 text-cyan-200'
                    : 'text-gray-300 hover:bg-cyan-500/10'
                }`}
              >
                2D
              </button>
            </div>
          </div>
        </div>

        {/* RIGHT */}
        <div className="flex-1 flex justify-end">
          <Image alt="logo" src="/drakon.png" width={170} height={170} />
        </div>
      </header>

      {/* Globe */}
      <main className="relative z-10 flex-1 min-h-0">
        <GlobeContainer
          searchQuery={searchQuery}
          onClearSearch={handleClearSearch}
        />
      </main>
    </div>
  );
}

export default function GlobePage() {
  return (
    <>
      <div className="md:hidden">
        <MobileViewNotice />
      </div>
      <div className="hidden md:block">
        <GlobeContent />
      </div>
    </>
  );
}
