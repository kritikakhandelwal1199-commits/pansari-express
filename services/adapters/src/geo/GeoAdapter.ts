/**
 * GeoAdapter — distance, serviceability zones, ETA, (reverse) geocoding.
 * API HOLD MODE: LocalGeoProvider uses Haversine + GeoJSON point-in-polygon and a
 * small local gazetteer. A paid geocoder / routing API can implement this later.
 */
import type { GeoPoint } from '@pansari/shared';

export interface ZoneLike {
  zoneId: string;
  name: string;
  geometryJson: string;
  storeIds: string[];
  isActive: boolean;
}

export interface StoreLike {
  storeId: string;
  name: string;
  location: GeoPoint;
  isActive: boolean;
  acceptsOnline: boolean;
}

export interface ServiceabilityResult {
  serviceable: boolean;
  zone: ZoneLike | null;
  store: StoreLike | null;
  distanceMeters: number | null;
  etaMinutes: number | null;
  reason: 'OK' | 'OUTSIDE_ZONES' | 'NO_STORE_IN_ZONE' | 'TOO_FAR';
}

export interface PlaceGuess {
  label: string;
  city: string;
  pincode: string | null;
  stateCode: string | null;
  approximate: true;
}

export interface TileLayerConfig {
  url: string;
  attribution: string;
  maxZoom: number;
  /** Shown in the UI so the team remembers the provider's fair-use limits. */
  usageNote: string;
}

export interface GeoAdapter {
  readonly provider: string;
  distanceMeters(a: GeoPoint, b: GeoPoint): number;
  findZone(p: GeoPoint, zones: ZoneLike[]): ZoneLike | null;
  checkServiceability(p: GeoPoint, zones: ZoneLike[], stores: StoreLike[], opts?: { maxDistanceMeters?: number }): ServiceabilityResult;
  etaMinutes(distanceMeters: number): number;
  reverseGeocode(p: GeoPoint): Promise<PlaceGuess>;
  geocodePincode(pincode: string): Promise<(PlaceGuess & { center: GeoPoint }) | null>;
  tileLayer(): TileLayerConfig;
  /** Straight-line waypoints for the simulated rider navigation screen. */
  simulateRoute(from: GeoPoint, to: GeoPoint, steps?: number): GeoPoint[];
}
