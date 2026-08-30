import 'maplibre-gl/dist/maplibre-gl.css';
import '@photo-sphere-viewer/core/index.css';
import './globals.css';
import './open-stack.css';
import './admin.css';
import './site.css';
import './map-popup.css';
import './community.css';
import LoadedRegionCoveragePortal from '@/components/LoadedRegionCoveragePortal';
import BrowseCountryPartition from '@/components/BrowseCountryPartition';
import FloatingStreetViewEnhancer from '@/components/FloatingStreetViewEnhancer';
import MapPinRecovery from '@/components/MapPinRecovery';
import AnalyticsTracker from '@/components/AnalyticsTracker';
import DispensaryCardEnhancer from '@/components/DispensaryCardEnhancer';

export const metadata = {
  title: 'GeoWeedo',
  description: 'Guess the dispensary. Own the map. Earn YERB.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}<AnalyticsTracker/><DispensaryCardEnhancer/><FloatingStreetViewEnhancer/><MapPinRecovery/><LoadedRegionCoveragePortal/><BrowseCountryPartition/></body>
    </html>
  );
}
