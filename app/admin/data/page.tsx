import AdminDataManager from '@/components/AdminDataManager';
import AdminImageryProviderSettings from '@/components/AdminImageryProviderSettings';
import AmsterdamCoffeeshopImporter from '@/components/AmsterdamCoffeeshopImporter';
import CandidatePipelineRunner from '@/components/CandidatePipelineRunner';
import CoordinateEnrichmentAllStates from '@/components/CoordinateEnrichmentAllStates';
import ExpandedOfficialSourceControls from '@/components/ExpandedOfficialSourceControls';
export const metadata={title:'GeoWeedo Admin · Data Import'};
export default function AdminDataPage(){return <><CandidatePipelineRunner/><AdminImageryProviderSettings/><AdminDataManager/><ExpandedOfficialSourceControls/><CoordinateEnrichmentAllStates/><AmsterdamCoffeeshopImporter/></>}
