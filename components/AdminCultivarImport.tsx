'use client';

import { ChangeEvent, useMemo, useState } from 'react';
import styles from './AdminCultivarImport.module.css';

const example = `{
  "rightsConfirmed": false,
  "source": {
    "name": "Example Breeder",
    "type": "breeder",
    "url": "https://example.com/genetics",
    "evidenceType": "breeder_primary",
    "licenseNote": "Permission or compatible reuse license goes here.",
    "verified": true
  },
  "cultivars": [
    {
      "name": "Child Cultivar",
      "breeder": "Example Breeder",
      "cultivarType": "Hybrid",
      "status": "source_backed",
      "aliases": ["Child Alias"]
    },
    { "name": "Parent A", "status": "source_backed" },
    { "name": "Parent B", "status": "source_backed" }
  ],
  "lineage": [
    {
      "child": "Child Cultivar",
      "parent": "Parent A",
      "parentRole": "parent_a",
      "relationshipType": "cross",
      "generation": "F1",
      "confidence": 90,
      "status": "verified_source"
    },
    {
      "child": "Child Cultivar",
      "parent": "Parent B",
      "parentRole": "parent_b",
      "relationshipType": "cross",
      "generation": "F1",
      "confidence": 90,
      "status": "verified_source"
    }
  ]
}`;

function parseJson(value:string){try{return{data:JSON.parse(value),error:''};}catch(error){return{data:null,error:error instanceof Error?error.message:'Invalid JSON.'};}}

export default function AdminCultivarImport(){
 const[text,setText]=useState(example),[saving,setSaving]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 const parsed=useMemo(()=>parseJson(text),[text]);
 const summary=parsed.data?{cultivars:Array.isArray(parsed.data.cultivars)?parsed.data.cultivars.length:0,lineage:Array.isArray(parsed.data.lineage)?parsed.data.lineage.length:0,source:parsed.data.source?.name||'—',rights:Boolean(parsed.data.rightsConfirmed),license:String(parsed.data.source?.licenseNote||'').trim()}:null;
 async function readFile(event:ChangeEvent<HTMLInputElement>){const file=event.target.files?.[0];if(!file)return;setError('');try{setText(await file.text());}catch{setError('Could not read this JSON file.');}}
 async function submit(){
  setError('');setMessage('');
  if(!parsed.data){setError(parsed.error||'Invalid JSON.');return;}
  if(!parsed.data.rightsConfirmed){setError('Set rightsConfirmed to true only after confirming GeoWeedo may reuse this dataset.');return;}
  if(String(parsed.data.source?.licenseNote||'').trim().length<8){setError('Add a meaningful source.licenseNote describing the permission or license.');return;}
  setSaving(true);
  try{
   const response=await fetch('/api/admin/cultivar-genetics',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'bulk-import',dataset:parsed.data})});
   const body=await response.json().catch(()=>({}));
   if(!response.ok)throw new Error(body.error||'Cultivar import failed.');
   const result=body.importResult||{};
   setMessage(`Imported ${Number(result.cultivarCount||0).toLocaleString()} cultivars, ${Number(result.aliasCount||0).toLocaleString()} aliases, and ${Number(result.lineageCount||0).toLocaleString()} pedigree claims from ${result.sourceName||'the dataset'}.`);
  }catch(importError){setError(importError instanceof Error?importError.message:'Cultivar import failed.');}finally{setSaving(false);}
 }
 return <main className={styles.shell}>
  <header className={styles.header}><div><span>WEEDO FACTS · CULTIVAR DATA</span><h1>Licensed pedigree import</h1><p>Import source-backed cultivar and pedigree data only when GeoWeedo has permission or a compatible reuse license. This tool deliberately does not scrape third-party cultivar databases.</p></div><div className={styles.headerLinks}><a href="/admin/cultivar-genetics">← Genetics manager</a><a href="/admin">Admin home</a></div></header>
  <section className={styles.notice}><strong>Import guard</strong><p>The API refuses bulk imports unless <code>rightsConfirmed</code> is true and the source contains a meaningful <code>licenseNote</code>. Keep citation-only or restricted sources in manual corroboration workflows instead of importing their database contents.</p></section>
  {error?<div className={styles.error}>{error}</div>:null}{message?<div className={styles.success}>{message}</div>:null}
  <section className={styles.grid}>
   <article className={styles.panel}><div className={styles.panelHead}><span>DATASET</span><h2>JSON import</h2><p>Upload a JSON file or paste the dataset. Cultivar names are normalized and existing records are enriched rather than duplicated.</p></div><label className={styles.file}>Load JSON file<input type="file" accept="application/json,.json" onChange={readFile}/></label><textarea className={styles.editor} value={text} onChange={event=>setText(event.target.value)} spellCheck={false}/><div className={styles.actions}><button onClick={()=>setText(example)} type="button">Reset example</button><button className={styles.primary} onClick={submit} disabled={saving||!parsed.data}>{saving?'Importing…':'Import dataset'}</button></div></article>
   <aside className={styles.panel}><div className={styles.panelHead}><span>PREVIEW</span><h2>Import checks</h2><p>Nothing is written until you press Import dataset.</p></div>{parsed.error?<div className={styles.invalid}>JSON error: {parsed.error}</div>:summary?<dl className={styles.summary}><dt>Source</dt><dd>{summary.source}</dd><dt>Cultivars</dt><dd>{summary.cultivars.toLocaleString()}</dd><dt>Pedigree claims</dt><dd>{summary.lineage.toLocaleString()}</dd><dt>Rights confirmed</dt><dd className={summary.rights?styles.good:styles.bad}>{summary.rights?'YES':'NO'}</dd><dt>License note</dt><dd className={summary.license.length>=8?styles.good:styles.bad}>{summary.license||'Missing'}</dd></dl>:null}<div className={styles.format}><strong>Supported cultivar fields</strong><code>name, breeder, cultivarType, description, origin, status, aliases[]</code><strong>Supported lineage fields</strong><code>child, parent, parentRole, relationshipType, generation, confidence, status, notes</code></div></aside>
  </section>
 </main>;
}
