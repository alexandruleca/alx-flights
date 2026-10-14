import type { AirportInfo, PositionRecord } from './types';

/** Aircraft further than this from the airport are not ours: their positions are ignored. */
export const RANGE_M = 15_000;

const EARTH_RADIUS_M = 6_371_000;

type Point = Pick<PositionRecord, 'lat' | 'lon'>;

/** Within 15 km of the airport point the hello announced. Where it is not known yet, nothing is. */
export function inRange(position: Point, airport: Pick<AirportInfo, 'lat' | 'lon'> | null): boolean {
  return airport !== null && distanceM(position, airport) <= RANGE_M;
}

/** Great-circle distance (haversine). */
function distanceM(a: Point, b: Point): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}
