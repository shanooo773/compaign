const fs=require('node:fs'),assert=require('node:assert/strict');
const p='apps/api/src/index.ts';let s=fs.readFileSync(p,'utf8');s='import { scheduleWork, quotaBlocked, d1QuotaError, backoffQuota } from "./read-quota";\n'+s;
s=s.replace('    await env.DB.prepare(\n      "INSERT INTO scheduler_health','    if (await quotaBlocked(env)) return;\n    try {\n    await env.DB.prepare(\n      "INSERT INTO scheduler_health').replace('    await env.DB.prepare(\r\n      "INSERT INTO scheduler_health','    if (await quotaBlocked(env)) return;\n    try {\n    await env.DB.prepare(\r\n      "INSERT INTO scheduler_health');
const start=s.indexOf('    try {\n      // Mock scheduling');const startCR=s.indexOf('    try {\r\n      // Mock scheduling');const a=start>=0?start:startCR;assert(a>0);
const b=s.indexOf('        await checkGmail(env);',a);assert(b>a);
s=s.slice(0,a)+`      // Sending and due follow-ups run on every minute tick; stored schedules are untouched.
      await runJobs(env);
      await queueFollowups(env);
      await queueSequence(env);
      await runLiveJobs(env);
      const work = scheduleWork(_event.scheduledTime || Date.now());
      if (work.replies) await syncReplies(env);
      if (work.maintenance) {
`+s.slice(b);
const c=s.lastIndexOf('    } catch (error) {');assert(c>a);s=s.slice(0,c)+s.slice(c).replace('    } catch (error) {','    } catch (error) {\n      if (d1QuotaError(error)) {\n        await backoffQuota(env);\n        return;\n      }');fs.writeFileSync(p,s);
// Global Gmail polling reservations are separate from the immutable 50-send allowance.
const f='apps/api/src/automation.ts';s=fs.readFileSync(f,'utf8').replaceAll('"mailbox:global:polls", 1000','"mailbox:global:polls", 20000');s=s.replace('WHERE reply_locations.user_id=excluded.user_id','WHERE reply_locations.user_id=excluded.user_id AND (reply_locations.location IS NOT excluded.location OR reply_locations.labels IS NOT excluded.labels)');s=s.replace('WHERE notifications.user_id=excluded.user_id','WHERE notifications.user_id=excluded.user_id AND (notifications.kind IS NOT excluded.kind OR notifications.message IS NOT excluded.message)');fs.writeFileSync(f,s);
