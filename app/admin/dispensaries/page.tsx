import AdminStateGroupsPortal from '@/components/AdminStateGroupsPortal';
import AdminFullDispensaryEditor from '@/components/AdminFullDispensaryEditor';
import AdminDispensaryEnrichment from '@/components/AdminDispensaryEnrichment';
import AdminOfficialSiteDiscovery from '@/components/AdminOfficialSiteDiscovery';
import AdminBatchEnrichmentQueue from '@/components/AdminBatchEnrichmentQueue';
import AdminDispensaryQuickApprove from '@/components/AdminDispensaryQuickApprove';

export const metadata = { title: 'GeoWeedo Admin · Dispensaries' };
export default function AdminDispensariesPage(){return <div className="dispensaries-admin-order"><style>{`
.dispensaries-admin-order .admin-shell{display:flex;flex-direction:column}.dispensaries-admin-order .admin-shell>*{order:5}.dispensaries-admin-order .admin-shell>.admin-header{order:0}.dispensaries-admin-order .admin-shell>.admin-status{order:1}.dispensaries-admin-order .admin-shell>.quick-approval{order:2}.dispensaries-admin-order .admin-shell>.state-grouped-dispensaries{order:3}.dispensaries-admin-order .admin-shell>#dispensary-edit-panel{order:4}
`}</style><main className="admin-shell"><header className="admin-header"><div><a href="/admin" className="eyebrow" style={{textDecoration:'none',color:'inherit'}}>GEOWEEDO ADMIN</a><h1>Dispensaries</h1><p style={{color:'var(--muted)'}}>Street View readiness is checked automatically during approval. Google 360° imagery is immediately game-ready; fallback imagery must still meet movement-quality rules.</p></div><div className="admin-links"><a href="/admin">Control center</a><a href="/admin/data">Data import</a><a href="/admin/community">Community</a><a href="/admin/dispensaries/imagery">Manual imagery</a><a href="/">Game</a></div></header><div className="quick-approval"><AdminDispensaryQuickApprove/></div><AdminBatchEnrichmentQueue/><details><summary style={{cursor:'pointer',margin:'8px 0 14px'}}>Single-record discovery / enrichment tools</summary><AdminOfficialSiteDiscovery/><AdminDispensaryEnrichment/></details><AdminFullDispensaryEditor/></main><AdminStateGroupsPortal/></div>}
