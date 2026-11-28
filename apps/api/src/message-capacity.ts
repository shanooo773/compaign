import { type Env } from './runtime';
import { MESSAGE_CAPACITY } from '../../../shared/message-capacity';
export async function messageCapacity(env: Env, user: string, importId?: string | null) {
 const usage = await env.DB.prepare('SELECT count(*) global_used,COALESCE(SUM(user_id=?),0) student_used FROM active_message_capacity').bind(user).first<{global_used:number;student_used:number}>();
 const existing = importId ? await env.DB.prepare("SELECT 1 ok FROM campaign_imports WHERE user_id=? AND id=?").bind(user,importId).first() : null;
 return { ...MESSAGE_CAPACITY, existing_import: !!existing, student_used: usage!.student_used, global_used: usage!.global_used,
  student_available: Math.max(0,MESSAGE_CAPACITY.student-usage!.student_used),
  global_available: Math.max(0,MESSAGE_CAPACITY.global-usage!.global_used) };
}
