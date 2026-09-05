import 'maplibre-gl/dist/maplibre-gl.css';
import '@photo-sphere-viewer/core/index.css';
import './globals.css';
import './open-stack.css';
import './admin.css';
import './site.css';
import './map-popup.css';
import './community.css';
import './profile-details.css';
import './streetview-center.css';
import './map-overlay-order.css';
import './mobile.css';
import './mobile-game-map.css';
import './mobile-home-mode.css';
import './enabled-browse-filter.css';
import './home-play-promo.css';
import './pending-game-reward.css';
import LoadedRegionCoveragePortal from '@/components/LoadedRegionCoveragePortal';
import BrowseCountryPartition from '@/components/BrowseCountryPartition';
import FloatingStreetViewEnhancer from '@/components/FloatingStreetViewEnhancer';
import AnalyticsTracker from '@/components/AnalyticsTracker';
import ProductAnalyticsEvents from '@/components/ProductAnalyticsEvents';
import DispensaryCardEnhancer from '@/components/DispensaryCardEnhancer';
import HomeMapLocationDeepLink from '@/components/HomeMapLocationDeepLink';
import HomeLocationSelectionCardMinimizer from '@/components/HomeLocationSelectionCardMinimizer';
import GeolocationReliability from '@/components/GeolocationReliability';
import StateCandidateStreetViewVerifier from '@/components/StateCandidateStreetViewVerifier';
import MobileGuessMapController from '@/components/MobileGuessMapController';
import MobileHomeMode from '@/components/MobileHomeMode';
import EnabledDispensaryBrowseFilter from '@/components/EnabledDispensaryBrowseFilter';
import DispensaryBrowseTierOrder from '@/components/DispensaryBrowseTierOrder';
import AdminGoogleApiStatus from '@/components/AdminGoogleApiStatus';
import AdminAmenitiesCheckboxes from '@/components/AdminAmenitiesCheckboxes';
import PendingGameRewardClaim from '@/components/PendingGameRewardClaim';

export const metadata = {
  title: 'GeoWeedo',
  description: 'WEEDO SEARCH. WEEDO FIND. WEEDO PLAY.',
  manifest: '/assets/geoweedo/site.webmanifest',
  icons: {
    icon: [
      { url: '/assets/geoweedo/geoweedo-icon-master.png', sizes: '1024x1024', type: 'image/png' },
    ],
    shortcut: '/assets/geoweedo/geoweedo-icon-master.png',
    apple: '/assets/geoweedo/geoweedo-icon-master.png',
  },
  openGraph: {
    title: 'GeoWeedo',
    description: 'WEEDO SEARCH. WEEDO FIND. WEEDO PLAY.',
    images: ['/assets/geoweedo/geoweedo-logo-horizontal-dark.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'GeoWeedo',
    description: 'WEEDO SEARCH. WEEDO FIND. WEEDO PLAY.',
    images: ['/assets/geoweedo/geoweedo-logo-horizontal-dark.png'],
  },
};

export const viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' as const };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}<PendingGameRewardClaim/><AdminGoogleApiStatus/><AdminAmenitiesCheckboxes/><HomeLocationSelectionCardMinimizer/><EnabledDispensaryBrowseFilter/><DispensaryBrowseTierOrder/><MobileHomeMode/><MobileGuessMapController/><StateCandidateStreetViewVerifier/><GeolocationReliability/><AnalyticsTracker/><ProductAnalyticsEvents/><HomeMapLocationDeepLink/><DispensaryCardEnhancer/><FloatingStreetViewEnhancer/><LoadedRegionCoveragePortal/><BrowseCountryPartition/></body>
    </html>
  );
}
