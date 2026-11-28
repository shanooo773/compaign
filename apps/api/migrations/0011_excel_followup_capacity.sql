-- Preserve every approved step and its operational state; the application owns the configurable maximum.
CREATE TABLE followup_steps_upgrade (
 root_id TEXT NOT NULL REFERENCES messages(id),
 step INTEGER NOT NULL CHECK(step>=1),
 child_id TEXT NOT NULL UNIQUE,
 subject TEXT NOT NULL,
 body TEXT NOT NULL,
 delay_value INTEGER NOT NULL CHECK(delay_value>0),
 delay_unit TEXT NOT NULL CHECK(delay_unit IN ('minutes','hours','days')),
 relative_to TEXT NOT NULL CHECK(relative_to IN ('original','previous')),
 authorized_at INTEGER NOT NULL,
 due_at INTEGER,
 next_check_at INTEGER NOT NULL DEFAULT 0,
 queued INTEGER NOT NULL DEFAULT 0,
 cancel_reason TEXT,
 PRIMARY KEY(root_id,step)
);
INSERT INTO followup_steps_upgrade(root_id,step,child_id,subject,body,delay_value,delay_unit,relative_to,authorized_at,due_at,queued,cancel_reason) SELECT root_id,step,child_id,subject,body,delay_value,delay_unit,relative_to,authorized_at,due_at,queued,cancel_reason FROM followup_steps;
DROP TRIGGER sequence_stop;
DROP TRIGGER sequence_send_guard;
DROP TRIGGER sequence_suppression;
DROP TRIGGER sequence_professor_deleted;
DROP TABLE followup_steps;
ALTER TABLE followup_steps_upgrade RENAME TO followup_steps;
CREATE INDEX followup_steps_due ON followup_steps(queued,cancel_reason,next_check_at,due_at);
CREATE TRIGGER sequence_immutable BEFORE UPDATE OF root_id,step,child_id,subject,body,delay_value,delay_unit,relative_to,authorized_at ON followup_steps BEGIN SELECT RAISE(ABORT,'Approved sequence is immutable'); END;
CREATE TRIGGER sequence_cancel_permanent BEFORE UPDATE OF cancel_reason ON followup_steps WHEN OLD.cancel_reason IS NOT NULL AND NEW.cancel_reason IS NOT OLD.cancel_reason BEGIN SELECT RAISE(ABORT,'Cancelled step cannot be rearmed'); END;
CREATE TRIGGER sequence_authorization BEFORE INSERT ON followup_steps WHEN NOT EXISTS (
 SELECT 1 FROM message_authorizations a,json_each(a.snapshot,'$.followup.steps') j
 WHERE a.message_id=NEW.root_id AND a.followup_authorized=1 AND a.authorized_at=NEW.authorized_at
 AND CAST(j.key AS INTEGER)+1=NEW.step AND json_extract(j.value,'$.subject')=NEW.subject
 AND json_extract(j.value,'$.body')=NEW.body AND json_extract(j.value,'$.delay_value')=NEW.delay_value
 AND json_extract(j.value,'$.delay_unit')=NEW.delay_unit AND json_extract(j.value,'$.relative_to')=NEW.relative_to
) BEGIN SELECT RAISE(ABORT,'Exact sequence authorization required'); END;
CREATE TRIGGER sequence_stop AFTER UPDATE OF status ON messages WHEN NEW.status IN ('replied','cancelled','failed') BEGIN
 UPDATE followup_steps SET cancel_reason=COALESCE(cancel_reason,CASE WHEN NEW.status='replied' THEN 'reply' ELSE NEW.status END)
 WHERE root_id=NEW.id OR root_id IN (SELECT root_id FROM followup_steps WHERE child_id=NEW.id);
 UPDATE messages SET status='cancelled' WHERE status IN ('draft','pending') AND id IN (SELECT child_id FROM followup_steps WHERE cancel_reason IS NOT NULL);
END;
CREATE TRIGGER sequence_send_guard BEFORE UPDATE OF state ON transports WHEN NEW.state='submitting' AND EXISTS(SELECT 1 FROM followup_steps WHERE child_id=NEW.message_id) AND NOT EXISTS(
 SELECT 1 FROM followup_steps f JOIN messages root ON root.id=f.root_id JOIN message_authorizations a ON a.message_id=NEW.message_id
 WHERE f.child_id=NEW.message_id AND f.cancel_reason IS NULL AND root.status='sent'
 AND json_extract(a.snapshot,'$.step')=f.step AND json_extract(a.snapshot,'$.sequence_root')=f.root_id
) BEGIN SELECT RAISE(ABORT,'Sequence authorization or reply state changed'); END;
CREATE TRIGGER sequence_suppression AFTER INSERT ON suppressions BEGIN
 UPDATE followup_steps SET cancel_reason=COALESCE(cancel_reason,NEW.reason) WHERE root_id IN (
 SELECT message_id FROM transports WHERE user_id=NEW.user_id AND lower(json_extract(snapshot,'$.recipient'))=NEW.address);
 UPDATE messages SET status='cancelled' WHERE status IN ('draft','pending') AND id IN (SELECT child_id FROM followup_steps WHERE cancel_reason IS NOT NULL);
END;
CREATE TRIGGER sequence_professor_deleted AFTER UPDATE OF deleted_at ON professors WHEN NEW.deleted_at IS NOT NULL BEGIN
 UPDATE followup_steps SET cancel_reason=COALESCE(cancel_reason,'professor_deleted') WHERE root_id IN (SELECT id FROM messages WHERE professor_id=NEW.id);
END;
