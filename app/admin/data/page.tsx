import AdminDataManager from '@/components/AdminDataManager';
import CandidatePipelineRunner from '@/components/CandidatePipelineRunner';

export const metadata = { title: 'GeoWeedo Admin · Data Import' };
export default function AdminDataPage() {
  return (
    <>
      <CandidatePipelineRunner />
      <AdminDataManager />
    </>
  );
}
