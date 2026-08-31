import DispensaryCommunityDetails from '@/components/DispensaryCommunityDetails';
import ModeratorDispensaryEditor from '@/components/ModeratorDispensaryEditor';
import { getLocationBase } from '@/lib/dispensaryCommunity';

export const dynamic='force-dynamic';
type Props={params:Promise<{id:string}>};

export default async function DispensaryProfilePage({params}:Props){
 const {id}=await params;const location=getLocationBase(id);
 if(!location)return <main className="dispensary-profile-page"><a className="profile-back" href="/">← Back to map</a><section className="dispensary-profile-shell"><h1>Dispensary not found</h1><p>This location may have been removed or is no longer public.</p></section></main>;
 return <main className="dispensary-profile-page"><a className="profile-back" href="/">← Back to map</a><section className="dispensary-profile-shell"><div className="profile-kicker">GEOWEEDO DISPENSARY</div><h1>{location.name}</h1><p className="profile-location">{[location.city,location.region,location.country].filter(Boolean).join(', ')}</p><ModeratorDispensaryEditor locationId={id}/><DispensaryCommunityDetails locationId={id}/></section></main>;
}
