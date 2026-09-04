export default function SiteHeader() {
  const links = [
    ['/how-to-play', 'How to play'],
    ['/rewards', 'YERB rewards'],
    ['/for-dispensaries', 'For dispensaries'],
    ['/about', 'About'],
  ] as const;

  return (
    <nav className="topbar site-topbar" aria-label="GeoWeedo navigation">
      <a className="brand brand-link geoweedo-header-brand" href="/" aria-label="GeoWeedo home">
        <img
          src="/assets/geoweedo/geoweedo-icon-96.png"
          alt=""
          aria-hidden="true"
          className="geoweedo-header-icon"
        />
        <span className="geoweedo-header-wordmark">GEOWEEDO</span>
      </a>

      <div className="nav-actions">
        {links.map(([href, label]) => (
          <a key={href} className="ghost nav-link" href={href}>{label}</a>
        ))}
        <a className="primary nav-link" href="/account">Account</a>
      </div>

      <details className="mobile-nav-menu">
        <summary aria-label="Open GeoWeedo menu">Menu</summary>
        <div className="mobile-nav-popover">
          {links.map(([href, label]) => (
            <a key={href} className="ghost nav-link" href={href}>{label}</a>
          ))}
          <a className="primary nav-link" href="/account">Account</a>
        </div>
      </details>
    </nav>
  );
}
