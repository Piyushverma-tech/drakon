'use client';

import { useEffect, useState } from 'react';
import { LoaderCircle, Satellite } from 'lucide-react';

const LOADING_STEPS = [
  'Setting up globe environment',
  'Loading satellite data',
  'Parsing orbital elements',
  'Computing live positions',
  'Preparing visualization layers',
];

export function SatelliteDataLoading() {
  const [activeStep, setActiveStep] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setActiveStep((current) => (current + 1) % LOADING_STEPS.length);
    }, 2500);

    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="w-full h-full flex items-center justify-center bg-black text-white">
      <div className="w-full max-w-sm px-6 text-center" aria-live="polite">
        <div className="relative mx-auto flex h-20 w-20 items-center justify-center">
          <div className="absolute inset-0 rounded-full border border-cyan-400/20" />
          <div className="absolute inset-2 rounded-full border border-cyan-400/30 animate-ping" />
          <LoaderCircle
            className="absolute h-20 w-20 animate-spin text-cyan-400/70"
            strokeWidth={1.4}
          />
          <Satellite className="h-8 w-8 text-cyan-200" strokeWidth={1.7} />
        </div>

        <div className="mt-6 text-lg font-medium text-gray-200">
          {LOADING_STEPS[activeStep]}
        </div>
      </div>
    </div>
  );
}
