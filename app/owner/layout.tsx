import type { ReactNode } from 'react';

export default function OwnerLayout({ children }: { children: ReactNode }) {
  return <>
    <div style={{maxWidth:1050,margin:'18px auto -22px',padding:'0 22px',position:'relative',zIndex:5}}>
      <nav aria-label="Owner workspace" style={{display:'flex',justifyContent:'flex-end',gap:8,flexWrap:'wrap'}}>
        <a href="/owner" style={{border:'1px solid var(--border)',borderRadius:10,padding:'8px 12px',textDecoration:'none',fontWeight:800,color:'inherit',background:'rgba(255,255,255,.02)'}}>Shop dashboard</a>
        <a href="/owner/products" style={{border:'1px solid var(--border)',borderRadius:10,padding:'8px 12px',textDecoration:'none',fontWeight:800,color:'inherit',background:'rgba(103,214,110,.07)'}}>Products</a>
      </nav>
    </div>
    {children}
  </>;
}
