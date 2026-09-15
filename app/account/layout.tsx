'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

const links = [
  { href: '/account', label: 'Account' },
  { href: '/account/shop', label: 'Shop dashboard' },
  { href: '/account/products', label: 'Products / menu' },
  { href: '/account/scanner', label: 'Scanner / profile' },
];

export default function AccountLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return <>
    <nav aria-label="GeoWeedo account workspace" style={{
      position:'sticky',top:0,zIndex:1200,display:'flex',alignItems:'center',gap:8,
      padding:'10px clamp(12px,3vw,34px)',overflowX:'auto',whiteSpace:'nowrap',
      background:'rgba(3,20,12,.96)',borderBottom:'1px solid rgba(126,217,87,.22)',
      backdropFilter:'blur(14px)'
    }}>
      <a href="/account" style={{fontWeight:900,color:'#8fe36e',textDecoration:'none',marginRight:8}}>✦ My GeoWeedo</a>
      {links.map(link=>{
        const active=link.href==='/account'?pathname===link.href:pathname.startsWith(link.href);
        return <a key={link.href} href={link.href} style={{
          display:'inline-flex',alignItems:'center',minHeight:38,padding:'7px 12px',borderRadius:999,
          textDecoration:'none',fontWeight:800,fontSize:14,
          color:active?'#07180d':'#d9e8dc',
          background:active?'#8fe36e':'rgba(255,255,255,.045)',
          border:`1px solid ${active?'#8fe36e':'rgba(255,255,255,.12)'}`
        }}>{link.label}</a>;
      })}
      <a href="/for-dispensaries#featured" style={{marginLeft:'auto',color:'#c8d7cc',textDecoration:'none',fontWeight:700,fontSize:14}}>Featured</a>
      <a href="/" style={{color:'#c8d7cc',textDecoration:'none',fontWeight:700,fontSize:14}}>Map</a>
    </nav>
    {children}
  </>;
}
