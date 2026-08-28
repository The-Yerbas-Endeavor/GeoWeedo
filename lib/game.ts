export type Coordinates = { latitude: number; longitude: number };

const EARTH_RADIUS_KM = 6371.0088;

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

export function distanceKm(a: Coordinates, b: Coordinates) {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

export function scoreFromDistance(distance: number, maxScore = 5000) {
  return Math.max(0, Math.round(maxScore * Math.exp(-distance / 500)));
}

export function dailySeed(date = new Date()) {
  return date.toISOString().slice(0, 10);
}
