import 'server-only';

import {getDatabase} from '@/lib/sqlite';
import {configuredSiteSearchProvider} from '@/lib/siteSearchProvider';

export function resumeBlockedBatch(jobId:string){
 if(!configuredSiteSearchProvider())throw new Error('Official-site discovery is still not configured.');
 const db=getDatabase(),stamp=new Date().toISOString();
 const job=db.prepare(`SELECT id FROM dispensary_batch_jobs WHERE id=?`).get(jobId) as {id:string}|undefined;
 if(!job)throw new Error('Batch job not found.');
 const result=db.prepare(`UPDATE dispensary_batch_items SET status='pending',stage='discovery',message=NULL,updated_at=? WHERE job_id=? AND status='blocked'`).run(stamp,jobId);
 const pending=(db.prepare(`SELECT COUNT(*) count FROM dispensary_batch_items WHERE job_id=? AND status='pending'`).get(jobId) as any)?.count||0;
 if(pending)db.prepare(`UPDATE dispensary_batch_jobs SET status='queued',updated_at=? WHERE id=?`).run(stamp,jobId);
 return{jobId,requeued:Number(result.changes||0),pending:Number(pending)};
}
