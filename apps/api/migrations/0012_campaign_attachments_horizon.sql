-- Widen the legacy single-follow-up horizon without changing existing approved rows.
DROP TRIGGER stop_followup_on_status;
DROP TRIGGER stop_suppressed_recipient;
DROP TRIGGER approved_rule_immutable;
DROP TRIGGER reply_cancellation_reason;
DROP TRIGGER suppression_cancellation_reason;
DROP TRIGGER cancelled_followup_permanent;
DROP TRIGGER unauthorized_rule_blocked;
DROP TRIGGER deleted_professor_cancellation;CREATE TABLE automation_upgrade(message_id TEXT PRIMARY KEY REFERENCES messages(id),days INTEGER NOT NULL CHECK(days BETWEEN 1 AND 60),subject TEXT NOT NULL,body TEXT NOT NULL,generated INTEGER NOT NULL DEFAULT 0,due_at INTEGER,cancel_reason TEXT);
INSERT INTO automation_upgrade SELECT * FROM automation;
DROP TABLE automation;
ALTER TABLE automation_upgrade RENAME TO automation;
CREATE TRIGGER stop_followup_on_status AFTER UPDATE OF status ON messages WHEN NEW.status IN ('replied','cancelled','failed') BEGIN
 UPDATE automation SET generated=1 WHERE message_id=NEW.id;
 UPDATE messages SET status='cancelled' WHERE parent_id=NEW.id AND status IN ('draft','pending');
END;
CREATE TRIGGER stop_suppressed_recipient AFTER INSERT ON suppressions BEGIN
 UPDATE automation SET generated=1 WHERE message_id IN (SELECT message_id FROM transports WHERE user_id=NEW.user_id AND lower(json_extract(snapshot,'$.recipient'))=NEW.address);
 UPDATE messages SET status='cancelled' WHERE user_id=NEW.user_id AND status IN ('draft','pending') AND id IN (SELECT message_id FROM transports WHERE user_id=NEW.user_id AND lower(json_extract(snapshot,'$.recipient'))=NEW.address);
END;
CREATE TRIGGER approved_rule_immutable BEFORE UPDATE OF days,subject,body ON automation WHEN EXISTS(SELECT 1 FROM message_authorizations WHERE message_id=OLD.message_id) AND (NEW.days IS NOT OLD.days OR NEW.subject IS NOT OLD.subject OR NEW.body IS NOT OLD.body) BEGIN SELECT RAISE(ABORT,'Approved follow-up rule is immutable'); END;
CREATE TRIGGER reply_cancellation_reason AFTER UPDATE OF status ON messages WHEN NEW.status='replied' BEGIN UPDATE automation SET cancel_reason=COALESCE(cancel_reason,'reply') WHERE message_id=NEW.id; END;
CREATE TRIGGER suppression_cancellation_reason AFTER INSERT ON suppressions BEGIN UPDATE automation SET cancel_reason=CASE WHEN NEW.reason='professor_deleted' THEN 'professor_deleted' WHEN NEW.reason='bounce' THEN 'bounce' ELSE 'opt_out' END WHERE message_id IN (SELECT message_id FROM transports WHERE user_id=NEW.user_id AND lower(json_extract(snapshot,'$.recipient'))=NEW.address); END;
CREATE TRIGGER cancelled_followup_permanent BEFORE UPDATE OF generated ON automation WHEN OLD.generated=1 AND NEW.generated=0 AND EXISTS(SELECT 1 FROM message_authorizations WHERE message_id=OLD.message_id) BEGIN SELECT RAISE(ABORT,'Cancelled authorized follow-up cannot be rearmed'); END;
CREATE TRIGGER unauthorized_rule_blocked BEFORE INSERT ON automation WHEN EXISTS(SELECT 1 FROM message_authorizations WHERE message_id=NEW.message_id AND followup_authorized=0) AND NOT EXISTS(SELECT 1 FROM followup_approvals WHERE message_id=NEW.message_id AND json_extract(snapshot,'$.days')=NEW.days AND json_extract(snapshot,'$.subject')=NEW.subject AND json_extract(snapshot,'$.body')=NEW.body) BEGIN SELECT RAISE(ABORT,'No automatic follow-up was authorized'); END;
CREATE TRIGGER deleted_professor_cancellation AFTER UPDATE OF deleted_at ON professors WHEN NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL BEGIN
 UPDATE messages SET status='cancelled',error='Professor deleted; no further sending' WHERE professor_id=NEW.id AND user_id=NEW.user_id AND status IN ('draft','pending');
 UPDATE automation SET generated=1,cancel_reason='professor_deleted' WHERE message_id IN (SELECT id FROM messages WHERE professor_id=NEW.id AND user_id=NEW.user_id);
END;ALTER TABLE documents ADD COLUMN retained_until INTEGER;
CREATE TABLE campaign_attachment_pins(root_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,retained_until INTEGER NOT NULL,PRIMARY KEY(root_id,document_id));
CREATE INDEX campaign_pins_document ON campaign_attachment_pins(document_id,retained_until);
CREATE TRIGGER campaign_pin_authorized BEFORE INSERT ON campaign_attachment_pins WHEN NOT EXISTS(SELECT 1 FROM message_authorizations a JOIN documents d ON d.id=NEW.document_id,json_tree(a.snapshot) j WHERE a.message_id=NEW.root_id AND a.user_id=NEW.user_id AND d.user_id=NEW.user_id AND d.storage_state='ready' AND j.type='object' AND json_extract(j.value,'$.id')=d.id AND json_extract(j.value,'$.checksum') IS d.checksum AND json_extract(j.value,'$.size')=d.size) BEGIN SELECT RAISE(ABORT,'Exact approved attachment and ownership required'); END;
CREATE TRIGGER retained_document_guard BEFORE UPDATE OF storage_state ON documents WHEN NEW.storage_state IN ('deleting','deleted') AND EXISTS(SELECT 1 FROM campaign_attachment_pins WHERE document_id=NEW.id) BEGIN SELECT RAISE(ABORT,'Document retained by an approved campaign'); END;

DROP TRIGGER sequence_stop;
CREATE TRIGGER sequence_stop AFTER UPDATE OF status ON messages WHEN NEW.status IN ('replied','cancelled','failed') BEGIN
 UPDATE followup_steps SET cancel_reason=COALESCE(cancel_reason,CASE WHEN NEW.status='replied' THEN 'reply' ELSE NEW.status END)
 WHERE root_id=NEW.id OR root_id IN (SELECT root_id FROM followup_steps WHERE child_id=NEW.id);
 UPDATE messages SET status='cancelled' WHERE status IN ('draft','pending') AND id IN (SELECT child_id FROM followup_steps WHERE cancel_reason IS NOT NULL);
END;

DROP TRIGGER sequence_suppression;
CREATE TRIGGER sequence_suppression AFTER INSERT ON suppressions BEGIN
 UPDATE followup_steps SET cancel_reason=COALESCE(cancel_reason,NEW.reason) WHERE root_id IN (
 SELECT message_id FROM transports WHERE user_id=NEW.user_id AND lower(json_extract(snapshot,'$.recipient'))=NEW.address);
 UPDATE messages SET status='cancelled' WHERE status IN ('draft','pending') AND id IN (SELECT child_id FROM followup_steps WHERE cancel_reason IS NOT NULL);
END;

DROP TRIGGER sequence_professor_deleted;
CREATE TRIGGER sequence_professor_deleted AFTER UPDATE OF deleted_at ON professors WHEN NEW.deleted_at IS NOT NULL BEGIN
 UPDATE followup_steps SET cancel_reason=COALESCE(cancel_reason,'professor_deleted') WHERE root_id IN (SELECT id FROM messages WHERE professor_id=NEW.id);
END;

-- Preserve legacy attachment authorizations without rewriting approved snapshots.
-- Start with the existing object expiry; maintenance renews before that lease ends.
INSERT INTO campaign_attachment_pins(root_id,document_id,user_id,retained_until)
SELECT a.message_id,d.id,a.user_id,COALESCE(d.expires_at,unixepoch()*1000+86400000)
FROM message_authorizations a JOIN messages m ON m.id=a.message_id,
json_tree(a.snapshot,'$.initial.attachments') j JOIN documents d ON d.id=json_extract(j.value,'$.id')
WHERE a.kind='initial' AND m.status IN ('pending','sent') AND d.user_id=a.user_id
AND d.storage_state='ready' AND (d.expires_at IS NULL OR d.expires_at>unixepoch()*1000)
AND j.type='object' AND json_extract(j.value,'$.checksum') IS d.checksum
AND json_extract(j.value,'$.size')=d.size
GROUP BY a.message_id,d.id;
