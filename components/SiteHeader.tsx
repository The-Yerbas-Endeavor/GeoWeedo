import Link from 'next/link';

export default function SiteHeader() {
  return (
    <nav className="topbar site-topbar">
      <Link className="brand brand-link" href="/">
        <span className="brand-pin">✦</span> GEOWEEDO
      </Link>
      <div className="nav-actions">
        <Link className="ghost nav-link" href="/how-to-play">How to play</Link>
        <Link className="ghost nav-link" href="/rewards">YERB rewards</Link>
        <Link className="ghost nav-link" href="/for-dispensaries">For dispensaries</Link>
        <Link className="ghost nav-link" href="/about">About</Link>
      </div>
    </nav>
  );
}
