'use client';

import { X } from 'lucide-react';
import { TleEntry } from '@/lib/types';
import { colorForId } from '@/lib/satellite-colors';
import { SelectedTagMeta } from '../globe-model';

type Props = {
  selectedIds: number[];
  focusedId: number | null;
  tagsById: Record<number, SelectedTagMeta>;
  selectionLimitReached: boolean;
  entryById: Map<number, TleEntry>;
  onFocusSatellite: (satellite: TleEntry) => void;
  onRemoveSatellite: (satId: number) => void;
};

export function SelectedSatelliteTags({
  selectedIds,
  focusedId,
  tagsById,
  selectionLimitReached,
  entryById,
  onFocusSatellite,
  onRemoveSatellite,
}: Props) {
  return (
    <div className="absolute top-2 left-1/2 transform -translate-x-1/2 flex flex-col items-center gap-2">
      {selectedIds.length > 0 && (
        <div className="flex flex-wrap justify-center gap-1.5 px-2">
          {selectedIds.map((satId) => {
            const tag = tagsById[satId];
            if (!tag) return null;

            const color = colorForId(satId, selectedIds);
            const selectedEntry = entryById.get(satId);
            const isFocused = satId === focusedId;

            return (
              <div
                key={satId}
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-medium backdrop-blur-md transition-all duration-150 ${
                  isFocused
                    ? 'bg-cyan-500/20 border border-cyan-400/50 text-cyan-100'
                    : 'bg-black/10 border border-white/20 text-gray-200 hover:bg-white/10'
                }`}
              >
                {color && (
                  <span
                    className="h-1.5 w-1.5 rounded-full border border-white/40 shrink-0"
                    style={{
                      backgroundColor: `rgb(${color[0]}, ${color[1]}, ${color[2]})`,
                    }}
                  />
                )}
                <button
                  type="button"
                  onClick={() => selectedEntry && onFocusSatellite(selectedEntry)}
                  className="cursor-pointer hover:brightness-110 truncate max-w-[80px]"
                  title={tag.name}
                >
                  {tag.name}
                </button>
                <button
                  type="button"
                  onClick={() => onRemoveSatellite(satId)}
                  title="Remove satellite"
                  className="text-gray-400 hover:text-red-400 transition-colors duration-150 cursor-pointer ml-0.5"
                >
                  <X size={12} />
                </button>
              </div>
            );
          })}
        </div>
      )}
      {selectionLimitReached && (
        <div className="text-[10px] text-amber-300 border border-amber-500/50 bg-amber-500/15 px-2.5 py-1 rounded-full font-medium">
          Selection limit reached (max 6).
        </div>
      )}
    </div>
  );
}
