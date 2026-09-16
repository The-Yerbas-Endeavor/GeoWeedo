import AdminDataManager from '@/components/AdminDataManager';
import AmsterdamCoffeeshopImporter from '@/components/AmsterdamCoffeeshopImporter';
import CannlyticsImporterMount from '@/components/CannlyticsImporterMount';

export const metadata={title:'GeoWeedo Admin · Data Import'};

export default function AdminDataPage(){
  return <>
    <AdminDataManager/>
    <CannlyticsImporterMount/>
    <AmsterdamCoffeeshopImporter/>
  </>;
}
