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
  dataSource?: string;
  sourceUrl?: string;
  sourceLicense?: string;
  imageryProvider?: 'kartaview' | 'geoweedo';
  imageryPhotoId?: string;
  imagerySequenceId?: string;
  imageryLatitude?: number;
  imageryLongitude?: number;
  imageryHeading?: number;
  imageryFieldOfView?: number;
  imageryProjection?: string;
  imageryUrl?: string;
  priorityWeight?: number;
  sponsoredUntil?: string;
  sponsored?: boolean;
  sponsorPriority?: number;
  sponsorshipEndsAt?: string;
  recreational: boolean;
  medical: boolean;
  verified: boolean;
  active: boolean;
};

// Small real-world bootstrap set so a fresh GeoWeedo install has meaningful map
// locations immediately. These are location/address seeds, not imagery approvals;
// approved SQLite records replace/supplement them as the admin review queue grows.
export const dispensaries: Dispensary[] = [
  {
    id: 'starter-oregrown-portland',
    name: 'Oregrown Portland',
    slug: 'oregrown-portland',
    streetAddress: '111 NE 12th Ave',
    latitude: 45.5238006,
    longitude: -122.6539019,
    city: 'Portland',
    region: 'Oregon',
    country: 'USA',
    website: 'https://oregrown.com/pages/oregrown-portland',
    dataSource: 'GeoWeedo starter data',
    sourceUrl: 'https://oregrown.com/pages/oregrown-portland',
    recreational: true,
    medical: true,
    verified: true,
    active: true,
  },
  {
    id: 'starter-broadway-cannabis-pearl',
    name: 'Broadway Cannabis Market - Pearl District',
    slug: 'broadway-cannabis-market-pearl-district',
    streetAddress: '427 NW Broadway',
    latitude: 45.526347,
    longitude: -122.67789,
    city: 'Portland',
    region: 'Oregon',
    country: 'USA',
    dataSource: 'GeoWeedo starter data',
    recreational: true,
    medical: true,
    verified: true,
    active: true,
  },
  {
    id: 'starter-hashtag-seattle',
    name: '#Hashtag Cannabis',
    slug: 'hashtag-cannabis-seattle',
    streetAddress: '224 Nickerson St',
    latitude: 47.6471214,
    longitude: -122.3518372,
    city: 'Seattle',
    region: 'Washington',
    country: 'USA',
    dataSource: 'Washington DOH / GeoWeedo starter data',
    recreational: true,
    medical: true,
    verified: true,
    active: true,
  },
  {
    id: 'starter-seattle-cannabis-co',
    name: 'Seattle Cannabis Co.',
    slug: 'seattle-cannabis-co-rainier',
    streetAddress: '7262 Rainier Ave S, Suite B',
    latitude: 47.5371555,
    longitude: -122.2698757,
    city: 'Seattle',
    region: 'Washington',
    country: 'USA',
    dataSource: 'Washington DOH / GeoWeedo starter data',
    recreational: true,
    medical: true,
    verified: true,
    active: true,
  },
  {
    id: 'starter-beyond-hello-sahara',
    name: 'Beyond / Hello - Sahara',
    slug: 'beyond-hello-sahara-las-vegas',
    streetAddress: '7885 W Sahara Ave, Suite 111-112',
    latitude: 36.142467,
    longitude: -115.262573,
    city: 'Las Vegas',
    region: 'Nevada',
    country: 'USA',
    dataSource: 'Nevada Cannabis Compliance Board / GeoWeedo starter data',
    recreational: true,
    medical: false,
    verified: true,
    active: true,
  },
];
