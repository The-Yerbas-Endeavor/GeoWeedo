import SiteHeader from '@/components/SiteHeader';
import AccountWorkspaceTabs from '@/components/AccountWorkspaceTabs';
import OwnerPage from '../../owner/page';

export default function AccountShopPage(){
  return <>
    <SiteHeader/>
    <AccountWorkspaceTabs/>
    <OwnerPage/>
  </>;
}
