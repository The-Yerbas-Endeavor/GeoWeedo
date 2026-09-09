import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import SiteHeader from '@/components/SiteHeader';
import { chemistryProfileBySlug, productsContainingChemistry } from '@/lib/weedoChemistry';
import '../../../weedo-facts/weedo-facts.css';
import '../../../weedo-facts/contrast-fix.css';

export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ kind: string; slug: string }>;
};

function formatDate(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

function formatMeasurement(value: number | null, unit: string | null) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  return `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 4 })}${unit ? ` ${unit}` : ''}`;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { kind, slug } = await params;
  const profile = chemistryProfileBySlug(kind, slug);
  if (!profile) return { title: 'Chemistry profile not found · GeoWeedo' };
  return {
    title: `${profile.name} chemistry · Weedo Facts · GeoWeedo`,
    description: `Chemical identity and lab context for ${profile.name}, without consumer-effect or medical claims.`,
  };
}

export default async function ChemistryPage({ params }: Props) {
  const { kind, slug } = await params;
  const profile = chemistryProfileBySlug(kind, slug);
  if (!profile) notFound();

  const listings = productsContainingChemistry(profile);
  const kindLabel = profile.kind === 'terpene' ? 'Terpene' : 'Cannabinoid';

  return (
    <main className="landing-shell">
      <SiteHeader />
      <div className="weedoFactsPage">
        <section className="weedoFactsHero">
          <span className="weedoFactsKicker">WEEDO CHEMISTRY · {kindLabel.toUpperCase()}</span>
          <h1>{profile.name}</h1>
          <p className="weedoFactsLead">{profile.overview}</p>
          <div className="weedoFactsPrinciples">
            <span>Chemistry only</span>
            <span>No effect prediction</span>
            <span>No medical claims</span>
          </div>
        </section>

        <article className="weedoFactsCard">
          <section>
            <h3>Chemical identity</h3>
            <div className="weedoFactsRows">
              <div className="weedoFactsRow"><span>Class</span><strong>{profile.chemicalClass}</strong></div>
              <div className="weedoFactsRow"><span>Molecular formula</span><strong>{profile.formula}</strong></div>
              <div className="weedoFactsRow"><span>Molar mass</span><strong>{profile.molarMass}</strong></div>
            </div>
          </section>

          <section>
            <h3>Chemistry notes</h3>
            <ul>
              {profile.chemistryNotes.map(note => <li key={note}>{note}</li>)}
            </ul>
          </section>

          {profile.naturalOccurrence?.length ? (
            <section>
              <h3>Natural occurrence</h3>
              <p>{profile.naturalOccurrence.join(' · ')}</p>
            </section>
          ) : null}

          {profile.sensory?.length ? (
            <section>
              <h3>Sensory descriptors</h3>
              <p>{profile.sensory.join(' · ')}</p>
              <p><small>These are aroma/sensory descriptors for the compound, not claims about mood, intoxication, medical benefit, or expected consumer experience.</small></p>
            </section>
          ) : null}
        </article>

        <article className="weedoFactsCard">
          <section>
            <h3>Measured in GeoWeedo products</h3>
            {listings.length ? (
              <div className="weedoFactsRows">
                {listings.map(listing => (
                  <div className="weedoFactsRow" key={`${listing.productId}-${listing.batchId}`}>
                    <span>
                      <a className="weedoFactsChemistryLink" href={`/product-chemistry?product=${encodeURIComponent(listing.productId)}&batch=${encodeURIComponent(listing.batchId)}`}>
                        {[listing.brandName, listing.productName].filter(Boolean).join(' — ')}
                      </a>
                      <small>{` · ${listing.batchNumber || listing.coaNumber || 'verified batch'} · ${formatDate(listing.testedAt)}`}</small>
                    </span>
                    <strong>{formatMeasurement(listing.value, listing.unit)}</strong>
                  </div>
                ))}
              </div>
            ) : (
              <p>No verified GeoWeedo Product Chemistry listing currently reports this analyte.</p>
            )}
          </section>
        </article>

        <p><a className="weedoFactsCoaLink" href="/product-chemistry">← All Product Chemistry listings</a></p>
      </div>
    </main>
  );
}
