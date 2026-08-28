export type Dispensary = {
  id: string;
  name: string;
  slug: string;
  latitude: number;
  longitude: number;
  streetAddress?: string;
  city: string;
  region: string;
  country: string;
  website?: string;
  photoUrl?: string;
  panoramaId?: string;
  heading?: number;
  imageryProvider?: 'kartaview' | 'geoweedo';
  imageryPhotoId?: string;
  imagerySequenceId?: string;
  imageryLatitude?: number;
  imageryLongitude?: number;
  imageryHeading?: number;
  imageryFieldOfView?: number;
  imageryProjection?: string;
  imageryUrl?: string;
  recreational: boolean;
  medical: boolean;
  verified: boolean;
  active: boolean;
};

export const dispensaries: Dispensary[] = [
  {
    id: 'demo-portland',
    name: 'Demo Dispensary Portland',
    slug: 'demo-dispensary-portland',
    latitude: 45.5152,
    longitude: -122.6784,
    city: 'Portland',
    region: 'Oregon',
    country: 'USA',
    recreational: true,
    medical: true,
    verified: true,
    active: true,
  },
  {
    id: 'demo-denver',
    name: 'Demo Dispensary Denver',
    slug: 'demo-dispensary-denver',
    latitude: 39.7392,
    longitude: -104.9903,
    city: 'Denver',
    region: 'Colorado',
    country: 'USA',
    recreational: true,
    medical: true,
    verified: true,
    active: true,
  },
  {
    id: 'demo-las-vegas',
    name: 'Demo Dispensary Las Vegas',
    slug: 'demo-dispensary-las-vegas',
    latitude: 36.1716,
    longitude: -115.1391,
    city: 'Las Vegas',
    region: 'Nevada',
    country: 'USA',
    recreational: true,
    medical: true,
    verified: true,
    active: true,
  },
  {
    id: 'demo-los-angeles',
    name: 'Demo Dispensary Los Angeles',
    slug: 'demo-dispensary-los-angeles',
    latitude: 34.0522,
    longitude: -118.2437,
    city: 'Los Angeles',
    region: 'California',
    country: 'USA',
    recreational: true,
    medical: true,
    verified: true,
    active: true,
  },
  {
    id: 'demo-seattle',
    name: 'Demo Dispensary Seattle',
    slug: 'demo-dispensary-seattle',
    latitude: 47.6062,
    longitude: -122.3321,
    city: 'Seattle',
    region: 'Washington',
    country: 'USA',
    recreational: true,
    medical: false,
    verified: true,
    active: true,
  },
];
