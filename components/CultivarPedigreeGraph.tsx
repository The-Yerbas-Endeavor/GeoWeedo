'use client';

import { useMemo, useState } from 'react';
import styles from './CultivarPedigreeGraph.module.css';

type Node = { id:string; name:string; slug:string; level:number; status:string; breeder:string|null };
type LineageEdge = { id:string; childId:string; parentId:string; parentRole:string; relationshipType:string; generation:string|null; confidence:number; status:string; sourceName:string|null; sourceUrl:string|null; evidenceType:string|null };
type GeneticEdge = { id:string; cultivarAId:string; cultivarBId:string; relationshipLabel:string; similarityScore:number|null; verified:boolean; sourceName:string; sourceUrl:string|null; evidenceType:string };
type Graph = { focusId:string; nodes:Node[]; lineageEdges:LineageEdge[]; geneticEdges:GeneticEdge[] };

type Position = { x:number; y:number };

function label(value:string|null|undefined){return String(value||'').replace(/_/g,' ');}
function clamp(value:number,min:number,max:number){return Math.max(min,Math.min(max,value));}

export default function CultivarPedigreeGraph({graph}:{graph:Graph}){
 const[mode,setMode]=useState<'pedigree'|'genetic'>('pedigree');
 const layout=useMemo(()=>{
  const width=1180;
  const nodeWidth=190;
  const nodeHeight=74;
  if(mode==='genetic'){
   const focus=graph.nodes.find(n=>n.id===graph.focusId);
   const relationIds=new Set<string>();
   for(const edge of graph.geneticEdges){if(edge.cultivarAId===graph.focusId)relationIds.add(edge.cultivarBId);if(edge.cultivarBId===graph.focusId)relationIds.add(edge.cultivarAId);}
   const relatives=graph.nodes.filter(n=>relationIds.has(n.id));
   const height=Math.max(360,relatives.length*105+100);
   const positions=new Map<string,Position>();
   if(focus)positions.set(focus.id,{x:240,y:height/2});
   relatives.forEach((node,index)=>positions.set(node.id,{x:880,y:(index+1)*height/(relatives.length+1)}));
   return{width,height,nodeWidth,nodeHeight,nodes:focus?[focus,...relatives]:relatives,positions};
  }
  const nodes=graph.nodes.filter(n=>n.level!==99);
  const levels=[...new Set(nodes.map(n=>n.level))].sort((a,b)=>a-b);
  const groups=new Map<number,Node[]>();
  for(const level of levels)groups.set(level,nodes.filter(n=>n.level===level).sort((a,b)=>a.name.localeCompare(b.name)));
  const biggest=Math.max(1,...[...groups.values()].map(rows=>rows.length));
  const height=Math.max(500,biggest*118+120);
  const positions=new Map<string,Position>();
  levels.forEach((level,levelIndex)=>{
   const rows=groups.get(level)||[];
   const x=levels.length===1?width/2:120+(levelIndex*(width-240))/(levels.length-1);
   rows.forEach((node,index)=>positions.set(node.id,{x,y:(index+1)*height/(rows.length+1)}));
  });
  return{width,height,nodeWidth,nodeHeight,nodes,positions};
 },[graph,mode]);

 const focus=graph.nodes.find(n=>n.id===graph.focusId);
 const pedigreeEdges=graph.lineageEdges.filter(edge=>layout.positions.has(edge.childId)&&layout.positions.has(edge.parentId));
 const geneticEdges=graph.geneticEdges.filter(edge=>layout.positions.has(edge.cultivarAId)&&layout.positions.has(edge.cultivarBId));

 return <section className={styles.wrap}>
  <div className={styles.toolbar}>
   <div><span>INTERACTIVE GENETICS</span><h2>{mode==='pedigree'?'Reported pedigree':'Measured genetic relationships'}</h2></div>
   <div className={styles.modes} role="group" aria-label="Cultivar graph view">
    <button type="button" className={mode==='pedigree'?styles.active:''} onClick={()=>setMode('pedigree')}>Pedigree</button>
    <button type="button" className={mode==='genetic'?styles.active:''} onClick={()=>setMode('genetic')}>Genetic relatives</button>
   </div>
  </div>
  <p className={styles.explainer}>{mode==='pedigree'?'Lines represent source-backed reported breeding relationships. Conflicting claims are kept visible rather than silently merged.':'These links come from genotype/DNA evidence and do not, by themselves, prove a parent/child breeding event.'}</p>
  {mode==='genetic'&&geneticEdges.length===0?<div className={styles.empty}>No measured genetic relationships have been linked to {focus?.name||'this cultivar'} yet.</div>:null}
  {mode==='pedigree'&&pedigreeEdges.length===0?<div className={styles.empty}>No published pedigree claims have been linked to {focus?.name||'this cultivar'} yet.</div>:null}
  {(mode==='pedigree'?pedigreeEdges.length>0:geneticEdges.length>0)?<div className={styles.scroller}>
   <svg className={styles.graph} viewBox={`0 0 ${layout.width} ${layout.height}`} role="img" aria-label={`${focus?.name||'Cultivar'} ${mode} graph`}>
    {mode==='pedigree'?pedigreeEdges.map(edge=>{const parent=layout.positions.get(edge.parentId)!;const child=layout.positions.get(edge.childId)!;const conflict=edge.status==='conflicting_pedigree';return <g key={edge.id} className={conflict?styles.conflictEdge:styles.edge}>
      <line x1={parent.x+layout.nodeWidth/2} y1={parent.y} x2={child.x-layout.nodeWidth/2} y2={child.y}/>
      <title>{`${label(edge.parentRole)} · ${label(edge.relationshipType)}${edge.generation?` · ${edge.generation}`:''} · confidence ${edge.confidence}%${edge.sourceName?` · ${edge.sourceName}`:''}`}</title>
     </g>;}):geneticEdges.map(edge=>{const a=layout.positions.get(edge.cultivarAId)!;const b=layout.positions.get(edge.cultivarBId)!;const score=edge.similarityScore===null?'':` ${edge.similarityScore}`;return <g key={edge.id} className={edge.verified?styles.geneticVerified:styles.geneticEdge}>
       <line x1={a.x+layout.nodeWidth/2} y1={a.y} x2={b.x-layout.nodeWidth/2} y2={b.y}/>
       <text x={(a.x+b.x)/2} y={(a.y+b.y)/2-8} textAnchor="middle">{label(edge.relationshipLabel)}{score}</text>
       <title>{`${edge.sourceName} · ${label(edge.evidenceType)}${edge.similarityScore!==null?` · similarity ${edge.similarityScore}`:''}`}</title>
      </g>;})}
    {layout.nodes.map(node=>{const pos=layout.positions.get(node.id)!;const isFocus=node.id===graph.focusId;const isConflict=node.status==='conflicting';return <a key={node.id} href={`/cultivar/${encodeURIComponent(node.slug)}`} className={styles.nodeLink}>
      <g className={`${styles.node} ${isFocus?styles.focusNode:''} ${isConflict?styles.conflictNode:''}`} transform={`translate(${pos.x-layout.nodeWidth/2} ${pos.y-layout.nodeHeight/2})`}>
       <rect width={layout.nodeWidth} height={layout.nodeHeight} rx="14"/>
       <text className={styles.nodeName} x={layout.nodeWidth/2} y="30" textAnchor="middle">{node.name.length>25?`${node.name.slice(0,24)}…`:node.name}</text>
       <text className={styles.nodeMeta} x={layout.nodeWidth/2} y="52" textAnchor="middle">{isFocus?'FOCAL CULTIVAR':node.breeder?node.breeder.slice(0,27):label(node.status)}</text>
       <title>{`${node.name}${node.breeder?` · ${node.breeder}`:''} · ${label(node.status)}`}</title>
      </g>
     </a>;})}
   </svg>
  </div>:null}
  <div className={styles.legend}><span><i className={styles.legendNormal}/> source-backed pedigree</span><span><i className={styles.legendConflict}/> conflicting claim</span><span><i className={styles.legendGenetic}/> genetic relationship</span><span>Click a cultivar to open its page.</span></div>
 </section>;
}
