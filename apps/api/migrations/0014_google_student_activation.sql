-- Additive Google activation identity/entitlement ledger. No existing records are changed.
CREATE TABLE google_student_identities (
 google_sub TEXT PRIMARY KEY NOT NULL,
 user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
 email TEXT NOT NULL,
 verified_at INTEGER NOT NULL,
 outreach_enabled INTEGER NOT NULL DEFAULT 1 CHECK(outreach_enabled IN (0,1))
);
CREATE TRIGGER google_identity_immutable BEFORE UPDATE OF google_sub,user_id,email,verified_at ON google_student_identities
BEGIN SELECT RAISE(ABORT,'Google identity binding is immutable'); END;
