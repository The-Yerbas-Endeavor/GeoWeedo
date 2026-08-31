import 'maplibre-gl/dist/maplibre-gl.css';
import '@photo-sphere-viewer/core/index.css';
import './globals.css';
import './open-stack.css';
import './admin.css';
import './site.css';
import './map-popup.css';
import './community.css';
import './profile-details.css';
import LoadedRegionCoveragePortal from '@/components/LoadedRegionCoveragePortal';
import BrowseCountryPartition from '@/components/BrowseCountryPartition';
import FloatingStreetViewEnhancer from '@/components/FloatingStreetViewEnhancer';
import AnalyticsTracker from '@/components/AnalyticsTracker';
import DispensaryCardEnhancer from '@/components/DispensaryCardEnhancer';
import HomeMapLocationDeepLink from '@/components/HomeMapLocationDeepLink';

export const metadata = {
  title: 'GeoWeedo',
  description: 'WEEDO SEARCH. WEEDO FIND. WEEDO PLAY.',
  icons: {
    icon: [
      { url: '/favicon.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon.ico', type: 'image/x-icon' },
    ],
    shortcut: '/favicon.png',
    apple: '/apple-touch-icon.png',
  },
  manifest: '/assets/geoweedo/site.webmanifest',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}<AnalyticsTracker/><HomeMapLocationDeepLink/><DispensaryCardEnhancer/><FloatingStreetViewEnhancer/><LoadedRegionCoveragePortal/><BrowseCountryPartition/></body>
    </html>
  );
}
