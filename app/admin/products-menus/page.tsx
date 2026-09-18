import AdminProductsDispensaries from '@/components/AdminProductsDispensaries';
import AdminProductsAdvancedTools from '@/components/AdminProductsAdvancedTools';
import CannlyticsImporter from '@/components/CannlyticsImporter';

export const dynamic = 'force-dynamic';

export default function ProductsMenusAdminPage(){
  return <>
    <AdminProductsDispensaries/>
    <div id="cannlytics-importer" style={{maxWidth:1320,margin:'18px auto 0',padding:'0 28px'}}>
      <CannlyticsImporter/>
    </div>
    <AdminProductsAdvancedTools/>
  </>;
}
