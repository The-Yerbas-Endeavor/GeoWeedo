import 'server-only';

export async function fetchOklahomaCandidates():Promise<never>{
 throw new Error('Oklahoma OMMA currently publishes current dispensary totals and a per-license OMMA Verify lookup, but no public machine-readable bulk roster of active dispensary names and addresses. GeoWeedo will not import a partial or inferred list.');
}
