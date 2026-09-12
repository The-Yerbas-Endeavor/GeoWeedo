import type { Metadata } from 'next';
import SiteHeader from '@/components/SiteHeader';
import { getCultivarByRsp } from '@/lib/kannapedia';
import { getPublicCultivar } from '@/lib/cultivarPublic';
import '../cultivars.css';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ rsp: string }> };

function formatDate(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { rsp } = await params;
  const cultivar = getCultivarByRsp(rsp);
  return {
    title: cultivar ? `${cultivar.name} Cultivar Genetics · GeoWeedo` : 'Cultivar Genetics · GeoWeedo',
    description: cultivar ? `Kannapedia-sourced cultivar genetics for ${cultivar.name}.` : 'GeoWeedo cultivar genetics.',
  };
}

export default async function CultivarDetailPage({ params }: Props) {
  const { rsp } = await params;
  const cultivar = getCultivarByRsp(rsp);
  const pedigree = cultivar ? getPublicCultivar(cultivar.name) : null;

  return <main className="landing-shell">
    <SiteHeader />
    <div className="cultivarPage">
      {!cultivar ? <section className="cultivarHero"><a className="cultivarSource" href="/cultivars">← All cultivars</a><h1>Cultivar not found</h1></section> : <>
        <section className="cultivarHero">
          <a className="cultivarSource" href="/cultivars">← All cultivars</a>
          <span className="cultivarKicker">KANNAPEDIA CULTIVAR RECORD · RSP {cultivar.rsp_id}</span>
          <h1>{cultivar.name}</h1>
          <p>{cultivar.registrant ? `Registered by ${cultivar.registrant}. ` : ''}Genetics and cultivar metadata are shown as source-reported information and are kept separate from GeoWeedo verified laboratory batch chemistry.</p>
          {pedigree ? <a className="cultivarPedigreeLink" href={`/cultivar/${encodeURIComponent(pedigree.cultivar.slug)}`}>View GeoWeedo source-backed pedigree →</a> : null}
        </section>

        <section className="cultivarDetail">
          <article className="cultivarPanel">
            <h2>General information</h2>
            <dl>
              <dt>Registrant</dt><dd>{cultivar.registrant || '—'}</dd>
              <dt>Sample name</dt><dd>{cultivar.sample_name || '—'}</dd>
              <dt>Accession date</dt><dd>{formatDate(cultivar.accession_date)}</dd>
              <dt>Reported sex</dt><dd>{cultivar.reported_sex || '—'}</dd>
              <dt>Report type</dt><dd>{cultivar.report_type || '—'}</dd>
              <dt>DNA source</dt><dd>{cultivar.dna_source || '—'}</dd>
              <dt>Plant type</dt><dd>{cultivar.plant_type || '—'}</dd>
              <dt>Rarity</dt><dd>{cultivar.rarity || '—'}{cultivar.rarity_percentile != null ? ` · ${cultivar.rarity_percentile} percentile` : ''}</dd>
              <dt>Heterozygosity</dt><dd>{cultivar.heterozygosity != null ? `${cultivar.heterozygosity}%` : '—'}</dd>
            </dl>
            <a className="cultivarSource" href={cultivar.source_url} target="_blank" rel="noreferrer">Open original Kannapedia record ↗</a>
          </article>

          <article className="cultivarPanel">
            <h2>Evidence classification</h2>
            <p>Genetics metadata is sourced from Kannapedia. Any chemistry below is explicitly <strong>registrant reported</strong>, not a GeoWeedo-verified laboratory batch.</p>
            <div className="cultivarNotice">Do not use these cultivar-level chemistry values as a substitute for the exact Product Chemistry record of a retail package or batch.</div>
            {pedigree ? <div className="cultivarPedigreeNotice"><strong>Pedigree available</strong><span>GeoWeedo has a separate curated pedigree record for this cultivar. Its ancestry claims retain their own sources, confidence and conflict status.</span><a href={`/cultivar/${encodeURIComponent(pedigree.cultivar.slug)}`}>Open pedigree →</a></div> : null}
          </article>
        </section>

        {cultivar.chemistry.length ? <section className="cultivarPanel" style={{marginTop:18}}>
          <h2>Registrant-reported chemistry</h2>
          <div className="cultivarChemistry">
            {(['cannabinoid','terpene'] as const).map(group => <div key={group}>
              <h3>{group === 'cannabinoid' ? 'Cannabinoids' : 'Terpenoids'}</h3>
              <table><tbody>
                {cultivar.chemistry.filter((row: any) => row.group_name === group).map((row: any) => <tr key={`${group}-${row.analyte_name}`}><th>{row.analyte_name}</th><td>{row.value == null ? '—' : `${row.value}${row.unit || ''}`}</td></tr>)}
              </tbody></table>
            </div>)}
          </div>
          <div className="cultivarNotice">Kannapedia states that cannabinoid and terpenoid information on these cultivar records is provided by the registrant.</div>
        </section> : null}

        {Object.keys(cultivar.genetics || {}).length ? <section className="cultivarPanel" style={{marginTop:18}}>
          <h2>Genetics findings</h2>
          <div className="cultivarGenetics">
            {Object.entries(cultivar.genetics).map(([key, value]) => <article key={key}><h3>{key.replace(/([A-Z])/g, ' $1')}</h3><p>{String(value)}</p></article>)}
          </div>
        </section> : null}
      </>}
    </div>
  </main>;
}
