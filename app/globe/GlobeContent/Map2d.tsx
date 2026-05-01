'use client';
import React, {
  forwardRef,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import DeckGL, { type DeckGLRef } from '@deck.gl/react';
import { MapView, FlyToInterpolator } from '@deck.gl/core';
import { TileLayer } from '@deck.gl/geo-layers';
import { BitmapLayer } from '@deck.gl/layers';
import type { LayersList } from '@deck.gl/core';
import { GlobeHandle } from './Globe3D';

// Constants -----------------------------------------------------------------

const INITIAL_VIEW_STATE = {
  longitude: 0,
  latitude: 20,
  zoom: 1.5,
  pitch: 0,
  bearing: 0,
  minZoom: 0.5,
  maxZoom: 18,
};

// Carto Dark Matter
const TILE_URL =
  'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';

// Subdomains for Carto CDN load balancing
const TILE_SUBDOMAINS = ['a', 'b', 'c', 'd'];

// Types ---------------------------------------------------------------------------

type ViewState = {
  longitude: number;
  latitude: number;
  zoom: number;
  pitch?: number;
  bearing?: number;
  minZoom?: number;
  maxZoom?: number;
  transitionDuration?: number;
  transitionInterpolator?: FlyToInterpolator;
};

type Map2DProps = {
  layers?: LayersList;
};

// Tile URL builder with subdomain rotation -------------------------------------

function buildTileUrl(
  template: string,
  x: number,
  y: number,
  z: number
): string {
  const s = TILE_SUBDOMAINS[(x + y) % TILE_SUBDOMAINS.length];
  // HiDPI suffix — use '@2x' on retina displays
  const r =
    typeof window !== 'undefined' && window.devicePixelRatio > 1 ? '@2x' : '';
  return template
    .replace('{s}', s)
    .replace('{x}', String(x))
    .replace('{y}', String(y))
    .replace('{z}', String(z))
    .replace('{r}', r);
}

// Component ----------------------------------------------------------------------

const Map2D = forwardRef<GlobeHandle, Map2DProps>(({ layers = [] }, ref) => {
  const deckRef = useRef<DeckGLRef<MapView>>(null);
  const [viewState, setViewState] = useState<ViewState>(INITIAL_VIEW_STATE);

  useImperativeHandle(ref, () => ({
    flyTo({ longitude, latitude, zoom, durationMs = 1000, bearing }) {
      setViewState((prev) => ({
        ...prev,
        longitude,
        latitude,
        zoom:
          typeof zoom === 'number'
            ? // limit zoom to 6 to avoid excessive zooming on 2D map
              Math.min(zoom, 6)
            : Math.min((prev.zoom ?? INITIAL_VIEW_STATE.zoom) + 1, 6),
        bearing: typeof bearing === 'number' ? bearing : prev.bearing,
        pitch: 0,
        transitionDuration: durationMs,
        transitionInterpolator: new FlyToInterpolator({ speed: 1.4 }),
      }));
    },
    getDeck: () => deckRef.current?.deck ?? null,
  }));

  // Basemap tile layer
  const basemapLayer = useMemo(
    () =>
      new TileLayer({
        id: 'basemap-2d',
        getTileData: ({ index }) => {
          const { x, y, z } = index;
          const url = buildTileUrl(TILE_URL, x, y, z);
          return new Promise<HTMLImageElement>((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = url;
          });
        },
        tileSize: 256,
        maxZoom: 19,
        minZoom: 0,
        // Render each tile as a BitmapLayer
        renderSubLayers: (props) => {
          const tile = props.tile as {
            bbox: { west: number; south: number; east: number; north: number };
          };
          const { west, south, east, north } = tile.bbox;
          if (!props.data) return null;
          return new BitmapLayer({
            ...props,
            data: undefined,
            image: props.data as HTMLImageElement,
            bounds: [west, south, east, north] as [
              number,
              number,
              number,
              number,
            ],
          });
        },
      }),
    [] // basemap never needs to re-create
  );

  // Compose: basemap first, then all satellite layers on top
  const allLayers: LayersList = useMemo(
    () => [basemapLayer, ...(layers ?? [])],
    [basemapLayer, layers]
  );

  return (
    <div className="relative w-full h-full">
      <DeckGL
        ref={deckRef}
        views={new MapView({ repeat: true })}
        viewState={viewState}
        onViewStateChange={({ viewState: vs }) => setViewState(vs as ViewState)}
        controller={{
          dragPan: true,
          dragRotate: false,
          scrollZoom: true,
          doubleClickZoom: true,
          touchZoom: true,
          touchRotate: false,
          keyboard: true,
        }}
        style={{
          width: '100%',
          height: '100%',
          position: 'relative',
          background: 'rgb(18,18,26)', // fallback while tiles load
        }}
        layers={allLayers}
      />

      {/* Subtle grid-line overlay for the space-ops aesthetic */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: `
            linear-gradient(rgba(34,211,238,0.03) 1px, transparent 1px),
            linear-gradient(90deg, rgba(34,211,238,0.03) 1px, transparent 1px)
          `,
          backgroundSize: '60px 60px',
          zIndex: 1,
        }}
      />
    </div>
  );
});

Map2D.displayName = 'Map2D';
export default Map2D;
