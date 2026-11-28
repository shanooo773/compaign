const fs=require('node:fs');let p='apps/api/src/read-quota.ts',s=fs.readFileSync(p,'utf8');s=s.replace('env.DOCUMENTS_KV.get','env.DOCUMENTS_KV!.get').replace('env.DOCUMENTS_KV.put','env.DOCUMENTS_KV!.put');s='import { syncReplies } from "./automation";\n'+s;
s+=`
// Start one sweep hourly and drain five threads per minute, keeping Gmail calls bounded.
// A failed thread waits until the next sweep; mandatory send-time checks bypass this gate.
export async function backgroundReplies(env: Env, time: number) {
  const sweepKey = "scheduler:reply-sweep:v1";
  if (scheduleWork(time).replies)
    await env.DOCUMENTS_KV!.put(sweepKey, String(time), {expirationTtl: 7200});
  const cutoff = Number(await env.DOCUMENTS_KV!.get(sweepKey));
  if (!cutoff) return;
  const rows = await env.DB.prepare(\`SELECT t.message_id FROM transports t
    JOIN messages m ON m.id=t.message_id JOIN connections c ON c.id=t.connection_id
    WHERE t.state='confirmed' AND t.next_sync<=? AND t.thread_id IS NOT NULL
    AND c.status='connected' AND m.sent_at>?
    AND NOT EXISTS(SELECT 1 FROM message_authorizations a JOIN campaign_workspace_deletions d
      ON d.campaign_id=a.campaign_id AND d.user_id=a.user_id WHERE a.message_id=m.id AND d.state='deleted')
    ORDER BY t.next_sync LIMIT 5\`).bind(cutoff,new Date(time-67*86400000).toISOString()).all<{message_id:string}>();
  if (!rows.results.length) { await env.DOCUMENTS_KV!.delete(sweepKey); return; }
  const ids=JSON.stringify(rows.results.map(row=>row.message_id));
  await env.DB.prepare("UPDATE transports SET next_sync=? WHERE message_id IN (SELECT value FROM json_each(?))")
    .bind(cutoff+3600000,ids).run();
  await syncReplies(env,fetch,undefined,JSON.parse(ids));
}
`;fs.writeFileSync(p,s);
p='apps/api/src/index.ts';s=fs.readFileSync(p,'utf8').replace('scheduleWork, quotaBlocked','scheduleWork, backgroundReplies, quotaBlocked').replace('if (work.replies) await syncReplies(env);','await backgroundReplies(env, _event.scheduledTime || Date.now());');fs.writeFileSync(p,s);
p='apps/api/src/automation.ts';s=fs.readFileSync(p,'utf8').replace('ids ? ids.length : user ? 20 : 500','ids ? ids.length : user ? 2 : 5');fs.writeFileSync(p,s);
