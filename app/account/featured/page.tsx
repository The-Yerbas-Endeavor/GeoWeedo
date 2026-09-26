import AccountWorkspaceTabs from '@/components/AccountWorkspaceTabs';
import OwnerPage from '../../owner/page';

export default function AccountFeaturedPage(){
  return <>
<AccountWorkspaceTabs/>
    <OwnerPage section="featured"/>
  </>;
}
