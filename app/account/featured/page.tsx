import SiteHeader from '@/components/SiteHeader';
import AccountWorkspaceTabs from '@/components/AccountWorkspaceTabs';
import OwnerPage from '../../owner/page';

export default function AccountFeaturedPage(){
  return <>
    <SiteHeader/>
    <AccountWorkspaceTabs/>
    <OwnerPage section="featured"/>
  </>;
}
