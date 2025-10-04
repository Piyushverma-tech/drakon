'use client';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  DeckGL,
  _GlobeView as GlobeView,
  BitmapLayer,
  LayersList,
} from 'deck.gl';
import SunCalc from 'suncalc';

const INITIAL_VIEW_STATE = {
  longitude: 0,
  latitude: 0,
  zoom: 0.8,
  pitch: 0,
  bearing: 0,
};

const DAY_TEXTURE = '/earth_day.jpg';
const NIGHT_TEXTURE = '/earth_night.jpg';

// width/height of generated blended canvas - lower = faster, higher = crisper
const CANVAS_W = 1024;
const CANVAS_H = 512;

/** returns sub-solar longitude in degrees (-180..180) */
function computeSubSolarLongitude(date: Date) {
  // Position of the sun at the equator
  const sunPos = SunCalc.getPosition(date, 0, 0);

  const hourAngle = sunPos.azimuth + Math.PI;

  const lon = (((-hourAngle * 180) / Math.PI + 180) % 360) - 180;

  const lat = (sunPos.altitude * 180) / Math.PI;

  return { lat, lon };
}

/** compute daylight factor for a longitude */
function computeDaylightFactorForLon(
  lon: number,
  subSolarLon: number,
  terminatorWidthDeg = 90
) {
  let diff = Math.abs(lon - subSolarLon);
  if (diff > 180) diff = 360 - diff;
  return Math.max(0, 1 - diff / terminatorWidthDeg);
}

type GlobeProps = {
  layers?: LayersList;
};

export default function Globe({ layers = [] }: GlobeProps) {
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return; //prevent SSR crash

    let cancelled = false;
    const canvasEl = document.createElement('canvas');
    canvasEl.width = CANVAS_W;
    canvasEl.height = CANVAS_H;

    const dayImg = new Image();
    const nightImg = new Image();
    dayImg.src = DAY_TEXTURE;
    nightImg.src = NIGHT_TEXTURE;

    let loaded = 0;
    function tryInit() {
      if (cancelled || loaded < 2) return;

      setCanvas(canvasEl);

      const ctx = canvasEl.getContext('2d')!;
      function drawNow() {
        ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
        ctx.drawImage(dayImg, 0, 0, canvasEl.width, canvasEl.height);

        const now = new Date();
        const { lon: subSolarLon } = computeSubSolarLongitude(now);
        const terminatorWidthDeg = 90;

        const srcW = nightImg.width || canvasEl.width;
        const srcH = nightImg.height || canvasEl.height;

        for (let x = 0; x < canvasEl.width; x++) {
          const lon = -180 + (x / (canvasEl.width - 1)) * 360;
          const daylight = computeDaylightFactorForLon(
            lon,
            subSolarLon,
            terminatorWidthDeg
          );
          const nightAlpha = 1 - daylight;
          if (nightAlpha <= 0) continue;
          ctx.globalAlpha = nightAlpha;
          const sx = Math.floor((x / canvasEl.width) * srcW);
          ctx.drawImage(nightImg, sx, 0, 1, srcH, x, 0, 1, canvasEl.height);
        }
        ctx.globalAlpha = 1;
      }

      drawNow();
      timerRef.current = window.setInterval(drawNow, 30_000);
    }

    dayImg.onload = () => {
      loaded++;
      tryInit();
    };
    nightImg.onload = () => {
      loaded++;
      tryInit();
    };

    return () => {
      cancelled = true;
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const earthLayer = useMemo(
    () =>
      new BitmapLayer({
        id: 'earth-daynight',
        image: canvas ?? DAY_TEXTURE, // fallback until canvas ready
        bounds: [-180, -85.05113, 180, 85.05113],
        opacity: 1,
      }),
    [canvas]
  );

  return (
    <DeckGL
      views={[new GlobeView()]}
      style={{ width: '100%', height: '100%', position: 'relative' }}
      initialViewState={INITIAL_VIEW_STATE as any}
      controller={true}
      layers={[earthLayer, ...(layers || [])]}
    />
  );
}
