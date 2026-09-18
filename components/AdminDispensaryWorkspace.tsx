'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';

const FullEditor = dynamic(() => import('@/components/AdminFullDispensaryEditor'), { ssr: false, loading: () => <Loading/> });
const ProfileAudit = dynamic(() => import('@/components/AdminEnabledProfileAudit'), { ssr: false, loading: () => <Loading/> });
const BatchEnrichment = dynamic(() => import('@/components/AdminBatchEnrichmentQueue'), { ssr: false, loading: () => <Loading/> });

type Tool = 'editor'|'audit'|'enrichment';

function Loading(){return <div className="admin-status">Loading selected dispensary tool…</div>;}

const tools: Array<[Tool,string,string]> = [
  ['editor','Locations','Manage every dispensary and candidate action in one place'],
  ['audit','Quality audit','Review profile completeness and re-audit needs'],
  ['enrichment','Bulk enrichment','Review and run batch enrichment work'],
];

export default function AdminDispensaryWorkspace(){
  const [tool,setTool]=useState<Tool>('editor');
  return <main className="admin-shell">
    <header className="admin-header">
      <div><span className="eyebrow">GEOWEEDO ADMIN · DISPENSARIES</span><h1>Locations</h1><p style={{color:'var(--muted)'}}>Locations is the single place to review, confirm, enable, enrich, and fully edit dispensaries and candidates.</p></div>
    </header>

    <section className="admin-panel" style={{marginBottom:18,padding:12}}>
      <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
        {tools.map(([id,label,description])=><button
          key={id}
          type="button"
          className={tool===id?'primary':'ghost'}
          onClick={()=>setTool(id)}
          title={description}
        >{label}</button>)}
      </div>
    </section>

    {tool==='editor'?<FullEditor/>:null}
    {tool==='audit'?<ProfileAudit/>:null}
    {tool==='enrichment'?<BatchEnrichment/>:null}
  </main>;
}
