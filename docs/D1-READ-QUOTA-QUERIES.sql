-- 1. Seven-day Insights: total reads=29156553; executions=479; average reads=60869; total writes=0
SELECT c.id,COALESCE((SELECT n.name FROM campaign_display_names n WHERE n.campaign_id=c.id AND n.user_id=c.user_id),NULLIF(NULLIF(trim(c.name),''),'Professor outreach campaign'),'Existing Campaign ? ' || date(c.approved_at/1000,'unixepoch')) name,c.approved_at,c.initial_count,c.followup_count,c.sending_account_id,(SELECT archived_at FROM campaign_archives ar WHERE ar.campaign_id=c.id AND ar.user_id=c.user_id) archived_at,(NOT EXISTS (
 SELECT 1 FROM messages m WHERE m.user_id=c.user_id AND
 (m.id IN (SELECT message_id FROM message_authorizations WHERE user_id=c.user_id AND campaign_id=c.id)
 OR m.parent_id IN (SELECT message_id FROM message_authorizations WHERE user_id=c.user_id AND campaign_id=c.id)
 OR m.id IN (SELECT f.child_id FROM followup_steps f JOIN message_authorizations a ON a.message_id=f.root_id WHERE a.user_id=c.user_id AND a.campaign_id=c.id))
 AND (m.status IN ('draft','pending') OR EXISTS (SELECT 1 FROM transports t WHERE t.message_id=m.id AND t.state IN ('leased','submitting','uncertain')))
) AND NOT EXISTS (
 SELECT 1 FROM followup_steps f JOIN message_authorizations a ON a.message_id=f.root_id
 WHERE a.user_id=c.user_id AND a.campaign_id=c.id AND f.cancel_reason IS NULL
 AND (f.queued=0 OR NOT EXISTS(SELECT 1 FROM messages child WHERE child.id=f.child_id AND child.status IN ('sent','replied','failed','cancelled')))
) AND NOT EXISTS (
 SELECT 1 FROM automation f JOIN message_authorizations a ON a.message_id=f.message_id
 WHERE a.user_id=c.user_id AND a.campaign_id=c.id AND f.generated=0 AND f.cancel_reason IS NULL
)) can_archive,EXISTS(SELECT 1 FROM audit WHERE action='campaign.cancelled' AND entity_id=c.id AND user_id=c.user_id) cancelled FROM campaign_approvals c WHERE c.user_id=? AND NOT EXISTS(SELECT 1 FROM campaign_workspace_deletions d WHERE d.campaign_id=c.id AND d.user_id=c.user_id AND d.state='deleted') ORDER BY c.approved_at DESC;

-- 2. Seven-day Insights: total reads=4333616; executions=2529; average reads=1713; total writes=0
SELECT f.*,r.snapshot revision_snapshot,COALESCE(r.version,0) revision_version,r.scheduled_at revision_schedule,m.user_id,m.professor_id,m.timezone,COALESCE(root_revision.snapshot,t.snapshot) snapshot,auth.snapshot authorization,t.connection_id,t.thread_id,
    c.status account_status,c.scopes,COALESCE(prev.child_id,m.id) parent_id
    FROM followup_steps f JOIN messages m ON m.id=f.root_id JOIN transports t ON t.message_id=m.id
    LEFT JOIN message_authorizations auth ON auth.message_id=m.id
    JOIN connections c ON c.id=t.connection_id JOIN profiles p ON p.user_id=m.user_id
    LEFT JOIN followup_steps prev ON prev.root_id=f.root_id AND prev.step=f.step-1
    LEFT JOIN current_message_revisions r ON r.message_id=f.child_id
    LEFT JOIN current_message_revisions root_revision ON root_revision.message_id=m.id
    WHERE f.queued=0 AND f.cancel_reason IS NULL AND COALESCE(CAST(round((julianday(r.scheduled_at)-2440587.5)*86400000) AS INTEGER),f.due_at)<=? AND f.next_check_at<=? AND m.status='sent' AND c.status='connected'
    AND p.paused=0 AND p.stopped=0 AND (f.step=1 OR EXISTS(SELECT 1 FROM messages prior JOIN transports pt ON pt.message_id=prior.id WHERE prior.id=prev.child_id AND prior.status='sent' AND pt.state='confirmed'))
    ORDER BY f.next_check_at,f.due_at,f.root_id,f.step LIMIT ?;

-- 3. Seven-day Insights: total reads=1564914; executions=2586; average reads=605; total writes=0
DELETE FROM campaign_attachment_pins WHERE NOT EXISTS(
    SELECT 1 FROM messages root WHERE root.id=campaign_attachment_pins.root_id AND
    (root.status='pending' OR (root.status='sent' AND (
      EXISTS(SELECT 1 FROM followup_steps f LEFT JOIN messages child ON child.id=f.child_id
        WHERE f.root_id=root.id AND f.cancel_reason IS NULL AND (child.status IS NULL OR child.status='pending')) OR
      EXISTS(SELECT 1 FROM automation a WHERE a.message_id=root.id AND a.generated=0 AND a.cancel_reason IS NULL) OR
      EXISTS(SELECT 1 FROM messages child WHERE child.parent_id=root.id AND child.status='pending')))));

-- 4. Seven-day Insights: total reads=1180321; executions=2673; average reads=441; total writes=142
UPDATE followup_steps SET due_at=(
    SELECT CAST(round((julianday(base.sent_at)-2440587.5)*86400000) AS INTEGER)
    FROM messages base WHERE base.id=CASE WHEN followup_steps.relative_to='original' OR followup_steps.step=1
    THEN followup_steps.root_id ELSE (SELECT prev.child_id FROM followup_steps prev WHERE prev.root_id=followup_steps.root_id AND prev.step=followup_steps.step-1) END
    AND base.sent_at IS NOT NULL) + delay_value * CASE delay_unit WHEN 'minutes' THEN 60000 WHEN 'hours' THEN 3600000 ELSE 86400000 END
    WHERE due_at IS NULL AND queued=0 AND cancel_reason IS NULL
    AND EXISTS (
      SELECT 1 FROM messages base
      WHERE base.id=CASE WHEN followup_steps.relative_to='original' OR followup_steps.step=1
      THEN followup_steps.root_id ELSE (SELECT prev.child_id FROM followup_steps prev WHERE prev.root_id=followup_steps.root_id AND prev.step=followup_steps.step-1) END
      AND julianday(base.sent_at) IS NOT NULL
    );

-- 5. Seven-day Insights: total reads=634437; executions=2591; average reads=244; total writes=0
SELECT a.*,(SELECT snapshot FROM message_authorizations auth WHERE auth.message_id=m.id) authorization,m.user_id,m.professor_id,m.timezone,m.sent_at,t.connection_id,t.thread_id,t.snapshot,t.sync_checked_at,t.sync_cursor,c.status AS account_status,c.scopes FROM automation a JOIN messages m ON m.id=a.message_id JOIN transports t ON t.message_id=m.id JOIN connections c ON c.id=t.connection_id JOIN profiles p ON p.user_id=m.user_id WHERE a.generated=0 AND NOT EXISTS(SELECT 1 FROM professors pr WHERE pr.id=m.professor_id AND pr.deleted_at IS NOT NULL) AND m.live_ready=1 AND m.parent_id IS NULL AND m.status='sent' AND p.paused=0 AND p.stopped=0 AND c.status='connected' AND COALESCE(a.due_at,CAST((julianday(m.sent_at)-2440587.5)*86400000 AS INTEGER)+a.days*86400000)<=? ORDER BY COALESCE(a.due_at,0),a.message_id LIMIT ?;

-- 6. Seven-day Insights: total reads=414405; executions=4878; average reads=84; total writes=0
SELECT t.*,m.sent_at,c.provider,c.status AS account_status,c.scopes,c.tokens,c.expires_at,c.refresh_until,c.refresh_lease FROM transports t JOIN messages m ON m.id=t.message_id JOIN connections c ON c.id=t.connection_id WHERE t.state='confirmed' AND t.thread_id IS NOT NULL AND (t.next_sync<=? OR t.message_id IN (SELECT value FROM json_each(?))) AND c.status='connected' AND NOT EXISTS(SELECT 1 FROM message_authorizations auth JOIN campaign_workspace_deletions d ON d.campaign_id=auth.campaign_id AND d.user_id=auth.user_id WHERE auth.message_id=m.id AND d.state='deleted') AND m.sent_at>? AND (? IS NULL OR t.user_id=?) AND (? IS NULL OR t.message_id IN (SELECT value FROM json_each(?))) ORDER BY t.next_sync LIMIT ?;

-- 7. Seven-day Insights: total reads=396900; executions=2681; average reads=148; total writes=0
SELECT t.*,r.snapshot revision_snapshot,COALESCE(r.version,0) revision_version,c.provider,c.address,c.subject AS account_subject,c.status AS account_status,c.scopes,c.tokens,c.expires_at,c.refresh_until,c.refresh_lease,m.status AS message_status,m.parent_id FROM transports t JOIN messages m ON m.id=t.message_id JOIN connections c ON c.id=t.connection_id JOIN profiles p ON p.user_id=t.user_id LEFT JOIN current_message_revisions r ON r.message_id=t.message_id WHERE t.state IN ('waiting','uncertain') AND t.next_at<=? AND ((t.state='uncertain') OR (?=1 AND m.status='pending' AND m.live_ready=1 AND NOT EXISTS(SELECT 1 FROM professors pr WHERE pr.id=m.professor_id AND pr.deleted_at IS NOT NULL) AND m.approved=1 AND (m.mode!='auto' OR m.authorized=1) AND COALESCE(r.scheduled_at,m.scheduled_at)<=? AND p.paused=0 AND p.stopped=0)) ORDER BY t.next_at,t.message_id LIMIT ?;

-- 8. Seven-day Insights: total reads=270324; executions=327; average reads=826; total writes=0
SELECT f.root_id,f.step,f.child_id,COALESCE(json_extract(r.snapshot,'$.subject'),f.subject) subject,COALESCE(json_extract(r.snapshot,'$.body'),f.body) body,f.delay_value,f.delay_unit,f.relative_to,f.authorized_at,COALESCE(CAST(round((julianday(r.scheduled_at)-2440587.5)*86400000) AS INTEGER),f.due_at) due_at,f.next_check_at,f.queued,f.cancel_reason,m.status root_status,c.status account_status,t.sync_checked_at,last.status sending_status,ct.state transport_state,ct.provider_id,ct.next_at,last.error FROM followup_steps f JOIN messages m ON m.id=f.root_id JOIN transports t ON t.message_id=m.id JOIN connections c ON c.id=t.connection_id LEFT JOIN messages last ON last.id=f.child_id LEFT JOIN transports ct ON ct.message_id=f.child_id LEFT JOIN current_message_revisions r ON r.message_id=f.child_id WHERE m.user_id=? ORDER BY f.root_id,f.step;

-- 9. Seven-day Insights: total reads=208693; executions=376; average reads=555; total writes=0
SELECT m.*,r.snapshot revision_snapshot,r.scheduled_at revision_schedule,r.version revision_version,CASE WHEN a.message_id IS NOT NULL AND a.generated=0 THEN json_object('days',a.days,'subject',a.subject,'body',a.body) END effective_followup,p.name professor_name,COALESCE(CASE WHEN json_valid(t.snapshot) THEN json_extract(t.snapshot,'$.recipient') END,m.approved_recipient,p.email) professor_email FROM messages m JOIN professors p ON p.id=m.professor_id LEFT JOIN transports t ON t.message_id=m.id LEFT JOIN automation a ON a.message_id=m.id LEFT JOIN current_message_revisions r ON r.message_id=m.id WHERE m.user_id=? AND NOT EXISTS(SELECT 1 FROM message_authorizations auth JOIN campaign_workspace_deletions d ON d.campaign_id=auth.campaign_id AND d.user_id=auth.user_id WHERE auth.message_id=m.id AND d.state='deleted') ORDER BY m.created_at DESC;

-- 10. Seven-day Insights: total reads=156843; executions=2563; average reads=61; total writes=184
DELETE FROM usage_counters WHERE rowid IN (SELECT rowid FROM usage_counters WHERE period<date('now','-2 days') LIMIT ?);

-- 11. Seven-day Insights: total reads=123221; executions=434; average reads=283; total writes=0
SELECT DISTINCT lower(json_extract(t.snapshot,'$.recipient')) address FROM transports t JOIN deliveries d ON d.message_id=t.message_id WHERE t.user_id=? AND d.provider='gmail' AND t.state='confirmed' AND t.provider_id IS NOT NULL;

-- 12. Seven-day Insights: total reads=111364; executions=287; average reads=388; total writes=0
SELECT a.* FROM delivery_attempts a JOIN messages m ON m.id=a.message_id WHERE m.user_id=? ORDER BY a.started_at DESC LIMIT ?;

-- 13. Seven-day Insights: total reads=101205; executions=434; average reads=233; total writes=0
SELECT message_id,connection_id,state,provider_id,thread_id,attempts,next_at,sync_checked_at,sync_error FROM transports WHERE user_id=?;

-- 14. Seven-day Insights: total reads=94866; executions=1396; average reads=67; total writes=282
INSERT OR IGNORE INTO messages(id,user_id,professor_id,subject,body,mode,authorized,approved,status,scheduled_at,timezone,parent_id,live_ready)
      SELECT ?,?,?,?,?,'auto',1,1,'pending',?,?,?,1 WHERE EXISTS(SELECT 1 FROM followup_steps f JOIN messages m ON m.id=f.root_id JOIN connections c ON c.id=? WHERE f.root_id=? AND f.step=? AND f.queued=0 AND f.cancel_reason IS NULL AND m.status='sent' AND c.status='connected' AND COALESCE((SELECT version FROM current_message_revisions r WHERE r.message_id=f.child_id),0)=?)
      AND NOT EXISTS(SELECT 1 FROM suppressions WHERE user_id=? AND address=?)
      AND NOT EXISTS(SELECT 1 FROM professors WHERE id=? AND deleted_at IS NOT NULL);

-- 15. Seven-day Insights: total reads=85599; executions=337; average reads=254; total writes=0
SELECT count(*) sent,MIN(started_at)+86400000 next_available_at,MAX(started_at)+60000 pacing_available_at FROM outgoing_submissions WHERE provider=? AND mailbox=? AND started_at>?;

-- 16. Seven-day Insights: total reads=80402; executions=328; average reads=245; total writes=0
SELECT count(*) sent,MIN(started_at)+86400000 next_available_at,MAX(started_at)+60000 pacing_available_at FROM outgoing_submissions WHERE user_id=? AND started_at>?;

-- 17. Seven-day Insights: total reads=75689; executions=421; average reads=179; total writes=0
SELECT * FROM message_attachments WHERE user_id=?;

-- 18. Seven-day Insights: total reads=73436; executions=325; average reads=225; total writes=0
SELECT * FROM message_authorizations WHERE user_id=? ORDER BY authorized_at DESC;

-- 19. Seven-day Insights: total reads=47200; executions=472; average reads=100; total writes=0
SELECT * FROM audit WHERE user_id=? ORDER BY created_at DESC,rowid DESC LIMIT ?;

-- 20. Seven-day Insights: total reads=43104; executions=2694; average reads=16; total writes=0
UPDATE documents SET retained_until=(SELECT MAX(retained_until) FROM campaign_attachment_pins p WHERE p.document_id=documents.id)
    WHERE retained_until IS NOT (SELECT MAX(retained_until) FROM campaign_attachment_pins p WHERE p.document_id=documents.id);
