export default function SiteHeader() {
  return (
    <nav className="topbar site-topbar" aria-label="GeoWeedo navigation">
      <a className="brand brand-link" href="/">
        <span className="brand-pin">✦</span> GEOWEEDO
      </a>
      <div className="nav-actions">
        <a className="ghost nav-link" href="/how-to-play">How to play</a>
        <a className="ghost nav-link" href="/rewards">YERB rewards</a>
        <a className="ghost nav-link" href="/for-dispensaries">For dispensaries</a>
        <a className="ghost nav-link" href="/about">About</a>
        <a className="primary nav-link" href="/account">Account</a>
      </div>
    </nav>
  );
}
