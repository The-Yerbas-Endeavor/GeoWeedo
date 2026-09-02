'use client';

import type { CSSProperties } from 'react';

type DailyRow={day:string;page_views:number;visitors:number;sessions:number};
type Props={
 totals:{visitors:number;sessions:number;pageViews:number;activeNow:number;avgDurationMs:number;errors:number};
 daily:DailyRow[];
 excludedMatchedSessions?:number;
};
type MetricKey='visitors'|'sessions'|'page_views';

function duration(ms:number){const seconds=Math.round(ms/1000);if(seconds<60)return `${seconds}s`;const minutes=Math.floor(seconds/60),rest=seconds%60;return rest?`${minutes}m ${rest}s`:`${minutes}m`;}
function spark(values:number[],width=180,height=42){if(!values.length)return '';const max=Math.max(1,...values),min=Math.min(0,...values);return values.map((v,i)=>{const x=values.length===1?width/2:(i/(values.length-1))*width;const y=height-4-((v-min)/(max-min||1))*(height-8);return `${x.toFixed(1)},${y.toFixed(1)}`;}).join(' ');}
function delta(values:number[]){if(values.length<2)return null;const cut=Math.max(1,Math.floor(values.length/2)),old=values.slice(0,cut).reduce((a,b)=>a+b,0),recent=values.slice(cut).reduce((a,b)=>a+b,0);if(old===0)return recent===0?0:null;return Math.round(((recent-old)/old)*100);}
function MetricCard({label,value,metric,daily,sub}:{label:string;value:string;metric?:MetricKey;daily:DailyRow[];sub?:string}){const values=metric?daily.map(r=>Number(r[metric]||0)):[];const d=metric?delta(values):null;return <article className="traffic-kpi-card"><div className="traffic-kpi-head"><span>{label}</span>{d!==null&&<span className={`traffic-kpi-delta ${d>0?'up':d<0?'down':'flat'}`}>{d>0?'+':''}{d}%</span>}</div><div className="traffic-kpi-value">{value}</div>{metric&&<svg className="traffic-kpi-spark" viewBox="0 0 180 42" preserveAspectRatio="none" aria-hidden="true"><polyline points={spark(values)} fill="none" vectorEffect="non-scaling-stroke"/></svg>}{sub&&<div className="traffic-kpi-sub">{sub}</div>}</article>}

export default function AdminTrafficOverview({totals,daily,excludedMatchedSessions=0}:Props){
 const style={
  '--traffic-accent':'var(--accent)',
 } as CSSProperties;
 return <section className="traffic-overview-shell" style={style}>
  <div className="traffic-overview-topline"><div><span className="eyebrow">FIRST-PARTY ANALYTICS</span><h2>Traffic overview</h2><p>At-a-glance site activity. Trends compare the newer half of the selected range with the earlier half.</p></div>{excludedMatchedSessions>0&&<div className="traffic-overview-status"><span className="traffic-excluded-pill">{excludedMatchedSessions.toLocaleString()} excluded</span></div>}</div>
  <div className="traffic-kpi-grid">
   <MetricCard label="Current visitors" value={totals.activeNow.toLocaleString()} daily={daily} sub="Seen in the last minute"/>
   <MetricCard label="Visitors" value={totals.visitors.toLocaleString()} metric="visitors" daily={daily}/>
   <MetricCard label="Sessions" value={totals.sessions.toLocaleString()} metric="sessions" daily={daily} sub={`${totals.sessions?Math.max(1,totals.pageViews/totals.sessions).toFixed(1):'0'} pages / session`}/>
   <MetricCard label="Page views" value={totals.pageViews.toLocaleString()} metric="page_views" daily={daily}/>
   <MetricCard label="Avg page time" value={duration(totals.avgDurationMs)} daily={daily}/>
   <MetricCard label="Client errors" value={totals.errors.toLocaleString()} daily={daily} sub={totals.errors?'Needs attention':'No errors recorded'}/>
  </div>
 </section>;
}
