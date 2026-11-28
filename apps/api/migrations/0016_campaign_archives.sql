-- Archive metadata only. Approved content, schedules and sending receipts are unchanged.
CREATE TABLE campaign_archives (
 campaign_id TEXT PRIMARY KEY REFERENCES campaign_approvals(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 archived_at INTEGER NOT NULL
);
CREATE INDEX campaign_archives_owner ON campaign_archives(user_id,campaign_id);

-- Workspace deletion preserves immutable approval/sending/contact audit tables.
CREATE TABLE campaign_workspace_deletions (
 campaign_id TEXT PRIMARY KEY REFERENCES campaign_approvals(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 campaign_name TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('deleting','deleted')),
 lease TEXT, lease_until INTEGER NOT NULL DEFAULT 0, started_at INTEGER NOT NULL, completed_at INTEGER
);
CREATE INDEX campaign_deletions_owner ON campaign_workspace_deletions(user_id,campaign_id);
CREATE TABLE campaign_deletion_documents (
 campaign_id TEXT NOT NULL REFERENCES campaign_approvals(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 document_id TEXT NOT NULL REFERENCES documents(id), PRIMARY KEY(campaign_id,document_id)
);

-- Ownership-scoped cleanup and shared-document checks use indexed lookups.
CREATE INDEX notifications_campaign_entity ON notifications(user_id,entity_id);
CREATE INDEX message_attachments_document ON message_attachments(document_id);
