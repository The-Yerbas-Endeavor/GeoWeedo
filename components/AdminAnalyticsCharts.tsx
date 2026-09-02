'use client';

type Daily={day:string;page_views:number;visitors:number;sessions:number};
type NamedCount={name:string;value:number};

function niceDay(day:string){const date=new Date(`${day}T00:00:00`);return date.toLocaleDateString(undefined,{month:'short',day:'numeric'});}
function path(values:number[],width:number,height:number,pad=18){const max=Math.max(1,...values);return values.map((value,index)=>{const x=values.length<=1?pad:pad+(index/(values.length-1))*(width-pad*2);const y=height-pad-(value/max)*(height-pad*2);return `${index?'L':'M'}${x.toFixed(1)},${y.toFixed(1)}`;}).join(' ');}

export function TrafficTrendChart({daily}:{daily:Daily[]}){
 const width=760,height=250;
 const pageViews=daily.map(row=>Number(row.page_views||0));
 const sessions=daily.map(row=>Number(row.sessions||0));
 const visitors=daily.map(row=>Number(row.visitors||0));
 const max=Math.max(1,...pageViews,...sessions,...visitors);
 return <article style={{border:'1px solid rgba(255,255,255,.1)',borderRadius:16,padding:18,background:'rgba(255,255,255,.025)'}}>
  <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'baseline',flexWrap:'wrap'}}><div><strong style={{fontSize:18}}>Traffic trend</strong><div style={{opacity:.65,fontSize:12}}>Visitors, sessions, and page views over time</div></div><div style={{display:'flex',gap:14,fontSize:12,opacity:.82}}><span>● Page views</span><span>● Sessions</span><span>● Visitors</span></div></div>
  <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Traffic trend chart" style={{width:'100%',height:'auto',marginTop:14,overflow:'visible'}}>
   {[0,.25,.5,.75,1].map((n,i)=><g key={i}><line x1="18" x2={width-18} y1={height-18-n*(height-36)} y2={height-18-n*(height-36)} stroke="currentColor" opacity=".08"/><text x="2" y={height-14-n*(height-36)} fill="currentColor" opacity=".48" fontSize="10">{Math.round(max*n)}</text></g>)}
   <path d={path(pageViews,width,height)} fill="none" stroke="currentColor" strokeWidth="3" opacity=".95"/>
   <path d={path(sessions,width,height)} fill="none" stroke="currentColor" strokeWidth="2" opacity=".6" strokeDasharray="8 5"/>
   <path d={path(visitors,width,height)} fill="none" stroke="currentColor" strokeWidth="2" opacity=".38"/>
   {daily.length>1&&<><text x="18" y={height-2} fill="currentColor" opacity=".5" fontSize="10">{niceDay(daily[0].day)}</text><text x={width-18} y={height-2} textAnchor="end" fill="currentColor" opacity=".5" fontSize="10">{niceDay(daily[daily.length-1].day)}</text></>}
  </svg>
 </article>;
}

export function RankedBarChart({title,subtitle,rows}:{title:string;subtitle:string;rows:NamedCount[]}){
 const max=Math.max(1,...rows.map(row=>row.value));
 return <article style={{border:'1px solid rgba(255,255,255,.1)',borderRadius:16,padding:18,background:'rgba(255,255,255,.025)'}}>
  <strong style={{fontSize:18}}>{title}</strong><div style={{opacity:.65,fontSize:12,marginBottom:16}}>{subtitle}</div>
  <div style={{display:'grid',gap:10}}>{rows.length?rows.slice(0,8).map((row,index)=><div key={`${row.name}-${index}`} style={{display:'grid',gridTemplateColumns:'minmax(90px,160px) 1fr auto',gap:10,alignItems:'center'}}><span style={{fontSize:12,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={row.name}>{row.name}</span><span style={{display:'block',height:9,borderRadius:999,background:'rgba(255,255,255,.07)',overflow:'hidden'}}><i style={{display:'block',height:'100%',width:`${Math.max(2,(row.value/max)*100)}%`,background:'var(--accent)',borderRadius:999}}/></span><strong style={{fontSize:12}}>{row.value.toLocaleString()}</strong></div>):<span style={{opacity:.65,fontSize:13}}>No data yet.</span>}</div>
 </article>;
}
