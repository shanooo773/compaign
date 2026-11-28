// Presentation only: no requests, timers, mutations, or schedule conversion.
export function campaignModels(state: any) {
  const messages: any[] = state.messages || [];
  const authorizations: any[] = state.authorizations || [];
  return (state.campaigns || []).map((campaign: any) => {
    const roots = new Set(authorizations.filter(a => a.campaign_id === campaign.id).map(a => a.message_id));
    const steps = (state.followup_steps || []).filter((f: any) => roots.has(f.root_id));
    const children = new Set(steps.map((f: any) => f.child_id));
    const rows = messages.filter(m => roots.has(m.id) || roots.has(m.parent_id) || children.has(m.id));
    const initial = rows.filter(m => !m.parent_id);
    const pending = initial.filter(m => m.status === 'pending').length;
    const sent = initial.filter(m => confirmed(state, m)).length;
    const pendingSteps = steps.filter((f: any) => {
      const root = messages.find(m => m.id === f.root_id);
      return !f.cancel_reason && root && ['pending','sent'].includes(root.status) &&
        (!f.queued || rows.some(m => m.id === f.child_id && m.status === 'pending'));
    });
    const legacy = (state.automation || []).filter((a: any) => roots.has(a.message_id) && !a.generated && !a.cancel_reason && !steps.some((f: any) => f.root_id === a.message_id) && ['pending','sent'].includes(messages.find(m => m.id === a.message_id)?.status));
    const followups = pendingSteps.length + legacy.length;
    const dates = [...rows.filter(m => m.status === 'pending').map(m => Date.parse(m.scheduled_at)), ...pendingSteps.filter((f: any) => f.due_at != null).map((f: any) => Number(f.due_at)), ...legacy.filter((a: any) => a.due_at != null).map((a: any) => Number(a.due_at))].filter(Number.isFinite);
    const status = campaign.cancelled ? 'cancelled' : pending && !sent ? 'scheduled' : pending || followups ? 'active' : 'completed';
    return {...campaign, roots, rows, initial, steps, pendingSteps, legacy, pending, sent, followups, status,
      next: dates.length ? Math.min(...dates) : null,
      replies: initial.filter(m => m.status === 'replied' || rows.some(child => child.status === 'replied' && (child.parent_id === m.id || steps.some((f: any) => f.root_id === m.id && f.child_id === child.id)))).length};
  });
}
export function confirmed(state: any, message: any) {
  return (state.transports || []).some((t: any) => t.message_id === message.id && t.state === 'confirmed' && t.provider_id) ||
    (state.capabilities?.mock_delivery !== false && !!message.sent_at && ['sent','replied'].includes(message.status));
}
export function campaignForMessage(state: any, id: string) {
  return campaignModels(state).find((c: any) => c.rows.some((m: any) => m.id === id));
}
export function formatSchedule(value: string | number | null | undefined, timezone = 'UTC') {
  if (value == null || !Number.isFinite(new Date(value).getTime())) return 'After the previous confirmed email';
  try {
    return new Intl.DateTimeFormat(undefined, {timeZone: timezone, month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(value)) + ' (' + timezone + ')';
  } catch { return new Date(value).toISOString() + ' (UTC)'; }
}
export function draftGroups(state: any) {
  const rows = (state.messages || []).filter((m: any) => m.status === 'draft' && !m.parent_id && !(state.authorizations || []).some((a: any) => a.message_id === m.id));
  return [...new Set<string>(rows.map((m: any) => m.campaign_import_id || m.id))].map(id => ({id:'draft:'+id,rows:rows.filter((m: any) => (m.campaign_import_id || m.id) === id)}));
}
export const statusName = (value: string) => ({conditional:'Conditional',uncertain:'Confirmation pending',pending:'Scheduled',replied:'Replied',draft:'Draft',active:'Active',scheduled:'Scheduled',completed:'Completed',cancelled:'Cancelled',archived:'Archived',sent:'Sent',failed:'Needs attention'}[value] || value.replaceAll('_',' '));
