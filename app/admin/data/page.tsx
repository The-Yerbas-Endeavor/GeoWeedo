import AdminDataManager from '@/components/AdminDataManager';
import AmsterdamCoffeeshopImporter from '@/components/AmsterdamCoffeeshopImporter';
import CandidatePipelineRunner from '@/components/CandidatePipelineRunner';
import CoordinateEnrichmentAllStates from '@/components/CoordinateEnrichmentAllStates';
export const metadata={title:'GeoWeedo Admin · Data Import'};
export default function AdminDataPage(){return <><CandidatePipelineRunner/><AdminDataManager/><CoordinateEnrichmentAllStates/><AmsterdamCoffeeshopImporter/></>}
