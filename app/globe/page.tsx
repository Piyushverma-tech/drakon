'use client';
import Link from 'next/link';
import { ArrowLeft, Search } from 'lucide-react';
import Image from 'next/image';
import { useTleEntriesQuery } from '@/hooks/useTleEntriesQuery';
import { useMemo, useState } from 'react';
import type { TleEntry } from '@/lib/types';
import GlobeContainer from './GlobeContent/GlobeContainer';

const EMPTY_ENTRIES: TleEntry[] = [];

function GlobeContent() {
  const [searchQuery, setSearchQuery] = useState('');
  const { data: queriedEntries } = useTleEntriesQuery();
  const entries = queriedEntries ?? EMPTY_ENTRIES;

  const searchResults = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return [];

    return entries
      .filter(
        (e) =>
          e.name.toLowerCase().includes(query) ||
          e.id.toString().includes(query)
      )
      .slice(0, 20);
  }, [entries, searchQuery]);

  function handleClearSearch() {
    setSearchQuery('');
  }

  return (
    <div className="relative min-h-screen bg-black overflow-hidden">
      {/* Subtle space gradient */}
      <div className="absolute inset-0 bg-gradient-radial from-transparent via-transparent to-blue-950/20" />

      {/* Content */}
      <div className="relative z-10 p-2">
        {/* Header */}
        <div className="flex items-center justify-between px-3 mb-3">
          <Link
            href="/dashboard"
            className="flex items-center gap-2 px-4 py-2 bg-black/40 backdrop-blur-md border border-gray-400/30 rounded-md p-3 transition-all"
          >
            <div className="absolute top-0 left-0 w-2 h-2 border-l border-t border-cyan-400" />
            <div className="absolute top-0 right-0 w-2 h-2 border-r border-t border-cyan-400" />
            <div className="absolute bottom-0 left-0 w-2 h-2 border-l border-b border-cyan-400" />
            <div className="absolute bottom-0 right-0 w-2 h-2 border-r border-b border-cyan-400" />
            <ArrowLeft className="w-4 h-4 text-white" />
            <span className="text-gray-100 text-sm font-medium">
              Back to Dashboard
            </span>
          </Link>
          <div className="relative flex-1 max-w-xl ml-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by name or NORAD ID..."
              className="w-full h-8 pl-9 pr-3 rounded-md bg-secondary border-none text-sm focus:outline-none focus:ring-1 focus:ring-cyan-700"
            />
          </div>

          <Image alt="logo" src="/drakon.png" width={170} height={170} />
        </div>

        {/* Globe Container */}
        <div className="h-[90vh] overflow-hidden ">
          <GlobeContainer
            searchResults={searchResults}
            onClearSearch={handleClearSearch}
          />
        </div>
      </div>

      <style jsx>{`
        @keyframes twinkle {
          0%,
          100% {
            opacity: 0.3;
          }
          50% {
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );
}

export default function GlobePage() {
  return <GlobeContent />;
}
