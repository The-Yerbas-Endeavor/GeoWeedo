import type { Metadata } from 'next';
import SiteHeader from '@/components/SiteHeader';
import { getCultivarCatalog } from '@/lib/kannapedia';
import { listPublicCultivars } from '@/lib/cultivarPublic';
import './cultivars.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Cultivar Genetics · GeoWeedo',
  description: 'Browse GeoWeedo source-backed cultivar pedigree records alongside public Kannapedia genetics reports.',
};

type Props = { searchParams: Promise<{ q?: string | string[]; page?: string | string[] }> };
function one(value?: string | string[]) { return Array.isArray(value) ? value[0] : value; }
function formatDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}
function label(value: unknown) { return String(value || '').replace(/_/g, ' '); }

export default async function CultivarsPage({ searchParams }: Props) {
  const query = await searchParams;
  const q = one(query.q)?.trim() || '';
  const page = Math.max(1, Number(one(query.page) || 1) || 1);
  const catalog = getCultivarCatalog({ q, page, pageSize: 50 });
  const pedigree = listPublicCultivars(q);
  const pageHref = (next: number) => `/cultivars?${new URLSearchParams({ ...(q ? { q } : {}), page: String(next) }).toString()}`;

  return <main className="landing-shell">
    <SiteHeader />
    <div className="cultivarPage">
      <section className="cultivarHero">
        <span className="cultivarKicker">🌿 GEOWEEDO CULTIVAR GENETICS</span>
        <h1>Cultivar Genetics</h1>
        <p>Browse curated, source-backed pedigree records alongside public Kannapedia registrant/genomics reports. Reported ancestry, genetic similarity, and exact product/batch chemistry remain distinct evidence layers.</p>
        <div className="cultivarStats"><span>{pedigree.length.toLocaleString()} public pedigree records</span><span>{catalog.total.toLocaleString()} Kannapedia cultivars</span></div>
      </section>

      <form className="cultivarSearch" method="get" action="/cultivars">
        <input name="q" defaultValue={q} placeholder="Search cultivar, alias, registrant, or RSP ID…" aria-label="Search cultivar genetics" />
        <button type="submit">Search</button>
      </form>

      {pedigree.length ? <section className="cultivarPedigreeDirectory">
        <div className="cultivarSectionHead"><span className="cultivarKicker">CURATED PEDIGREE</span><h2>Source-backed lineage records</h2><p>These records use GeoWeedo's pedigree evidence model, including aliases, source confidence, conflicting ancestry claims, linked products, and measured genetic relationships.</p></div>
        <div className="cultivarPedigreeGrid">
          {pedigree.map((row: any) => <a className="cultivarPedigreeCard" key={row.id} href={`/cultivar/${encodeURIComponent(row.slug)}`}>
            <div><span className={row.status === 'conflicting' ? 'cultivarConflictBadge' : 'cultivarPedigreeBadge'}>{row.status === 'conflicting' ? 'CONFLICTING PEDIGREE' : row.status === 'verified' ? 'VERIFIED SOURCE' : 'SOURCE-BACKED'}</span><h3>{row.canonical_name}</h3><p>{[row.breeder,row.cultivar_type,row.origin].filter(Boolean).join(' · ') || 'Cannabis cultivar'}</p></div>
            <dl><div><dt>Parents</dt><dd>{Number(row.parent_claim_count || 0)}</dd></div><div><dt>Descendants</dt><dd>{Number(row.child_claim_count || 0)}</dd></div><div><dt>Products</dt><dd>{Number(row.product_count || 0)}</dd></div><div><dt>Aliases</dt><dd>{Number(row.alias_count || 0)}</dd></div></dl>
          </a>)}
        </div>
      </section> : null}

      <section className="cultivarSectionHead cultivarKannapediaHead"><span className="cultivarKicker">KANNAPEDIA · REGISTRANT / GENOMICS</span><h2>Public Kannapedia records</h2><p>These records remain source-reported genetics/registrant evidence and are not treated as pedigree proof or verified retail-batch chemistry.</p></section>
      <section className="cultivarList">
        {catalog.rows.map((row: any) => <a className="cultivarCard" key={row.id} href={`/cultivars/${encodeURIComponent(row.rsp_id)}`}>
          <span>
            <h2>{row.name}</h2>
            <span className="cultivarMeta">
              <span>RSP {row.rsp_id}</span>
              {row.registrant ? <span>{row.registrant}</span> : null}
              {row.plant_type ? <span>{row.plant_type}</span> : null}
              {row.accession_date ? <span>{formatDate(row.accession_date)}</span> : null}
              {Number(row.chemistry_count || 0) > 0 ? <span>{row.chemistry_count} registrant-reported chemistry values</span> : null}
            </span>
          </span>
          <span className="cultivarOpen">View genetics →</span>
        </a>)}
      </section>
      {!catalog.rows.length ? <div className="cultivarDirectoryEmpty">No Kannapedia records match this search.</div> : null}

      <nav className="cultivarPager" aria-label="Cultivar catalog pages">
        <span>{catalog.page > 1 ? <a href={pageHref(catalog.page - 1)}>← Previous</a> : null}</span>
        <span>Page {catalog.page} of {catalog.pageCount}</span>
        <span>{catalog.page < catalog.pageCount ? <a href={pageHref(catalog.page + 1)}>Next →</a> : null}</span>
      </nav>
      <p className="cultivarEvidenceNote">Evidence labels are deliberate: breeder/database pedigree claims, registrant-reported genetics, measured genetic relationships, and verified product/batch lab chemistry are not interchangeable.</p>
    </div>
  </main>;
}
