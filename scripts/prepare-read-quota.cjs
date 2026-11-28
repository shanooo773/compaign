const fs=require('node:fs'),assert=require('node:assert/strict');
const dir='apps/api/.wrangler/read-quota-source-before';fs.mkdirSync(dir,{recursive:true});
for(const name of ['campaign-archive','followup-sequence','automation','index']) fs.copyFileSync(`apps/api/src/${name}.ts`,`${dir}/${name}.ts`);
let p='apps/api/src/campaign-archive.ts',s=fs.readFileSync(p,'utf8');
const start=s.indexOf(' (m.id IN ('),end=s.indexOf('\n AND (m.status',start);assert(start>0&&end>start);
s=s.slice(0,start)+` m.id IN (
 SELECT message_id FROM message_authorizations WHERE user_id=c.user_id AND campaign_id=c.id
 UNION SELECT child.id FROM message_authorizations a JOIN messages child ON child.parent_id=a.message_id WHERE a.user_id=c.user_id AND a.campaign_id=c.id
 UNION SELECT f.child_id FROM followup_steps f JOIN message_authorizations a ON a.message_id=f.root_id WHERE a.user_id=c.user_id AND a.campaign_id=c.id)`+s.slice(end);fs.writeFileSync(p,s);
p='apps/api/src/followup-sequence.ts';s=fs.readFileSync(p,'utf8');s=s.replace('`SELECT f.*,r.snapshot',`\`WITH candidates AS MATERIALIZED (
      SELECT child_id FROM followup_steps WHERE queued=0 AND cancel_reason IS NULL AND due_at<=? AND next_check_at<=?
      UNION SELECT f.child_id FROM current_message_revisions r JOIN followup_steps f ON f.child_id=r.message_id
        WHERE f.queued=0 AND f.cancel_reason IS NULL AND r.scheduled_at IS NOT NULL
        AND CAST(round((julianday(r.scheduled_at)-2440587.5)*86400000) AS INTEGER)<=? AND f.next_check_at<=?
    ) SELECT f.*,r.snapshot`);
s=s.replace('FROM followup_steps f JOIN messages m ON m.id=f.root_id JOIN transports t ON t.message_id=m.id','FROM candidates candidate JOIN followup_steps f ON f.child_id=candidate.child_id JOIN messages m ON m.id=f.root_id JOIN transports t ON t.message_id=m.id');s=s.replace('.bind(now, now)','.bind(now, now, now, now, now, now)');fs.writeFileSync(p,s);
p='apps/api/src/automation.ts';s=fs.readFileSync(p,'utf8');s=s.replace("AND (t.next_sync<=? OR t.message_id IN (SELECT value FROM json_each(?)))", "AND ${ids ? 't.message_id IN (SELECT value FROM json_each(?))' : 't.next_sync<=?'}");s=s.replace('      now,\n      encodedIds,\n      ids','      ids ? encodedIds : now,\n      ids');s=s.replace('      now,\r\n      encodedIds,\r\n      ids','      ids ? encodedIds : now,\r\n      ids');
// A background sweep consumes all due retained threads in bounded batches; forced checks remain small.
s=s.replace('ids ? ids.length : user ? 2 : 1','ids ? ids.length : user ? 20 : 500');
// One hour per thread, including errors; forced follow-up checks bypass next_sync.
s=s.replaceAll('now + 300000, row.message_id','now + 3600000, row.message_id').replaceAll('now + 300000,\n            row.message_id','now + 3600000,\n            row.message_id').replaceAll('now + 300000,\r\n            row.message_id','now + 3600000,\r\n            row.message_id').replaceAll('now + 300000,\n        JSON.stringify','now + 3600000,\n        JSON.stringify').replaceAll('now + 300000,\r\n        JSON.stringify','now + 3600000,\r\n        JSON.stringify');fs.writeFileSync(p,s);
