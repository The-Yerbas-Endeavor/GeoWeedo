import AccountWorkspaceTabs from '@/components/AccountWorkspaceTabs';
import OwnerPage from '../../owner/page';

export default function AccountShopPage(){
  return <>
<AccountWorkspaceTabs/>
    <OwnerPage section="shop"/>
  </>;
}
