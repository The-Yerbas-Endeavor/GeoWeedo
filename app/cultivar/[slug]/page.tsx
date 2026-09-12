import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import SiteHeader from '@/components/SiteHeader';
import CultivarPedigreeGraph from '@/components/CultivarPedigreeGraph';
import { getPublicCultivar } from '@/lib/cultivarPublic';
import styles from './cultivar.module.css';

export const dynamic = 'force-dynamic';

type Props={params:Promise<{slug:string}>};
function label(value:string|null|undefined){return String(value||'').replace(/_/g,' ');}
function pct(value:unknown){const n=Number(value);return Number.isFinite(n)?`${Math.round(n)}%`:'—';}

export async function generateMetadata({params}:Props):Promise<Metadata>{
 const{slug}=await params;
 const data=getPublicCultivar(slug);
 if(!data)return{title:'Cultivar not found · GeoWeedo'};
 const c=data.cultivar;
 return{
  title:`${c.canonical_name} pedigree · Weedo Facts · GeoWeedo`,
  description:`Source-backed cannabis cultivar pedigree, aliases, products, and genetics evidence for ${c.canonical_name}.`,
  alternates:{canonical:`/cultivar/${encodeURIComponent(c.slug)}`},
 };
}

export default async function CultivarPage({params}:Props){
 const{slug}=await params;
 const data=getPublicCultivar(slug);
 if(!data)notFound();
 const{cultivar,aliases,parents,children,products,geneticRelationships,graph}=data;
 const conflict=cultivar.status==='conflicting'||parents.some((row:any)=>row.status==='conflicting_pedigree');
 return <main className={styles.shell}>
  <SiteHeader/>
  <div className={styles.page}>
   <div className={styles.topline}><a href="/cultivars">← Cultivar directory</a><span>WEEDO FACTS · CULTIVAR GENETICS</span></div>
   <section className={styles.hero}>
    <div><span>CANNABIS CULTIVAR</span><h1>{cultivar.canonical_name}</h1><p>{[cultivar.breeder,cultivar.cultivar_type,cultivar.origin].filter(Boolean).join(' · ')||'Source-backed cultivar record'}</p></div>
    <div className={`${styles.status} ${conflict?styles.conflict:''}`}>{conflict?'Conflicting pedigree':cultivar.status==='verified'?'Verified source identity':'Source-backed identity'}</div>
   </section>
   {cultivar.description?<p className={styles.description}>{cultivar.description}</p>:null}
   {aliases.length?<section className={styles.aliases}><strong>Also known as</strong><div>{aliases.map((row:any)=><span key={row.id}>{row.alias}{row.verified?' ✓':''}</span>)}</div></section>:null}

   <CultivarPedigreeGraph graph={graph}/>

   <section className={styles.columns}>
    <article className={styles.panel}><div className={styles.panelHead}><span>REPORTED PARENTS</span><h2>Pedigree evidence</h2><p>Each relationship remains tied to its source and confidence level.</p></div>
     {parents.length===0?<div className={styles.empty}>No published parent claims yet.</div>:<div className={styles.claims}>{parents.map((row:any)=><div className={styles.claim} key={row.id}><div><a href={`/cultivar/${encodeURIComponent(row.parent_slug)}`}>{row.parent_name}</a><small>{[label(row.parent_role),label(row.relationship_type),row.generation].filter(Boolean).join(' · ')}</small></div><div className={styles.claimMeta}><b>{pct(row.confidence)}</b><span className={row.status==='conflicting_pedigree'?styles.conflictText:''}>{label(row.status)}</span>{row.source_url?<a href={row.source_url} target="_blank" rel="noreferrer">{row.source_name||'Source'} ↗</a>:row.source_name?<span>{row.source_name}</span>:null}</div></div>)}</div>}
    </article>
    <article className={styles.panel}><div className={styles.panelHead}><span>DESCENDANTS</span><h2>Reported children</h2><p>Cultivars that cite this cultivar as a parent.</p></div>
     {children.length===0?<div className={styles.empty}>No published descendants yet.</div>:<div className={styles.claims}>{children.map((row:any)=><div className={styles.claim} key={row.id}><div><a href={`/cultivar/${encodeURIComponent(row.child_slug)}`}>{row.child_name}</a><small>{[label(row.parent_role),label(row.relationship_type),row.generation].filter(Boolean).join(' · ')}</small></div><div className={styles.claimMeta}><b>{pct(row.confidence)}</b><span>{label(row.status)}</span></div></div>)}</div>}
    </article>
   </section>

   <section className={styles.panel}><div className={styles.panelHead}><span>WEEDO FACTS PRODUCTS</span><h2>Products linked to this cultivar</h2><p>Product/batch chemistry remains separate from cultivar pedigree. These are identity links, not claims that every batch has identical chemistry.</p></div>
    {products.length===0?<div className={styles.empty}>No GeoWeedo products are linked to this cultivar yet.</div>:<div className={styles.products}>{products.map((row:any)=><a className={styles.product} key={row.id} href={`/product/${encodeURIComponent(row.product_id)}`}><div><strong>{row.brand_name?`${row.brand_name} · `:''}{row.product_name}</strong><span>{[row.product_type,row.net_contents].filter(Boolean).join(' · ')||'Cannabis product'}</span></div><div><b>{pct(row.confidence)}</b><small>{label(row.status)}</small></div></a>)}</div>}
   </section>

   <section className={styles.panel}><div className={styles.panelHead}><span>GENETIC EVIDENCE</span><h2>Measured genetic relationships</h2><p>DNA/genotype similarity is displayed separately and does not automatically establish pedigree.</p></div>
    {geneticRelationships.length===0?<div className={styles.empty}>No measured genetic relationships have been linked yet.</div>:<div className={styles.genetics}>{geneticRelationships.map((row:any)=><div className={styles.genetic} key={row.id}><div><a href={`/cultivar/${encodeURIComponent(row.other_slug)}`}>{row.other_cultivar_name}</a><small>{label(row.relationship_label)}{row.similarity_score!==null?` · score ${row.similarity_score}`:''}</small></div><div>{row.verified?<b>Verified dataset</b>:<span>Dataset reported</span>}{row.source_url?<a href={row.source_url} target="_blank" rel="noreferrer">{row.source_name} ↗</a>:<span>{row.source_name}</span>}</div></div>)}</div>}
   </section>
  </div>
 </main>;
}
