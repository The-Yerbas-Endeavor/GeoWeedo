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
import LoadedRegionCoveragePortal from '@/components/LoadedRegionCoveragePortal';
import BrowseCountryPartition from '@/components/BrowseCountryPartition';
import FloatingStreetViewEnhancer from '@/components/FloatingStreetViewEnhancer';
import AnalyticsTracker from '@/components/AnalyticsTracker';
import DispensaryCardEnhancer from '@/components/DispensaryCardEnhancer';
import HomeMapLocationDeepLink from '@/components/HomeMapLocationDeepLink';
import GeolocationReliability from '@/components/GeolocationReliability';
import StateCandidateStreetViewVerifier from '@/components/StateCandidateStreetViewVerifier';
import MobileGuessMapController from '@/components/MobileGuessMapController';
import MobileHomeMode from '@/components/MobileHomeMode';

export const metadata = {
  title: 'GeoWeedo',
  description: 'WEEDO SEARCH. WEEDO FIND. WEEDO PLAY.',
  manifest: '/assets/geoweedo/site.webmanifest',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover' as const,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}<MobileHomeMode/><MobileGuessMapController/><StateCandidateStreetViewVerifier/><GeolocationReliability/><AnalyticsTracker/><HomeMapLocationDeepLink/><DispensaryCardEnhancer/><FloatingStreetViewEnhancer/><LoadedRegionCoveragePortal/><BrowseCountryPartition/></body>
    </html>
  );
}
