import { syncReplies } from "./automation";
﻿import type { Env } from "./runtime";
export function scheduleWork(time: number) {
  const minute = Math.floor(time / 60000);
  return { replies: minute % 60 === 0, maintenance: minute % 15 === 2 };
}
export function d1QuotaError(error: unknown) {
  return /(?:D1|SQLITE).*(?:quota|rows? read|rows? written|daily.*limit)|(?:quota|daily.*limit).*(?:D1|rows? read|rows? written)/i.test(String(error instanceof Error ? error.message : error));
}
const blocked = new WeakMap<Env, number>();
const key = "scheduler:d1-quota-backoff:v1";
export async function quotaBlocked(env: Env) {
  if (Date.now() < (blocked.get(env) || 0)) return true;
  const value = await env.DOCUMENTS_KV!.get(key);
  const blockedUntil = Number(value) || 0;
  blocked.set(env, blockedUntil);
  return Date.now() < blockedUntil;
}
export async function backoffQuota(env: Env) {
  const now = new Date();
  const blockedUntil = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) + 60000;
  blocked.set(env, blockedUntil);
  await env.DOCUMENTS_KV!.put(key, String(blockedUntil), {expirationTtl: Math.max(60, Math.ceil((blockedUntil - Date.now()) / 1000))});
  console.warn("d1_quota_backoff", {until: blockedUntil});
}

// Start one sweep hourly and drain five threads per minute, keeping Gmail calls bounded.
// A failed thread waits until the next sweep; mandatory send-time checks bypass this gate.
export async function backgroundReplies(env: Env, time: number) {
  const sweepKey = "scheduler:reply-sweep:v1";
  if (scheduleWork(time).replies)
    await env.DOCUMENTS_KV!.put(sweepKey, String(time), {expirationTtl: 7200});
  const cutoff = Number(await env.DOCUMENTS_KV!.get(sweepKey));
  if (!cutoff) return;
  const rows = await env.DB.prepare(`SELECT t.message_id FROM transports t
    JOIN messages m ON m.id=t.message_id JOIN connections c ON c.id=t.connection_id
    WHERE t.state='confirmed' AND t.next_sync<=? AND t.thread_id IS NOT NULL
    AND c.status='connected' AND m.sent_at>?
    AND NOT EXISTS(SELECT 1 FROM message_authorizations a JOIN campaign_workspace_deletions d
      ON d.campaign_id=a.campaign_id AND d.user_id=a.user_id WHERE a.message_id=m.id AND d.state='deleted')
    ORDER BY t.next_sync LIMIT 5`).bind(cutoff,new Date(time-67*86400000).toISOString()).all<{message_id:string}>();
  if (!rows.results.length) { await env.DOCUMENTS_KV!.delete(sweepKey); return; }
  const ids=JSON.stringify(rows.results.map(row=>row.message_id));
  await env.DB.prepare("UPDATE transports SET next_sync=? WHERE message_id IN (SELECT value FROM json_each(?))")
    .bind(cutoff+3600000,ids).run();
  await syncReplies(env,fetch,undefined,JSON.parse(ids),cutoff+3600000);
}
