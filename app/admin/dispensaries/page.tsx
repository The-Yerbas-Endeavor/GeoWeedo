import AdminDispensaryWorkspace from '@/components/AdminDispensaryWorkspace';
import AdminHoursInputDefaults from '@/components/AdminHoursInputDefaults';

export const metadata = { title: 'GeoWeedo Admin · Dispensaries' };

export default function AdminDispensariesPage(){
  return <>
    <AdminHoursInputDefaults/>
    <AdminDispensaryWorkspace/>
  </>;
}
