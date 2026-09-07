import type {Metadata} from 'next';
import {redirect} from 'next/navigation';
import DispensaryCommunityDetails from '@/components/DispensaryCommunityDetails';
import ModeratorDispensaryEditor from '@/components/ModeratorDispensaryEditor';
import {getCommunityProfile,getLocationBase} from '@/lib/dispensaryCommunity';
import {getDispensaryLogo} from '@/lib/dispensaryLogo';
import {resolveDispensaryIdentifier} from '@/lib/dispensarySlug';
import {activeSponsorshipMap} from '@/lib/sponsorshipStore';
import {getDatabase} from '@/lib/sqlite';
import styles from './profile.module.css';

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
function safeWebsite(value?:string|null){if(!value)return null;return /^https?:\/\//i.test(value)?value:`https://${value}`;}
function mapEmbed(latitude:number,longitude:number){
 const dx=.032,dy=.019;
 const bbox=[longitude-dx,latitude-dy,longitude+dx,latitude+dy].map(v=>v.toFixed(6)).join(',');
 return `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${encodeURIComponent(`${latitude},${longitude}`)}`;
}
export async function generateMetadata({params}:Props):Promise<Metadata>{
 const {id}=await params,resolved=resolveDispensaryIdentifier(id),location=resolved?getLocationBase(resolved.locationId):null;
 if(!location)return {title:'Dispensary not found · GeoWeedo'};
 const description=`${location.name} in ${[location.city,location.region].filter(Boolean).join(', ')}. View dispensary details on GeoWeedo.`;
 return {title:`${location.name} · GeoWeedo`,description,alternates:{canonical:`/dispensary/${resolved?.slug||id}`}};
}
export default async function DispensaryProfilePage({params}:Props){
 const {id}=await params,resolved=resolveDispensaryIdentifier(id);
 if(!resolved)return <main className={styles.page}><div className={styles.wrap}><a className={styles.back} href="/">← Back to map</a><section className={styles.hero}><div className={styles.heroContent}><div className={styles.kicker}>GEOWEEDO LOCATION</div><h1>Dispensary not found</h1><p className={styles.address}>This location may have been removed or is no longer public.</p></div></section></div></main>;
 if(resolved.alias&&resolved.slug&&resolved.slug!==id)redirect(`/dispensary/${resolved.slug}`);
 const location=getLocationBase(resolved.locationId);if(!location)return null;
 const profile=getCommunityProfile(location.id),logo=getDispensaryLogo(location.id),claimed=isClaimed(location.id),sponsorship=(await activeSponsorshipMap()).get(location.id),sponsored=Boolean(sponsorship),listed=location.kind==='dispensary'&&Boolean(location.active&&location.verified),profileTier=tier({sponsored,claimed,listed});
 const address=[location.streetAddress,location.city,location.region,location.postalCode,location.country].filter(Boolean).join(', '),website=safeWebsite(profile?.website||location.website),phone=profile?.phone||location.phone,hasCoords=Number.isFinite(location.latitude)&&Number.isFinite(location.longitude),mapHref=`/?location=${encodeURIComponent(resolved.slug||location.id)}`,mapBackground=hasCoords?mapEmbed(location.latitude,location.longitude):null;
 return <main className={styles.page}><div className={styles.wrap}>
  <a className={styles.back} href="/">← Back to GeoWeedo map</a>
  <section className={styles.hero}>
   {mapBackground&&<div className={styles.heroMap} aria-hidden="true"><iframe src={mapBackground} title="" loading="lazy" tabIndex={-1}/></div>}
   <div className={styles.heroContent}>
    <div className={styles.kicker}>GEOWEEDO DISPENSARY</div>
    <div className={styles.status}><span className={styles.badge}>{listed?'✓ ENABLED':'● MAPPED'}</span><span className={styles.badge}>{profileTier}</span>{claimed&&<span className={styles.badge}>✓ OWNER VERIFIED</span>}{sponsored&&<span className={`${styles.badge} ${styles.gold}`}>★ FEATURED</span>}</div>
    <div className={styles.brand}>{logo&&<img className={styles.logo} src={logo.path} alt={`${location.name} logo`}/>}<div><h1>{location.name}</h1><p className={styles.address}>📍 {address||[location.city,location.region].filter(Boolean).join(', ')}</p></div></div>
    {profile?.overview&&<p className={styles.overview}>{profile.overview}</p>}
    <div className={styles.actions}><a href={mapHref}>📍 View on GeoWeedo map</a>{website&&<a href={website} target="_blank" rel="noreferrer">↗ Website</a>}{phone&&<a href={`tel:${phone.replace(/[^+\d]/g,'')}`}>☎ Call</a>}{claimed?<a href="/owner">Owner editor</a>:<a href={`/owner?dispensary=${encodeURIComponent(location.id)}`}>Claim this dispensary</a>}</div>
   </div>
  </section>
  <section className={styles.snapshot} aria-label="Location snapshot">
   <article><span>GEOWEEDO STATUS</span><strong>{listed?'Enabled location':'Mapped location'}</strong><small>{claimed?'Owner verified':'Community profile'}</small></article>
   <article><span>LOCATION</span><strong>{[location.city,location.region].filter(Boolean).join(', ')||'Location mapped'}</strong><small>{location.country||'GeoWeedo'}</small></article>
   <article><span>COORDINATES</span><strong>{hasCoords?`${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}`:'Pending'}</strong><small>{hasCoords?'Mapped ✓':'Enrichment needed'}</small></article>
   <article><span>OFFICIAL DATA</span><strong>{location.licenseNumber||'License not published'}</strong><small>{location.dataSource||'GeoWeedo record'}</small></article>
  </section>
  <div className={styles.content}>
   {sponsored&&<aside className={styles.sponsor}><strong>★ Featured GeoWeedo profile</strong><p>This dispensary has active sponsored placement. Sponsorship changes presentation and placement, not reviews, licensing data, or organic search relevance.</p></aside>}
   <section className={styles.cta}><div><span>EXPLORE THE LOCATION</span><h3>See where this dispensary lives on GeoWeedo.</h3><p>Jump back to the interactive map, inspect the location and open available street imagery.</p></div><a href={mapHref}>OPEN MAP + STREET VIEW →</a></section>
   <div className={styles.sectionTitle}><div><span>DISPENSARY PROFILE</span><h2>Details & community</h2></div><p>Hours, services, reviews and official source information.</p></div>
   <div className={styles.community}><DispensaryCommunityDetails locationId={location.id}/></div>
   <div className={styles.admin}><ModeratorDispensaryEditor locationId={location.id}/></div>
  </div>
 </div></main>;
}
