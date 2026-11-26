'use client';
/**
 * Real map (Leaflet + OpenStreetMap tiles, no API key). Loaded only in the browser — the site is a
 * static export — and drawn with CSS pins, so no marker images are needed.
 * OSM's public tiles are fine for a small business; for heavy traffic switch `TILE_URL` to a paid
 * tile service (MapTiler, Stadia, Google) without touching the rest.
 */
import * as React from 'react';
import type * as Leaflet from 'leaflet';

export const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

export type PinKind = 'store' | 'rider' | 'home' | 'order' | 'check';
export interface MapPin {
  id: string;
  lat: number;
  lng: number;
  kind: PinKind;
  label: string;
}
export interface MapZone {
  id: string;
  name: string;
  geometryJson: string;
  active: boolean;
  highlight?: boolean;
}
export interface MapLine {
  id: string;
  from: { lat: number; lng: number };
  to: { lat: number; lng: number };
}

const GLYPH: Record<PinKind, string> = { store: '🏪', rider: '🛵', home: '🏠', order: '📦', check: '📍' };

export function LiveMap({
  pins = [],
  zones = [],
  lines = [],
  height = 240,
  label,
  onPick,
  className,
  fit = 'all',
}: {
  pins?: MapPin[];
  zones?: MapZone[];
  lines?: MapLine[];
  height?: number;
  /** Screen-reader description of what the map shows. */
  label: string;
  /** Click on the map → lat/lng (e.g. "check this address"). */
  onPick?: (p: { lat: number; lng: number }) => void;
  className?: string;
  /** 'pins' = zoom to the pins only (zones still drawn); 'all' = pins and zones. */
  fit?: 'all' | 'pins';
}) {
  const box = React.useRef<HTMLDivElement>(null);
  const map = React.useRef<Leaflet.Map | null>(null);
  const layer = React.useRef<Leaflet.LayerGroup | null>(null);
  const lib = React.useRef<typeof Leaflet | null>(null);
  const lastFit = React.useRef('');
  const pickRef = React.useRef(onPick);
  pickRef.current = onPick;
  const [ready, setReady] = React.useState(false);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    import('leaflet')
      .then((mod) => {
        if (cancelled || !box.current || map.current) return;
        const L = ((mod as unknown as { default?: typeof Leaflet }).default ?? mod) as typeof Leaflet;
        lib.current = L;
        const m = L.map(box.current, { zoomControl: true, attributionControl: true, scrollWheelZoom: false }).setView([26.9124, 75.7873], 11);
        L.tileLayer(TILE_URL, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(m);
        layer.current = L.layerGroup().addTo(m);
        m.on('click', (e: Leaflet.LeafletMouseEvent) => pickRef.current?.({ lat: e.latlng.lat, lng: e.latlng.lng }));
        map.current = m;
        setReady(true);
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
  }, []);

  React.useEffect(() => {
    const L = lib.current;
    const m = map.current;
    const g = layer.current;
    if (!ready || !L || !m || !g) return;
    g.clearLayers();
    const bounds: Leaflet.LatLngExpression[] = [];
    const zoneFit = fit === 'all' || pins.length === 0;
    for (const z of zones) {
      try {
        const gj = L.geoJSON(JSON.parse(z.geometryJson), {
          style: { color: z.highlight ? '#b3261e' : z.active ? '#2f6b3a' : '#8a8a8a', weight: z.highlight ? 3 : 2, fillOpacity: z.active ? 0.08 : 0.03, dashArray: z.active ? undefined : '6 6' },
        }).bindTooltip(z.name + (z.active ? '' : ' (off)'), { sticky: true });
        gj.addTo(g);
        const b = gj.getBounds();
        if (b.isValid() && zoneFit) bounds.push(b.getSouthWest(), b.getNorthEast());
      } catch {
        /* bad geometry is reported by the zone editor */
      }
    }
    for (const l of lines) {
      L.polyline([[l.from.lat, l.from.lng], [l.to.lat, l.to.lng]], { color: '#b3261e', weight: 3, dashArray: '6 8', opacity: 0.8 }).addTo(g);
    }
    for (const p of pins) {
      const icon = L.divIcon({ className: 'px-pin-wrap', html: `<div class="px-pin px-pin-${p.kind}" aria-hidden="true">${GLYPH[p.kind]}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] });
      L.marker([p.lat, p.lng], { icon, title: p.label, keyboard: true, zIndexOffset: p.kind === 'rider' ? 1000 : 0 }).bindTooltip(p.label).addTo(g);
      bounds.push([p.lat, p.lng]);
    }
    const key = JSON.stringify([pins.map((p) => p.id), zones.map((z) => z.id)]);
    if (bounds.length && key !== lastFit.current) {
      lastFit.current = key;
      if (bounds.length === 1) m.setView(bounds[0] as Leaflet.LatLngExpression, 14);
      else m.fitBounds(L.latLngBounds(bounds as Leaflet.LatLngTuple[]), { paddingTopLeft: [32, 32], paddingBottomRight: [32, 48], maxZoom: 15 });
    }
  }, [ready, pins, zones, lines, fit]);

  return (
    <div className={className}>
      <div ref={box} role="img" aria-label={label} className="relative z-0 w-full overflow-hidden rounded-xl border border-line bg-surface-2" style={{ height }} />
      {failed ? <p className="mt-1 text-[13px] text-muted">The map could not load. Check the internet connection.</p> : null}
    </div>
  );
}
