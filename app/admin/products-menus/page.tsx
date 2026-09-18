import AdminProductsDispensaries from '@/components/AdminProductsDispensaries';
import AdminProductsAdvancedTools from '@/components/AdminProductsAdvancedTools';

export const dynamic = 'force-dynamic';

export default function ProductsMenusAdminPage(){
  return <>
    <AdminProductsDispensaries/>
    <AdminProductsAdvancedTools/>
  </>;
}
