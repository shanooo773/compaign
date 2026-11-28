-- Additive metadata. Existing approvals, messages and schedules are untouched.
CREATE TABLE campaign_display_names (
 campaign_id TEXT PRIMARY KEY REFERENCES campaign_approvals(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 160), updated_at INTEGER NOT NULL
);
CREATE TABLE reply_locations (
 connection_id TEXT NOT NULL, provider_id TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
 location TEXT NOT NULL, labels TEXT NOT NULL CHECK(json_valid(labels)), checked_at INTEGER NOT NULL,
 PRIMARY KEY(connection_id,provider_id)
);
CREATE TABLE campaign_duplicate_reviews (
 campaign_id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 history TEXT NOT NULL CHECK(json_valid(history)), acknowledged INTEGER NOT NULL CHECK(acknowledged IN (0,1)), created_at INTEGER NOT NULL
);
CREATE TRIGGER duplicate_review_immutable BEFORE UPDATE ON campaign_duplicate_reviews BEGIN SELECT RAISE(ABORT,'Duplicate review is immutable'); END;
CREATE VIEW contacted_initials AS
 SELECT a.user_id,a.campaign_id,a.message_id,lower(trim(json_extract(a.snapshot,'$.initial.recipient'))) address,
 m.status,m.sent_at,m.scheduled_at,
 CASE WHEN m.sent_at IS NOT NULL OR t.state IN ('confirmed','uncertain','submitting') OR EXISTS(SELECT 1 FROM delivery_attempts d WHERE d.message_id=m.id AND d.outcome!='failed_before_send') THEN 1 ELSE 0 END submitted
 FROM message_authorizations a JOIN messages m ON m.id=a.message_id LEFT JOIN transports t ON t.message_id=m.id
 WHERE a.kind='initial' AND m.parent_id IS NULL
 UNION ALL
 SELECT m.user_id,'legacy:'||m.id,m.id,lower(trim(COALESCE(m.approved_recipient,json_extract(t.snapshot,'$.recipient'),p.email))),m.status,m.sent_at,m.scheduled_at,
 CASE WHEN m.sent_at IS NOT NULL OR t.state IN ('confirmed','uncertain','submitting') OR EXISTS(SELECT 1 FROM delivery_attempts d WHERE d.message_id=m.id AND d.outcome!='failed_before_send') THEN 1 ELSE 0 END
 FROM messages m JOIN professors p ON p.id=m.professor_id LEFT JOIN transports t ON t.message_id=m.id
 WHERE m.parent_id IS NULL AND NOT EXISTS(SELECT 1 FROM message_authorizations a WHERE a.message_id=m.id) AND (m.sent_at IS NOT NULL OR m.live_ready=1);
CREATE TRIGGER campaign_duplicate_fence BEFORE INSERT ON campaign_approvals
 WHEN EXISTS (
 SELECT 1 FROM contacted_initials old JOIN json_each(NEW.selection) selected
 ON old.address=lower(trim(json_extract(selected.value,'$.snapshot.recipient')))
 WHERE old.user_id=NEW.user_id AND (old.submitted=1 OR old.status='pending')
 AND NOT EXISTS(SELECT 1 FROM campaign_duplicate_reviews r,json_each(r.history) h
 WHERE r.campaign_id=NEW.id AND r.user_id=NEW.user_id AND r.acknowledged=1
 AND json_extract(h.value,'$.message_id')=old.message_id
 AND json_extract(h.value,'$.address')=old.address))
 BEGIN SELECT RAISE(ABORT,'Duplicate history changed; review recipients again'); END;
CREATE VIEW outgoing_submissions AS
 SELECT d.id,d.started_at,t.user_id,c.provider,c.subject mailbox FROM delivery_attempts d JOIN transports t ON t.message_id=d.message_id JOIN connections c ON c.id=t.connection_id WHERE d.outcome!='failed_before_send'
 UNION ALL
 SELECT 'legacy:'||d.message_id,CAST((julianday(d.created_at)-2440587.5)*86400000 AS INTEGER),m.user_id,c.provider,c.subject FROM deliveries d JOIN messages m ON m.id=d.message_id JOIN transports t ON t.message_id=m.id JOIN connections c ON c.id=t.connection_id WHERE d.provider!='mock' AND NOT EXISTS(SELECT 1 FROM delivery_attempts a WHERE a.message_id=d.message_id);
CREATE INDEX delivery_attempt_window ON delivery_attempts(started_at,message_id);
CREATE TRIGGER rolling_submission_allowance BEFORE INSERT ON delivery_attempts
 WHEN EXISTS(SELECT 1 FROM transports t JOIN connections c ON c.id=t.connection_id WHERE t.message_id=NEW.message_id AND (
 (SELECT count(*) FROM outgoing_submissions s WHERE s.started_at>NEW.started_at-86400000 AND s.user_id=t.user_id)>=50 OR
 (SELECT count(*) FROM outgoing_submissions s WHERE s.started_at>NEW.started_at-86400000 AND s.provider=c.provider AND s.mailbox=c.subject)>=50 OR
 EXISTS(SELECT 1 FROM outgoing_submissions s WHERE s.started_at>NEW.started_at-60000 AND (s.user_id=t.user_id OR (s.provider=c.provider AND s.mailbox=c.subject)))
 )) BEGIN SELECT RAISE(ABORT,'Rolling sending allowance exhausted'); END;
