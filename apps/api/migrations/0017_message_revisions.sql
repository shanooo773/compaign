-- Additive revision overlay. Original approvals, message rows, transports and schedules are never rewritten.
CREATE TABLE revision_approvals (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 campaign_id TEXT NOT NULL, selection TEXT NOT NULL CHECK(json_valid(selection)), approved_at INTEGER NOT NULL,
 without_attachments_acknowledged INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE message_revisions (
 id TEXT PRIMARY KEY, approval_id TEXT NOT NULL REFERENCES revision_approvals(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 campaign_id TEXT NOT NULL, message_id TEXT NOT NULL, root_id TEXT NOT NULL,
 version INTEGER NOT NULL CHECK(version>0), snapshot TEXT NOT NULL CHECK(json_valid(snapshot)),
 scheduled_at TEXT, timezone TEXT NOT NULL, approved_at INTEGER NOT NULL,
 UNIQUE(message_id,version)
);
CREATE INDEX revisions_owner ON message_revisions(user_id,campaign_id);
CREATE INDEX revisions_root ON message_revisions(root_id,user_id);
CREATE INDEX audit_entity_action ON audit(entity_id,action,user_id);
CREATE VIEW current_message_revisions AS SELECT r.* FROM message_revisions r WHERE r.version=(SELECT MAX(n.version) FROM message_revisions n WHERE n.message_id=r.message_id);
CREATE TRIGGER revision_approval_immutable BEFORE UPDATE ON revision_approvals BEGIN SELECT RAISE(ABORT,'Revision approval is immutable'); END;
CREATE TRIGGER revision_approval_retained BEFORE DELETE ON revision_approvals WHEN EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id) BEGIN SELECT RAISE(ABORT,'Revision approval must be retained'); END;
CREATE TRIGGER revision_immutable BEFORE UPDATE ON message_revisions BEGIN SELECT RAISE(ABORT,'Revision is immutable'); END;
CREATE TRIGGER revision_retained BEFORE DELETE ON message_revisions WHEN EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id) BEGIN SELECT RAISE(ABORT,'Revision audit must be retained'); END;
CREATE TRIGGER revision_current BEFORE INSERT ON message_revisions WHEN
 NEW.version<>COALESCE((SELECT MAX(version) FROM message_revisions WHERE message_id=NEW.message_id),0)+1
 OR NOT EXISTS(SELECT 1 FROM revision_approvals a,json_each(a.selection) j WHERE a.id=NEW.approval_id AND a.user_id=NEW.user_id AND a.campaign_id=NEW.campaign_id AND json_extract(j.value,'$.id')=NEW.message_id AND json_extract(j.value,'$.version')=NEW.version AND json_extract(j.value,'$.snapshot')=NEW.snapshot AND json_extract(j.value,'$.scheduled_at') IS NEW.scheduled_at)
 OR NOT EXISTS(SELECT 1 FROM message_authorizations a JOIN messages root ON root.id=a.message_id JOIN professors p ON p.id=root.professor_id WHERE a.message_id=NEW.root_id AND a.user_id=NEW.user_id AND a.campaign_id=NEW.campaign_id AND root.status IN ('pending','sent') AND p.deleted_at IS NULL AND NEW.timezone=root.timezone
 AND NOT EXISTS(SELECT 1 FROM campaign_workspace_deletions d WHERE d.campaign_id=a.campaign_id)
 AND NOT EXISTS(SELECT 1 FROM audit x WHERE x.entity_id=a.campaign_id AND x.action='campaign.cancelled')
 AND NOT EXISTS(SELECT 1 FROM messages sibling WHERE sibling.status='replied' AND (sibling.id=root.id OR sibling.parent_id=root.id OR sibling.id IN (SELECT child_id FROM followup_steps WHERE root_id=root.id)))
 AND NOT EXISTS(SELECT 1 FROM suppressions s WHERE s.user_id=NEW.user_id AND s.address=lower(json_extract(NEW.snapshot,'$.recipient')))
 AND json_extract(NEW.snapshot,'$.recipient')=json_extract(a.snapshot,'$.initial.recipient'))
 OR NOT (
 EXISTS(SELECT 1 FROM messages m JOIN transports t ON t.message_id=m.id WHERE m.id=NEW.message_id AND m.user_id=NEW.user_id AND m.status='pending' AND m.live_ready=1 AND t.state='waiting' AND t.attempts=0 AND t.lease IS NULL
 AND NOT EXISTS(SELECT 1 FROM delivery_attempts d WHERE d.message_id=m.id)
 AND NOT EXISTS(SELECT 1 FROM deliveries d WHERE d.message_id=m.id)
 AND julianday(COALESCE((SELECT scheduled_at FROM current_message_revisions r WHERE r.message_id=m.id),m.scheduled_at))>julianday('now','+2 minutes')
 AND (m.id=NEW.root_id OR EXISTS(SELECT 1 FROM followup_steps f WHERE f.root_id=NEW.root_id AND f.child_id=m.id AND f.cancel_reason IS NULL)))
 OR EXISTS(SELECT 1 FROM followup_steps f WHERE f.root_id=NEW.root_id AND f.child_id=NEW.message_id AND f.queued=0 AND f.cancel_reason IS NULL
 AND NOT EXISTS(SELECT 1 FROM messages m WHERE m.id=f.child_id)
 AND (COALESCE((SELECT julianday(scheduled_at) FROM current_message_revisions r WHERE r.message_id=f.child_id),2440587.5+f.due_at/86400000.0) IS NULL OR COALESCE((SELECT julianday(scheduled_at) FROM current_message_revisions r WHERE r.message_id=f.child_id),2440587.5+f.due_at/86400000.0)>julianday('now','+2 minutes')))
 )
 OR (NEW.scheduled_at IS NOT NULL AND julianday(NEW.scheduled_at)<=julianday('now','+2 minutes'))
 BEGIN SELECT RAISE(ABORT,'Revision stale or email already being processed; refresh upcoming emails'); END;
-- Reuse existing pins, retention renewal and cleanup. A pin must match an immutable original or revision.
DROP TRIGGER campaign_pin_authorized;
CREATE TRIGGER campaign_pin_authorized BEFORE INSERT ON campaign_attachment_pins WHEN NOT EXISTS(SELECT 1 FROM message_authorizations a JOIN documents d ON d.id=NEW.document_id,json_tree(a.snapshot) j WHERE a.message_id=NEW.root_id AND a.user_id=NEW.user_id AND d.user_id=NEW.user_id AND d.storage_state='ready' AND j.type='object' AND json_extract(j.value,'$.id')=d.id AND json_extract(j.value,'$.checksum') IS d.checksum AND json_extract(j.value,'$.size')=d.size)
 AND NOT EXISTS(SELECT 1 FROM message_revisions r JOIN documents d ON d.id=NEW.document_id,json_each(r.snapshot,'$.attachments') j WHERE r.root_id=NEW.root_id AND r.user_id=NEW.user_id AND d.user_id=NEW.user_id AND d.storage_state='ready' AND json_extract(j.value,'$.id')=d.id AND json_extract(j.value,'$.checksum')=d.checksum AND json_extract(j.value,'$.size')=d.size)
 BEGIN SELECT RAISE(ABORT,'Exact approved attachment and ownership required'); END;
