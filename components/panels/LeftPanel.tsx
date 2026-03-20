import React, { memo } from 'react';
import { Satellite } from 'lucide-react';

type SelectedMeta = {
  id: number;
  name: string;
  lat: number;
  lon: number;
  alt: number;
  vel: number;
  inclination: number;
  orbitType: string;
  tleEpoch?: string;
};

type Props = {
  selected: SelectedMeta | null;
  setSelected: (meta: SelectedMeta | null) => void;
  loading: boolean;
  onClose: () => void;
};

const LeftPanel = memo(function LeftPanel({
  selected,
  loading,
  onClose,
}: Props) {
  if (!selected || loading) return null;

  return (
    <>
      {selected && !loading && (
        <div className="absolute left-3 top-0 w-60 bg-black/40 backdrop-blur-md border border-gray-400/30 p-3 text-sm overflow-y-auto z-10">
          {/* Corner accents */}
          <div className="absolute top-0 left-0 w-2 h-2 border-l border-t border-cyan-400" />
          <div className="absolute top-0 right-0 w-2 h-2 border-r border-t border-cyan-400" />
          <div className="absolute bottom-0 left-0 w-2 h-2 border-l border-b border-cyan-400" />
          <div className="absolute bottom-0 right-0 w-2 h-2 border-r border-b border-cyan-400" />

          <div
            className="font-medium mb-1 truncate text-cyan-300 border-b border-gray-700/60 text-sm uppercase tracking-wider"
            title={selected.name}
          >
            <span className="flex items-center gap-2 mb-2">
              {selected.name} <Satellite size={18} />
            </span>
          </div>
          <div className="grid grid-cols-2 text-xs gap-x-2 gap-y-1.5">
            <span className="text-gray-400">NORAD</span>
            <span className="text-white ">{selected.id}</span>
            <span className="text-gray-400">Lat</span>
            <span className="text-white">{selected.lat.toFixed(2)}°</span>
            <span className="text-gray-400">Lon</span>
            <span className="text-white ">{selected.lon.toFixed(2)}°</span>
            <span className="text-gray-400">Alt</span>
            <span className="text-white">{Math.round(selected.alt)} km</span>
            <span className="text-gray-400">Vel</span>
            <span className="text-white ">{selected.vel.toFixed(2)} km/s</span>
            <span className="text-gray-400">Inclination</span>
            <span className="text-white ">
              {selected.inclination.toFixed(2)}°
            </span>
            <span className="text-gray-400">Orbit</span>
            <span className="text-white">{selected.orbitType}</span>
            {selected.tleEpoch && (
              <>
                <span className="text-gray-400">TLE epoch</span>
                <span className="text-white">{selected.tleEpoch}</span>
              </>
            )}
          </div>
          <button
            onClick={onClose}
            className="mt-2 text-xs text-red-400 hover:text-red-300  underline"
          >
            Close
          </button>
        </div>
      )}
    </>
  );
});

export default LeftPanel;
