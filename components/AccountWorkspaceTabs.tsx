'use client';

import { usePathname } from 'next/navigation';

const tabs = [
  { href: '/account', label: 'Account', accountSection: true },
  { href: '/account/shop', label: 'Shop', accountSection: true },
  { href: '/account/products', label: 'Products / Menu', accountSection: true },
  { href: '/account/shop#featured-analytics', label: 'Featured', accountSection: false },
  { href: '/account/yerbas', label: 'Yerbas', accountSection: true },
  { href: '/', label: 'View map', accountSection: false },
];

export default function AccountWorkspaceTabs() {
  const pathname = usePathname();
  return <section style={{maxWidth:1050,margin:'0 auto',padding:'34px 22px 0'}}>
    <span className="eyebrow">MY GEOWEEDO</span>
    <h1 style={{fontSize:'clamp(2rem,4vw,3rem)',margin:'7px 0 16px'}}>GeoWeedo Account</h1>
    <nav aria-label="GeoWeedo account sections" style={{display:'flex',gap:8,flexWrap:'wrap',borderBottom:'1px solid rgba(255,255,255,.12)',paddingBottom:12}}>
      {tabs.map(tab=>{
        const active=tab.accountSection
          ? tab.href==='/account'
            ? pathname===tab.href
            : pathname.startsWith(tab.href.split('#')[0])
          : false;
        return <a key={tab.href} href={tab.href} style={{
          display:'inline-flex',alignItems:'center',minHeight:40,padding:'8px 14px',borderRadius:'10px 10px 0 0',
          textDecoration:'none',fontWeight:800,fontSize:14,
          color:active?'#07180d':'#d9e8dc',background:active?'#8fe36e':'rgba(255,255,255,.045)',
          border:`1px solid ${active?'#8fe36e':'rgba(255,255,255,.12)'}`,
          borderBottomColor:active?'#8fe36e':'rgba(255,255,255,.12)'
        }}>{tab.label}</a>;
      })}
    </nav>
  </section>;
}
