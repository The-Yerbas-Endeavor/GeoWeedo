import AdminDataManager from '@/components/AdminDataManager';
import AmsterdamCoffeeshopImporter from '@/components/AmsterdamCoffeeshopImporter';
import CoordinateEnrichmentAllStates from '@/components/CoordinateEnrichmentAllStates';
import ExpandedOfficialSourceControls from '@/components/ExpandedOfficialSourceControls';
export const metadata={title:'GeoWeedo Admin · Data Import'};
export default function AdminDataPage(){return <><AdminDataManager/><ExpandedOfficialSourceControls/><CoordinateEnrichmentAllStates/><AmsterdamCoffeeshopImporter/></>}
