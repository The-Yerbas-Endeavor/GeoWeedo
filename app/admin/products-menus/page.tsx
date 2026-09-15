import AdminProductsMenus from '@/components/AdminProductsMenus';
import ProductCategoryManager from '@/components/ProductCategoryManager';

export const dynamic = 'force-dynamic';

export default function ProductsMenusAdminPage(){
  return <>
    <div style={{background:'#0b0e0c',padding:'18px 28px 0'}}>
      <div style={{maxWidth:1320,margin:'0 auto'}}>
        <a href="/admin/product-maintenance" style={{display:'inline-flex',alignItems:'center',gap:8,color:'#071108',background:'#9aed79',padding:'10px 14px',borderRadius:10,fontWeight:900,textDecoration:'none'}}>
          ✏️ Edit product brands & merge duplicates →
        </a>
      </div>
    </div>
    <AdminProductsMenus/>
    <ProductCategoryManager/>
  </>;
}
