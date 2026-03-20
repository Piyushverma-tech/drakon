// DensityLegendWithTooltip.tsx
'use client';
import React, { useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';

function getCategoryForT(t: number) {
  if (t < 0.1667) {
    return {
      category: 'Very Low',
      description: 'Blue — Cool / safe region with minimal collision density.',
      color: 'rgb(80,160,255)',
    };
  } else if (t < 0.3333) {
    return {
      category: 'Low',
      description: 'Cyan — Slight activity; monitoring recommended.',
      color: 'rgb(120,210,255)',
    };
  } else if (t < 0.6) {
    return {
      category: 'Medium',
      description:
        'Green — Increasing traffic; stay alert for potential close approaches.',
      color: 'rgb(60,200,140)',
    };
  } else if (t < 0.85) {
    return {
      category: 'Medium-High',
      description: 'Yellow — Hot zone emerging; consider further analysis.',
      color: 'rgb(255,255,120)',
    };
  } else {
    return {
      category: 'High',
      description:
        'Orange → Red — Collision-prone region; immediate attention advised.',
      color: 'rgb(255,50,50)',
    };
  }
}

export default function DensityLegend() {
  const barRef = useRef<HTMLDivElement | null>(null);
  const [tooltip, setTooltip] = useState<{
    visible: boolean;
    x: number;
    y: number;
    category: string;
    description: string;
    color: string;
  }>({ visible: false, x: 0, y: 0, category: '', description: '', color: '' });

  // create portal container (once)
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setPortalRoot(document.body);
  }, []);

  function handleMove(e: React.MouseEvent) {
    const el = barRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const xInside = e.clientX - rect.left;
    const t = Math.min(Math.max(xInside / rect.width, 0), 1);
    const meta = getCategoryForT(t);

    // place tooltip slightly above mouse (avoid clipping the bar)
    const offsetY = 12;
    setTooltip({
      visible: true,
      x: e.clientX, // screen x coordinate
      y: rect.top - offsetY,
      category: meta.category,
      description: meta.description,
      color: meta.color,
    });
  }

  function handleLeave() {
    setTooltip((s) => ({ ...s, visible: false }));
  }

  // tooltip element (rendered into portalRoot)
  const tooltipEl =
    tooltip.visible && portalRoot
      ? createPortal(
          <div
            // pointer-events none so it doesn't steal hover events from gradient bar
            className="pointer-events-none fixed z-[9999] transform -translate-x-1/2 -translate-y-full"
            style={{ left: tooltip.x, top: tooltip.y, minWidth: 220 }}
            aria-hidden={!tooltip.visible}
          >
            <div className="bg-white/6 borde text-white text-xs rounded-md shadow-2xl p-2 backdrop-blur-md">
              <div className="flex items-center gap-2">
                <div
                  className="w-3 h-3 rounded-sm border"
                  style={{ backgroundColor: tooltip.color }}
                />
                <div className="font-medium text-[12px]">
                  {tooltip.category}
                </div>
              </div>
              <div className="text-[11px] text-gray-200 mt-1">
                {tooltip.description}
              </div>
            </div>
          </div>,
          portalRoot
        )
      : null;

  return (
    <div className="my-3 pt-2 border-t border-gray-700/40 relative">
      <div className="text-[10px] text-gray-400 mb-2 uppercase tracking-wider">
        Density Colors
      </div>

      <div className="flex items-center gap-2 mb-1.5">
        <div className="flex items-center gap-1.5">
          <div
            className="w-4 h-4 rounded-full border border-gray-600/60 shadow-sm"
            style={{ backgroundColor: 'rgb(80,160,255)' }}
          />
          <span className="text-[10px] text-gray-300 font-medium">Low</span>
        </div>

        <div
          ref={barRef}
          onMouseMove={handleMove}
          onMouseLeave={handleLeave}
          className="flex-1 h-3 rounded-full overflow-hidden border border-gray-700/40 cursor-crosshair"
          style={{
            background:
              'linear-gradient(to right, rgb(80,160,255), rgb(120,210,255), rgb(60,200,140), rgb(255,255,120), rgb(255,140,60), rgb(255,50,50))',
          }}
          aria-label="Collision density gradient"
          role="img"
        />

        <div className="flex items-center gap-1.5">
          <div
            className="w-4 h-4 rounded-full border border-gray-600/60 shadow-sm"
            style={{ backgroundColor: 'rgb(255,50,50)' }}
          />
          <span className="text-[10px] text-gray-300 font-medium">High</span>
        </div>
      </div>

      <div className="text-[9.5px] text-gray-400">
        Satellites in denser regions are colored from cool to warm based on
        collision risk
      </div>

      {tooltipEl}
    </div>
  );
}
