import { estimateEtaMinutes, haversineMeters, isValidPincode, parseZoneGeometry, pointInGeometry, type GeoPoint, type ZoneGeometry } from '@pansari/shared';
import type { GeoAdapter, PlaceGuess, ServiceabilityResult, StoreLike, TileLayerConfig, ZoneLike } from './GeoAdapter.js';

interface GazetteerEntry {
  pincode: string;
  area: string;
  city: string;
  stateCode: string;
  center: GeoPoint;
}

/**
 * Approximate area centroids for development and demos only — not survey-grade.
 * Extend with your own delivery areas, or swap the provider for a real geocoder.
 */
export const DEFAULT_GAZETTEER: GazetteerEntry[] = [
  { pincode: '302001', area: 'MI Road / GPO', city: 'Jaipur', stateCode: '08', center: { lat: 26.9157, lng: 75.8069 } },
  { pincode: '302002', area: 'Chandpol', city: 'Jaipur', stateCode: '08', center: { lat: 26.9262, lng: 75.8090 } },
  { pincode: '302003', area: 'Johari Bazaar', city: 'Jaipur', stateCode: '08', center: { lat: 26.9196, lng: 75.8267 } },
  { pincode: '302004', area: 'Raja Park / Adarsh Nagar', city: 'Jaipur', stateCode: '08', center: { lat: 26.8984, lng: 75.8296 } },
  { pincode: '302015', area: 'Tonk Road / Gandhi Nagar', city: 'Jaipur', stateCode: '08', center: { lat: 26.8871, lng: 75.8052 } },
  { pincode: '302017', area: 'Malviya Nagar', city: 'Jaipur', stateCode: '08', center: { lat: 26.8549, lng: 75.8243 } },
  { pincode: '302020', area: 'Mansarovar', city: 'Jaipur', stateCode: '08', center: { lat: 26.8560, lng: 75.7620 } },
  { pincode: '302021', area: 'Vaishali Nagar', city: 'Jaipur', stateCode: '08', center: { lat: 26.9115, lng: 75.7398 } },
  { pincode: '302029', area: 'Sanganer', city: 'Jaipur', stateCode: '08', center: { lat: 26.8200, lng: 75.7880 } },
];

export interface LocalGeoConfig {
  gazetteer: GazetteerEntry[];
  /** Max straight-line distance from store to customer (metres). */
  maxDistanceMeters: number;
  prepMinutes: number;
  avgKmph: number;
  tileUrl: string;
}

const DEFAULTS: LocalGeoConfig = {
  gazetteer: DEFAULT_GAZETTEER,
  maxDistanceMeters: 5000,
  prepMinutes: 4,
  avgKmph: 18,
  tileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
};

export class LocalGeoProvider implements GeoAdapter {
  readonly provider = 'local';
  private cfg: LocalGeoConfig;
  private parsed = new Map<string, ZoneGeometry>();

  constructor(cfg: Partial<LocalGeoConfig> = {}) {
    this.cfg = { ...DEFAULTS, ...cfg };
  }

  private geometry(z: ZoneLike): ZoneGeometry {
    const key = `${z.zoneId}:${z.geometryJson.length}:${z.geometryJson.slice(0, 64)}`;
    let g = this.parsed.get(key);
    if (!g) {
      g = parseZoneGeometry(z.geometryJson);
      this.parsed.set(key, g);
    }
    return g;
  }

  distanceMeters(a: GeoPoint, b: GeoPoint) {
    return haversineMeters(a, b);
  }

  findZone(p: GeoPoint, zones: ZoneLike[]) {
    return zones.find((z) => z.isActive && pointInGeometry(p, this.geometry(z))) ?? null;
  }

  etaMinutes(distanceMeters: number) {
    return estimateEtaMinutes(distanceMeters, { prepMinutes: this.cfg.prepMinutes, avgKmph: this.cfg.avgKmph });
  }

  checkServiceability(p: GeoPoint, zones: ZoneLike[], stores: StoreLike[], opts: { maxDistanceMeters?: number } = {}): ServiceabilityResult {
    const zone = this.findZone(p, zones);
    if (!zone) return { serviceable: false, zone: null, store: null, distanceMeters: null, etaMinutes: null, reason: 'OUTSIDE_ZONES' };
    const candidates = stores
      .filter((s) => s.isActive && s.acceptsOnline && zone.storeIds.includes(s.storeId))
      .map((s) => ({ s, d: haversineMeters(p, s.location) }))
      .sort((a, b) => a.d - b.d);
    const best = candidates[0];
    if (!best) return { serviceable: false, zone, store: null, distanceMeters: null, etaMinutes: null, reason: 'NO_STORE_IN_ZONE' };
    const max = opts.maxDistanceMeters ?? this.cfg.maxDistanceMeters;
    if (best.d > max) return { serviceable: false, zone, store: best.s, distanceMeters: best.d, etaMinutes: this.etaMinutes(best.d), reason: 'TOO_FAR' };
    return { serviceable: true, zone, store: best.s, distanceMeters: best.d, etaMinutes: this.etaMinutes(best.d), reason: 'OK' };
  }

  async reverseGeocode(p: GeoPoint): Promise<PlaceGuess> {
    let best: GazetteerEntry | null = null;
    let bestD = Infinity;
    for (const g of this.cfg.gazetteer) {
      const d = haversineMeters(p, g.center);
      if (d < bestD) {
        bestD = d;
        best = g;
      }
    }
    if (!best || bestD > 15_000) return { label: `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`, city: 'Unknown', pincode: null, stateCode: null, approximate: true };
    return { label: `Near ${best.area}, ${best.city}`, city: best.city, pincode: best.pincode, stateCode: best.stateCode, approximate: true };
  }

  async geocodePincode(pincode: string) {
    if (!isValidPincode(pincode)) return null;
    const g = this.cfg.gazetteer.find((x) => x.pincode === pincode);
    if (!g) return null;
    return { label: `${g.area}, ${g.city}`, city: g.city, pincode: g.pincode, stateCode: g.stateCode, approximate: true as const, center: g.center };
  }

  tileLayer(): TileLayerConfig {
    return {
      url: this.cfg.tileUrl,
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
      usageNote: 'The public OpenStreetMap tile server is for light use only (see the OSMF tile usage policy). Move to a self-hosted or commercial tile source before heavy production traffic.',
    };
  }

  simulateRoute(from: GeoPoint, to: GeoPoint, steps = 20): GeoPoint[] {
    const n = Math.max(2, Math.min(500, Math.floor(steps)));
    return Array.from({ length: n }, (_, i) => {
      const t = i / (n - 1);
      return { lat: from.lat + (to.lat - from.lat) * t, lng: from.lng + (to.lng - from.lng) * t };
    });
  }
}
