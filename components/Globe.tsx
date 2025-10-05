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

const CANVAS_W = 1024;
const CANVAS_H = 512;

function computeSubSolarLongitude(date: Date) {
  const sunPos = SunCalc.getPosition(date, 0, 0);
  const hourAngle = -sunPos.azimuth;
  const lon = (((hourAngle * 180) / Math.PI + 180) % 360) - 180;
  const lat = (sunPos.altitude * 180) / Math.PI;
  return { lat, lon };
}

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
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [ready, setReady] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const canvasEl = document.createElement('canvas');
    canvasEl.width = CANVAS_W;
    canvasEl.height = CANVAS_H;
    canvasRef.current = canvasEl;

    const ctx = canvasEl.getContext('2d')!;
    const dayImg = new Image();
    const nightImg = new Image();

    let loaded = 0;
    const tryInit = () => {
      if (loaded < 2) return;
      setReady(true); // render DeckGL only once canvas ready

      const drawNow = () => {
        ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
        ctx.drawImage(dayImg, 0, 0, CANVAS_W, CANVAS_H);

        const { lon: subSolarLon } = computeSubSolarLongitude(new Date());
        const srcW = nightImg.width || CANVAS_W;
        const srcH = nightImg.height || CANVAS_H;

        for (let x = 0; x < CANVAS_W; x++) {
          const lon = -180 + (x / (CANVAS_W - 1)) * 360;
          const daylight = computeDaylightFactorForLon(lon, subSolarLon, 90);
          const nightAlpha = 1 - daylight;
          if (nightAlpha <= 0) continue;
          ctx.globalAlpha = nightAlpha;
          const sx = Math.floor((x / CANVAS_W) * srcW);
          ctx.drawImage(nightImg, sx, 0, 1, srcH, x, 0, 1, CANVAS_H);
        }
        ctx.globalAlpha = 1;
      };

      drawNow();
      timerRef.current = window.setInterval(drawNow, 30_000);
    };

    dayImg.onload = () => {
      loaded++;
      tryInit();
    };
    nightImg.onload = () => {
      loaded++;
      tryInit();
    };
    dayImg.src = DAY_TEXTURE;
    nightImg.src = NIGHT_TEXTURE;

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const earthLayer = useMemo(
    () =>
      ready
        ? new BitmapLayer({
            id: 'earth-daynight',
            image: canvasRef.current!,
            bounds: [-180, -85.05113, 180, 85.05113],
            opacity: 1,
            updateTriggers: { image: ready },
          })
        : null,
    [ready]
  );

  return (
    ready && (
      <DeckGL
        views={[new GlobeView()]}
        style={{ width: '100%', height: '100%', position: 'relative' }}
        initialViewState={INITIAL_VIEW_STATE as any}
        controller={true}
        layers={[earthLayer!, ...(layers || [])]}
      />
    )
  );
}
