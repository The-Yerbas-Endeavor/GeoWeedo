import 'server-only';

import {getDatabase} from '@/lib/sqlite';
import {googlePlacesConfigured} from '@/lib/googlePlacesEnrichment';

export function resumeBlockedBatch(jobId:string){
 if(!googlePlacesConfigured())throw new Error('Google Places enrichment is still not configured.');
 const db=getDatabase(),stamp=new Date().toISOString();
 const job=db.prepare(`SELECT id FROM dispensary_batch_jobs WHERE id=?`).get(jobId) as {id:string}|undefined;
 if(!job)throw new Error('Batch job not found.');
 // Recover records that were blocked before Google Places was configured and
 // transient/configuration failures from Google Places (403, quota, network,
 // etc.).  Do not blindly retry unrelated website/parser failures.
 const result=db.prepare(`UPDATE dispensary_batch_items
  SET status='pending',stage='google_places',message=NULL,updated_at=?
  WHERE job_id=? AND (
   status='blocked' OR
   (status='failed' AND (
    stage='google_places' OR
    message LIKE 'Google Places%'
   ))
  )`).run(stamp,jobId);
 const pending=(db.prepare(`SELECT COUNT(*) count FROM dispensary_batch_items WHERE job_id=? AND status='pending'`).get(jobId) as any)?.count||0;
 if(pending)db.prepare(`UPDATE dispensary_batch_jobs SET status='queued',updated_at=? WHERE id=?`).run(stamp,jobId);
 return{jobId,requeued:Number(result.changes||0),pending:Number(pending)};
}
