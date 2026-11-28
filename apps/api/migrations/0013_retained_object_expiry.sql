-- Keep physical KV reservations separate from ordinary document availability.
ALTER TABLE documents ADD COLUMN object_expires_at INTEGER;
UPDATE documents SET object_expires_at=MAX(expires_at,COALESCE(retained_until,0)) WHERE storage_backend='kv' AND expires_at IS NOT NULL;
