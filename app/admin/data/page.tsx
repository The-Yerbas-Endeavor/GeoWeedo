import AdminDataManager from '@/components/AdminDataManager';
import AmsterdamCoffeeshopImporter from '@/components/AmsterdamCoffeeshopImporter';
export const metadata={title:'GeoWeedo Admin · Data Import'};
export default function AdminDataPage(){return <><div style={{maxWidth:1320,margin:'18px auto 0',padding:'0 24px'}}><a href="/admin/owner-review" style={{display:'inline-block',padding:'10px 14px',border:'1px solid #cbd5cc',borderRadius:10,textDecoration:'none',fontWeight:800,color:'inherit',background:'#fff'}}>Owner Review Center →</a></div><AdminDataManager/><AmsterdamCoffeeshopImporter/></>}
