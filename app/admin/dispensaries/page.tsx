import AdminDispensaryManager from '@/components/AdminDispensaryManager';

export const metadata = {
  title: 'GeoWeedo Admin · Dispensaries',
};

export default function AdminDispensariesPage() {
  return <div className="dispensaries-admin-order">
    <style>{`
      .dispensaries-admin-order .admin-shell {
        display: flex;
        flex-direction: column;
      }
      .dispensaries-admin-order .admin-shell > * {
        order: 4;
      }
      .dispensaries-admin-order .admin-shell > .admin-header {
        order: 0;
      }
      .dispensaries-admin-order .admin-shell > .admin-status {
        order: 1;
      }
      .dispensaries-admin-order .admin-shell > .admin-grid {
        order: 2;
      }
      .dispensaries-admin-order .admin-shell > #dispensary-edit-panel {
        order: 3;
      }
    `}</style>
    <AdminDispensaryManager />
  </div>;
}
