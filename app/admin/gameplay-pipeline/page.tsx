import CandidatePipelineRunner from '@/components/CandidatePipelineRunner';

export const metadata={title:'GeoWeedo Admin · Gameplay Pipeline'};

export default function GameplayPipelinePage(){
  return <main className="admin-shell">
    <header className="admin-header">
      <div><span className="eyebrow">GEOWEEDO ADMIN</span><h1>Gameplay pipeline</h1></div>
      <div className="admin-links"><a href="/admin">Control center</a><a href="/admin/data">Data import</a><a href="/admin/dispensaries">Dispensaries</a><a href="/">Game</a></div>
    </header>
    <CandidatePipelineRunner/>
  </main>;
}
