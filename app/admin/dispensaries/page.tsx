import AdminDispensaryManager from '@/components/AdminDispensaryManager';
import AdminStateGroupsPortal from '@/components/AdminStateGroupsPortal';
import AdminFullDispensaryEditor from '@/components/AdminFullDispensaryEditor';
import AdminDispensaryEnrichment from '@/components/AdminDispensaryEnrichment';
import AdminOfficialSiteDiscovery from '@/components/AdminOfficialSiteDiscovery';

export const metadata = { title: 'GeoWeedo Admin · Dispensaries' };
export default function AdminDispensariesPage(){return <div className="dispensaries-admin-order"><style>{`
.dispensaries-admin-order .admin-shell{display:flex;flex-direction:column}.dispensaries-admin-order .admin-shell>*{order:5}.dispensaries-admin-order .admin-shell>.admin-header{order:0}.dispensaries-admin-order .admin-shell>.admin-status{order:1}.dispensaries-admin-order .admin-shell>.admin-grid{order:2}.dispensaries-admin-order .admin-shell>.state-grouped-dispensaries{order:3}.dispensaries-admin-order .admin-shell>#dispensary-edit-panel{order:4}.dispensaries-admin-order .admin-shell>section.admin-panel.approved-list{display:none}
`}</style><main className="admin-shell"><header className="admin-header"><div><a href="/admin" className="eyebrow" style={{textDecoration:'none',color:'inherit'}}>GEOWEEDO ADMIN</a><h1>Dispensaries</h1></div><div className="admin-links"><a href="/admin">Control center</a><a href="/admin/data">Data import</a><a href="/admin/community">Community</a><a href="/">Game</a></div></header><AdminOfficialSiteDiscovery/><AdminDispensaryEnrichment/><AdminFullDispensaryEditor/></main><AdminDispensaryManager/><AdminStateGroupsPortal/></div>}
