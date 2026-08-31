import AdminDispensaryManager from '@/components/AdminDispensaryManager';

export const metadata = { title: 'GeoWeedo Admin · Manual Street View' };

export default function ManualImageryPage() {
  return <div>
    <div style={{maxWidth:1400,margin:'18px auto 0',padding:'0 20px'}}>
      <a href="/admin/dispensaries" style={{color:'inherit'}}>← Back to dispensaries</a>
      <p style={{color:'var(--muted)'}}>Advanced fallback only: manually inspect fallback sequences or upload GeoWeedo-hosted 360° imagery. Normal dispensary approval checks Street View automatically.</p>
    </div>
    <AdminDispensaryManager/>
  </div>;
}
