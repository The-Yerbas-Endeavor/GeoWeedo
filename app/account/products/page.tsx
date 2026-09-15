import SiteHeader from '@/components/SiteHeader';
import AccountWorkspaceTabs from '@/components/AccountWorkspaceTabs';
import OwnerProductsPage from '../../owner/products/page';

export default function AccountProductsPage(){
  return <>
    <SiteHeader/>
    <AccountWorkspaceTabs/>
    <OwnerProductsPage/>
  </>;
}
