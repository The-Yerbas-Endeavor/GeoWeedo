import AdminDataManager from '@/components/AdminDataManager';
import AmsterdamCoffeeshopImporter from '@/components/AmsterdamCoffeeshopImporter';
import ExpandedOfficialSourceControls from '@/components/ExpandedOfficialSourceControls';
export const metadata={title:'GeoWeedo Admin · Data Import'};
export default function AdminDataPage(){return <><AdminDataManager/><ExpandedOfficialSourceControls/><AmsterdamCoffeeshopImporter/></>}
