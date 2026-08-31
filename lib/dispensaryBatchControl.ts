import 'server-only';

import {getDatabase} from '@/lib/sqlite';

export type BatchControlAction='pause'|'resume'|'cancel';

function now(){return new Date().toISOString();}

export function getBatchControlState(jobId:string){
 const db=getDatabase();
 const row=db.prepare(`SELECT id,status FROM dispensary_batch_jobs WHERE id=?`).get(jobId) as {id:string;status:string}|undefined;
 if(!row)throw new Error('Batch job not found.');
 return row;
}

export function controlBatchJob(jobId:string,action:BatchControlAction){
 const db=getDatabase(),stamp=now();
 const current=getBatchControlState(jobId);
 if(current.status==='completed')return{jobId,status:'completed',changed:false};
 if(current.status==='cancelled'&&action!=='cancel')throw new Error('Cancelled batch jobs cannot be resumed.');
 if(action==='cancel'){
  if(current.status==='cancelled')return{jobId,status:'cancelled',changed:false};
  db.prepare(`UPDATE dispensary_batch_jobs SET status='cancelled',updated_at=? WHERE id=?`).run(stamp,jobId);
  return{jobId,status:'cancelled',changed:true};
 }
 if(action==='pause'){
  if(current.status==='paused')return{jobId,status:'paused',changed:false};
  db.prepare(`UPDATE dispensary_batch_jobs SET status='paused',updated_at=? WHERE id=?`).run(stamp,jobId);
  return{jobId,status:'paused',changed:true};
 }
 const pending=Number((db.prepare(`SELECT COUNT(*) count FROM dispensary_batch_items WHERE job_id=? AND status='pending'`).get(jobId) as any)?.count||0);
 const processing=Number((db.prepare(`SELECT COUNT(*) count FROM dispensary_batch_items WHERE job_id=? AND status='processing'`).get(jobId) as any)?.count||0);
 if(processing){
  db.prepare(`UPDATE dispensary_batch_items SET status='pending',message=COALESCE(message,'Recovered after interrupted batch run.'),updated_at=? WHERE job_id=? AND status='processing'`).run(stamp,jobId);
 }
 const remaining=pending+processing;
 const status=remaining?'queued':'completed';
 db.prepare(`UPDATE dispensary_batch_jobs SET status=?,updated_at=? WHERE id=?`).run(status,stamp,jobId);
 return{jobId,status,changed:current.status!==status,recovered:processing};
}
