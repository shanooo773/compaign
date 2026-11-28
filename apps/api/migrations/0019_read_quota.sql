-- Additive, narrow indexes: one lookup for campaign children; due dates before retry times.
CREATE INDEX IF NOT EXISTS messages_parent_status ON messages(parent_id,status);
CREATE INDEX IF NOT EXISTS followup_active_due ON followup_steps(due_at,next_check_at) WHERE queued=0 AND cancel_reason IS NULL;
CREATE INDEX IF NOT EXISTS mailbox_events_message ON mailbox_events(connection_id,message_id);
