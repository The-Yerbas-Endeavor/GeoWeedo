import AdminProductsMenus from '@/components/AdminProductsMenus';
import ProductCategoryManager from '@/components/ProductCategoryManager';

export const dynamic = 'force-dynamic';

export default function ProductsMenusAdminPage(){
  return <><AdminProductsMenus/><ProductCategoryManager/></>;
}
