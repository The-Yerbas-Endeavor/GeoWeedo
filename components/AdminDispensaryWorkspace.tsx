'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';

const FullEditor = dynamic(() => import('@/components/AdminFullDispensaryEditor'), { ssr: false, loading: () => <Loading/> });
const StateGroups = dynamic(() => import('@/components/StateGroupedDispensaryManager'), { ssr: false, loading: () => <Loading/> });
const ProfileAudit = dynamic(() => import('@/components/AdminEnabledProfileAudit'), { ssr: false, loading: () => <Loading/> });
const BatchEnrichment = dynamic(() => import('@/components/AdminBatchEnrichmentQueue'), { ssr: false, loading: () => <Loading/> });
const RejectedCleanup = dynamic(() => import('@/components/AdminBulkRejectedCandidates'), { ssr: false, loading: () => <Loading/> });
const SingleEnrichment = dynamic(() => import('@/components/AdminDispensaryEnrichment'), { ssr: false, loading: () => <Loading/> });

type Tool = 'editor'|'states'|'audit'|'enrichment'|'rejected'|'single';

function Loading(){return <div className="admin-status">Loading selected dispensary tool…</div>;}

const tools: Array<[Tool,string,string]> = [
  ['editor','Locations','Search and edit dispensary records'],
  ['states','State view','Browse enabled shops and candidates by state'],
  ['audit','Quality audit','Check enabled profile completeness'],
  ['enrichment','Enrichment','Review automated enrichment work'],
  ['rejected','Rejected cleanup','Manage rejected candidate records'],
  ['single','Single enrichment','Run one-record website enrichment'],
];

export default function AdminDispensaryWorkspace(){
  const [tool,setTool]=useState<Tool>('editor');
  return <main className="admin-shell">
    <header className="admin-header">
      <div><span className="eyebrow">GEOWEEDO ADMIN · DISPENSARIES</span><h1>Locations</h1><p style={{color:'var(--muted)'}}>Only the tool you open is loaded. Heavy audits and enrichment queues stay idle until requested.</p></div>
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
    {tool==='states'?<StateGroups/>:null}
    {tool==='audit'?<ProfileAudit/>:null}
    {tool==='enrichment'?<BatchEnrichment/>:null}
    {tool==='rejected'?<RejectedCleanup/>:null}
    {tool==='single'?<SingleEnrichment/>:null}
  </main>;
}
