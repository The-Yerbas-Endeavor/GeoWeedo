import AdminProductsMenus from '@/components/AdminProductsMenus';
import AdminProductsAdvancedTools from '@/components/AdminProductsAdvancedTools';

export const dynamic = 'force-dynamic';

export default function ProductsMenusAdminPage(){
  return <>
    <AdminProductsMenus/>
    <AdminProductsAdvancedTools/>
  </>;
}
