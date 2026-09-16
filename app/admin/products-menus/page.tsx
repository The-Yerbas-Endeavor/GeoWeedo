import AdminProductsMenus from '@/components/AdminProductsMenus';
import CannlyticsImporter from '@/components/CannlyticsImporter';
import ProductCategoryManager from '@/components/ProductCategoryManager';

export const dynamic = 'force-dynamic';

export default function ProductsMenusAdminPage(){
  return <>
    <AdminProductsMenus/>
    <div id="cannlytics-importer" style={{maxWidth:1320,margin:'18px auto 0',padding:'0 28px'}}>
      <CannlyticsImporter/>
    </div>
    <details id="advanced-tools" style={{maxWidth:1320,margin:'18px auto 40px',padding:'0 28px'}}>
      <summary style={{cursor:'pointer',fontWeight:900,padding:'14px 16px',border:'1px solid rgba(255,255,255,.12)',borderRadius:12,background:'#131815',color:'#f4f7f4'}}>Advanced category tools</summary>
      <div style={{marginTop:12}}><ProductCategoryManager/></div>
    </details>
  </>;
}
