'use client';

import { Info } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type Props = {
  text: string;
  label?: string;
};

export default function DisclaimerTooltip({
  text,
  label = 'Disclaimer',
}: Props) {
  const iconRef = useRef<HTMLSpanElement | null>(null);
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);
  const [tooltip, setTooltip] = useState<{
    visible: boolean;
    x: number;
    y: number;
  }>({ visible: false, x: 0, y: 0 });

  useEffect(() => {
    setPortalRoot(document.body);
  }, []);

  function showTooltip() {
    const el = iconRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    setTooltip({
      visible: true,
      x: rect.left + rect.width / 2,
      y: rect.bottom + 8,
    });
  }

  function hideTooltip() {
    setTooltip((current) => ({ ...current, visible: false }));
  }

  const tooltipEl =
    tooltip.visible && portalRoot
      ? createPortal(
          <div
            className="pointer-events-none fixed z-[9999] w-56 -translate-x-1/2 bg-white/5 border text-white text-[10px] rounded-md shadow-2xl p-2 backdrop-blur-md"
            style={{
              left: Math.min(Math.max(tooltip.x, 120), window.innerWidth - 120),
              top: tooltip.y,
            }}
            role="tooltip"
          >
            <span className="block font-medium uppercase tracking-wider text-cyan-300">
              {label}
            </span>
            {text}
          </div>,
          portalRoot
        )
      : null;

  return (
    <>
      <span
        ref={iconRef}
        className="inline-flex shrink-0 cursor-help"
        onMouseEnter={showTooltip}
        onMouseLeave={hideTooltip}
        onFocus={showTooltip}
        onBlur={hideTooltip}
        tabIndex={0}
      >
        <Info
          className="h-3.5 w-3.5 text-gray-400 transition-colors hover:text-cyan-300"
          aria-label={label}
        />
      </span>
      {tooltipEl}
    </>
  );
}
