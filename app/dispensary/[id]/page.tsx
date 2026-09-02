import type {Metadata} from 'next';
import {redirect} from 'next/navigation';
import DispensaryCommunityDetails from '@/components/DispensaryCommunityDetails';
import ModeratorDispensaryEditor from '@/components/ModeratorDispensaryEditor';
import {getCommunityProfile,getLocationBase} from '@/lib/dispensaryCommunity';
import {getDispensaryLogo} from '@/lib/dispensaryLogo';
import {resolveDispensaryIdentifier} from '@/lib/dispensarySlug';
import {activeSponsorshipMap} from '@/lib/sponsorshipStore';
import {getDatabase} from '@/lib/sqlite';

export const dynamic='force-dynamic';
type Props={params:Promise<{id:string}>};

function isClaimed(locationId:string){
 const row=getDatabase().prepare(`SELECT 1 ok FROM dispensary_user_owner_assignments WHERE location_id=? AND status='verified' LIMIT 1`).get(locationId) as {ok:number}|undefined;
 return Boolean(row);
}
function tier(input:{sponsored:boolean;claimed:boolean;listed:boolean}){
 if(input.sponsored&&input.claimed)return 'Sponsored + Claimed';
 if(input.claimed&&input.listed)return 'Claimed / Listed';
 if(input.listed)return 'Listed';
 return 'Mapped';
}
export async function generateMetadata({params}:Props):Promise<Metadata>{
 const {id}=await params,resolved=resolveDispensaryIdentifier(id),location=resolved?getLocationBase(resolved.locationId):null;
 if(!location)return {title:'Dispensary not found · GeoWeedo'};
 const description=`${location.name} in ${[location.city,location.region].filter(Boolean).join(', ')}. View dispensary details on GeoWeedo.`;
 return {title:`${location.name} · GeoWeedo`,description,alternates:{canonical:`/dispensary/${resolved?.slug||id}`}};
}
export default async function DispensaryProfilePage({params}:Props){
 const {id}=await params,resolved=resolveDispensaryIdentifier(id);
 if(!resolved)return <main className="dispensary-profile-page"><a className="profile-back" href="/">← Back to map</a><section className="dispensary-profile-shell"><h1>Dispensary not found</h1><p>This location may have been removed or is no longer public.</p></section></main>;
 if(resolved.alias&&resolved.slug&&resolved.slug!==id)redirect(`/dispensary/${resolved.slug}`);
 const location=getLocationBase(resolved.locationId);if(!location)return null;
 const profile=getCommunityProfile(location.id),logo=getDispensaryLogo(location.id),claimed=isClaimed(location.id),sponsorship=(await activeSponsorshipMap()).get(location.id),sponsored=Boolean(sponsorship),listed=location.kind==='dispensary'&&Boolean(location.active&&location.verified),profileTier=tier({sponsored,claimed,listed});
 return <main className={`dispensary-profile-page profile-tier-${profileTier.toLowerCase().replace(/[^a-z]+/g,'-')}`}><a className="profile-back" href="/">← Back to map</a><section className="dispensary-profile-shell"><div className="profile-kicker">GEOWEEDO DISPENSARY</div><div className="profile-status-row"><span className={`profile-tier-badge${sponsored?' sponsored':''}`}>{profileTier}</span>{claimed&&<span className="profile-owner-badge">✓ Owner verified</span>}{sponsored&&<span className="profile-sponsored-disclosure">Sponsored placement</span>}</div><div className={`profile-brand-row${logo?' has-logo':''}`}>{logo&&<div className="profile-logo-frame"><img className="profile-dispensary-logo" src={logo.path} alt={`${location.name} logo`}/></div>}<div className="profile-brand-copy"><h1>{location.name}</h1><p className="profile-location">{[location.streetAddress,location.city,location.region,location.postalCode,location.country].filter(Boolean).join(', ')}</p></div></div>{profile?.overview&&<p className="profile-owner-overview">{profile.overview}</p>}<div className="profile-primary-actions">{profile?.website||location.website?<a href={profile?.website||location.website} target="_blank" rel="noreferrer">Website</a>:null}{profile?.phone||location.phone?<a href={`tel:${profile?.phone||location.phone}`}>Call</a>:null}{claimed?<a href="/owner">Owner profile editor</a>:<a href={`/owner?dispensary=${encodeURIComponent(location.id)}`}>Claim this dispensary</a>}</div>{sponsored&&<aside className="profile-sponsored-panel"><strong>Featured GeoWeedo profile</strong><p>This dispensary has active sponsored placement. Sponsorship changes presentation and placement, not reviews, licensing data, or organic search relevance.</p></aside>}<ModeratorDispensaryEditor locationId={location.id}/><DispensaryCommunityDetails locationId={location.id}/></section></main>;
}
