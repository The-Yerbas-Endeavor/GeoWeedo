'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';

const ProductCategoryManager = dynamic(() => import('@/components/ProductCategoryManager'), {
  ssr: false,
  loading: () => <div style={{padding:'16px',color:'#9aa69d'}}>Loading category tools…</div>,
});

export default function AdminProductsAdvancedTools() {
  const [opened, setOpened] = useState(false);
  return <details
    id="advanced-tools"
    style={{maxWidth:1320,margin:'18px auto 40px',padding:'0 24px'}}
    onToggle={event => { if (event.currentTarget.open) setOpened(true); }}
  >
    <summary style={{cursor:'pointer',fontWeight:900,padding:'14px 16px',border:'1px solid rgba(255,255,255,.12)',borderRadius:12,background:'#131815',color:'#f4f7f4'}}>Advanced category tools</summary>
    {opened ? <div style={{marginTop:12}}><ProductCategoryManager/></div> : null}
  </details>;
}
