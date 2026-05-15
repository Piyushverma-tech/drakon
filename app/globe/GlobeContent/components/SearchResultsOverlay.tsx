'use client';

import { X } from 'lucide-react';
import { TleEntry } from '@/lib/types';

type SearchResultsOverlayProps = {
  searchResults: TleEntry[];
  selectedId?: number;
  onClearSearch?: () => void;
  onFocusSatellite: (satellite: TleEntry) => void;
};

export function SearchResultsOverlay({
  searchResults,
  selectedId,
  onClearSearch,
  onFocusSatellite,
}: SearchResultsOverlayProps) {
  if (!searchResults.length) return null;

  return (
    <div className="absolute top-0 left-1/2 transform -translate-x-1/2 z-20">
      {/* Corner accents */}
      <div className="absolute top-0 left-0 w-2 h-2 border-l border-t border-cyan-400" />
      <div className="absolute top-0 right-0 w-2 h-2 border-r border-t border-cyan-400" />
      <div className="absolute bottom-0 left-0 w-2 h-2 border-l border-b border-cyan-400" />
      <div className="absolute bottom-0 right-0 w-2 h-2 border-r border-b border-cyan-400" />
      <div className="w-[400px] h-64 bg-black/70 backdrop-blur-md border border-gray-700/30 rounded-lg shadow-2xl relative">
        <div className="sticky top-0 bg-black/80 backdrop-blur-sm border-b border-gray-700/30 p-2 text-center">
          <span className="text-cyan-400 text-sm font-medium uppercase tracking-wider">
            Search Results ({searchResults.length})
          </span>
          <X
            className="absolute top-2 right-2 cursor-pointer text-gray-400 hover:text-white transition-colors"
            size={18}
            onClick={onClearSearch}
          />
        </div>
        <ul className="overflow-auto h-[calc(100%-3rem)]">
          {searchResults.map((sat) => {
            const isSelected = selectedId === sat.id;

            return (
              <li
                key={sat.id}
                onClick={() => onFocusSatellite(sat)}
                className={`p-3 hover:bg-cyan-500/20 cursor-pointer transition-all duration-200 border-b border-gray-700/30 last:border-b-0 ${
                  isSelected
                    ? 'bg-cyan-500/30 border-cyan-400/50'
                    : 'hover:border-cyan-400/30'
                }`}
              >
                <div className="flex justify-between items-center">
                  <span
                    className={`text-sm truncate ${
                      isSelected ? 'text-cyan-300 font-medium' : 'text-white'
                    }`}
                  >
                    {sat.name}
                  </span>
                  <span
                    className={`text-xs ${
                      isSelected ? 'text-cyan-400' : 'text-gray-400'
                    }`}
                  >
                    #{sat.id}
                  </span>
                </div>
                {isSelected && (
                  <div className="text-xs text-cyan-400 mt-1">Selected</div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
