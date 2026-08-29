import AdminDispensaryManager from '@/components/AdminDispensaryManager';
import AdminStateGroupsPortal from '@/components/AdminStateGroupsPortal';

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
        order: 5;
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
      .dispensaries-admin-order .admin-shell > .state-grouped-dispensaries {
        order: 3;
      }
      .dispensaries-admin-order .admin-shell > #dispensary-edit-panel {
        order: 4;
      }
      .dispensaries-admin-order .admin-shell > section.admin-panel[style*="margin-bottom"]:not(.state-grouped-dispensaries):not(#dispensary-edit-panel) {
        display: none;
      }
      .dispensaries-admin-order .admin-shell > section.admin-panel.approved-list {
        display: none;
      }
    `}</style>
    <AdminDispensaryManager />
    <AdminStateGroupsPortal />
  </div>;
}
