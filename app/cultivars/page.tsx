import type { Metadata } from 'next';
import SiteHeader from '@/components/SiteHeader';
import { getCultivarCatalog } from '@/lib/kannapedia';
import './cultivars.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Cultivar Genetics · GeoWeedo',
  description: 'Browse GeoWeedo cultivar genetics records sourced from public Kannapedia reports.',
};

type Props = { searchParams: Promise<{ q?: string | string[]; page?: string | string[] }> };
function one(value?: string | string[]) { return Array.isArray(value) ? value[0] : value; }
function formatDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

export default async function CultivarsPage({ searchParams }: Props) {
  const query = await searchParams;
  const q = one(query.q)?.trim() || '';
  const page = Math.max(1, Number(one(query.page) || 1) || 1);
  const catalog = getCultivarCatalog({ q, page, pageSize: 50 });
  const pageHref = (next: number) => `/cultivars?${new URLSearchParams({ ...(q ? { q } : {}), page: String(next) }).toString()}`;

  return <main className="landing-shell">
    <SiteHeader />
    <div className="cultivarPage">
      <section className="cultivarHero">
        <span className="cultivarKicker">🌿 GEOWEEDO CULTIVAR GENETICS</span>
        <h1>Cultivar Genetics</h1>
        <p>Public cultivar genetics and registrant metadata from Kannapedia. This evidence layer is kept separate from verified laboratory Product Chemistry.</p>
        <div className="cultivarStats"><span>{catalog.total.toLocaleString()} cultivars</span><span>Kannapedia public source</span></div>
      </section>

      <form className="cultivarSearch" method="get" action="/cultivars">
        <input name="q" defaultValue={q} placeholder="Search cultivar, registrant, or RSP ID…" aria-label="Search cultivar genetics" />
        <button type="submit">Search</button>
      </form>

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

      <nav className="cultivarPager" aria-label="Cultivar catalog pages">
        <span>{catalog.page > 1 ? <a href={pageHref(catalog.page - 1)}>← Previous</a> : null}</span>
        <span>Page {catalog.page} of {catalog.pageCount}</span>
        <span>{catalog.page < catalog.pageCount ? <a href={pageHref(catalog.page + 1)}>Next →</a> : null}</span>
      </nav>
    </div>
  </main>;
}
