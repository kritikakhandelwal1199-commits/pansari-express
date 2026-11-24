/**
 * Free, local geo math — no paid map APIs.
 * Coordinates: GeoJSON order is [lng, lat]; GeoPoint objects are { lat, lng }.
 */
import type { GeoPoint } from '../schema.js';

const EARTH_RADIUS_M = 6_371_008.8;
const toRad = (d: number) => (d * Math.PI) / 180;

export function assertGeoPoint(p: GeoPoint): void {
  if (!(Number.isFinite(p.lat) && Number.isFinite(p.lng) && p.lat >= -90 && p.lat <= 90 && p.lng >= -180 && p.lng <= 180)) {
    throw new RangeError(`Invalid coordinate ${JSON.stringify(p)}`);
  }
}

/** Great-circle distance in metres. */
export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  assertGeoPoint(a);
  assertGeoPoint(b);
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type Position = [number, number]; // [lng, lat]
export type LinearRing = Position[];
export interface PolygonGeometry {
  type: 'Polygon';
  coordinates: LinearRing[]; // [outer, ...holes]
}
export interface MultiPolygonGeometry {
  type: 'MultiPolygon';
  coordinates: LinearRing[][];
}
export type ZoneGeometry = PolygonGeometry | MultiPolygonGeometry;

/** Ray casting. Points exactly on an edge count as inside. */
function inRing(pt: Position, ring: LinearRing): boolean {
  const [x, y] = pt;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    // on-segment check
    const cross = (x - xi) * (yj - yi) - (y - yi) * (xj - xi);
    if (Math.abs(cross) < 1e-12 && x >= Math.min(xi, xj) - 1e-12 && x <= Math.max(xi, xj) + 1e-12 && y >= Math.min(yi, yj) - 1e-12 && y <= Math.max(yi, yj) + 1e-12) {
      return true;
    }
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function inPolygon(pt: Position, rings: LinearRing[]): boolean {
  const [outer, ...holes] = rings;
  if (!outer || outer.length < 4) return false;
  if (!inRing(pt, outer)) return false;
  return !holes.some((h) => h.length >= 4 && inRing(pt, h) && !onRingEdge(pt, h));
}

function onRingEdge(pt: Position, ring: LinearRing): boolean {
  const [x, y] = pt;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    const cross = (x - xi) * (yj - yi) - (y - yi) * (xj - xi);
    if (Math.abs(cross) < 1e-12 && x >= Math.min(xi, xj) && x <= Math.max(xi, xj) && y >= Math.min(yi, yj) && y <= Math.max(yi, yj)) return true;
  }
  return false;
}

export function pointInGeometry(p: GeoPoint, g: ZoneGeometry): boolean {
  assertGeoPoint(p);
  const pt: Position = [p.lng, p.lat];
  if (g.type === 'Polygon') return inPolygon(pt, g.coordinates);
  return g.coordinates.some((poly) => inPolygon(pt, poly));
}

export function parseZoneGeometry(json: string): ZoneGeometry {
  const g = JSON.parse(json) as ZoneGeometry;
  if (g?.type !== 'Polygon' && g?.type !== 'MultiPolygon') throw new TypeError('Zone geometry must be a GeoJSON Polygon or MultiPolygon');
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  for (const poly of polys) {
    for (const ring of poly) {
      if (!Array.isArray(ring) || ring.length < 4) throw new TypeError('Each ring needs at least 4 positions (closed)');
      const a = ring[0]!;
      const b = ring[ring.length - 1]!;
      if (a[0] !== b[0] || a[1] !== b[1]) throw new TypeError('Rings must be closed (first position = last position)');
      ring.forEach(([lng, lat]) => assertGeoPoint({ lat, lng }));
    }
  }
  return g;
}

/** Bounding-box helper for map fitting. */
export function geometryBounds(g: ZoneGeometry): { south: number; west: number; north: number; east: number } {
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  let south = 90, north = -90, west = 180, east = -180;
  for (const poly of polys) for (const ring of poly) for (const [lng, lat] of ring) {
    south = Math.min(south, lat); north = Math.max(north, lat);
    west = Math.min(west, lng); east = Math.max(east, lng);
  }
  return { south, west, north, east };
}

/**
 * Rough delivery ETA: store prep time + travel at an average urban two-wheeler
 * speed, with a road-network factor over straight-line distance.
 */
export function estimateEtaMinutes(distanceMeters: number, opts: { prepMinutes?: number; avgKmph?: number; roadFactor?: number } = {}): number {
  const prep = opts.prepMinutes ?? 4;
  const kmph = opts.avgKmph ?? 18;
  const factor = opts.roadFactor ?? 1.35;
  const travel = ((distanceMeters * factor) / 1000 / kmph) * 60;
  return Math.max(1, Math.ceil(prep + travel));
}
