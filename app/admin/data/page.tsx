import AdminDataManager from '@/components/AdminDataManager';
import AmsterdamCoffeeshopImporter from '@/components/AmsterdamCoffeeshopImporter';
export const metadata={title:'GeoWeedo Admin · Data Import'};
export default function AdminDataPage(){return <><AdminDataManager/><AmsterdamCoffeeshopImporter/></>}
