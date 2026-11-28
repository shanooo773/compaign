import { MAX_SEQUENCE_DAYS } from "../../../shared/followup-sequence";
import { type Env, HttpError, hash, consume } from "./runtime";
import { validatePdf } from "./pdf-validation";
export const FILE_LIMIT = 2 * 1024 * 1024;
export const USER_BYTES = 20 * 1024 * 1024;
export const TOTAL_BYTES = 100 * 1024 * 1024;
export const DOCUMENT_TTL = 30 * 86400;
export interface DocumentStore {
  put(key: string, bytes: ArrayBuffer, ttl?: number): Promise<void>;
  get(key: string): Promise<ArrayBuffer | null>;
  delete(key: string): Promise<void>;
}
export function documentStore(env: Env, backend = "kv"): DocumentStore {
  if (backend === "r2" && env.DOCUMENTS)
    return {
      put: async (key, bytes) => {
        await env.DOCUMENTS!.put(key, bytes);
      },
      get: async (key) => {
        const obj = await env.DOCUMENTS!.get(key);
        return obj ? obj.arrayBuffer() : null;
      },
      delete: (key) => env.DOCUMENTS!.delete(key),
    };
  if (backend !== "kv" || !env.DOCUMENTS_KV)
    throw new HttpError(503, "Private storage is not configured.");
  return {
    put: (key, bytes, ttl = DOCUMENT_TTL) =>
      env.DOCUMENTS_KV!.put(key, bytes, { expirationTtl: ttl }),
    get: (key) => env.DOCUMENTS_KV!.get(key, "arrayBuffer"),
    delete: (key) => env.DOCUMENTS_KV!.delete(key),
  };
}
export function safeFilename(name: string) {
  return (
    name
      .normalize("NFKC")
      .replace(/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069/\\]/g, "_")
      .slice(0, 80) || "document"
  );
}
function safeDocx(bytes: Uint8Array): boolean {
  if (
    bytes.length < 22 ||
    bytes[0] !== 80 ||
    bytes[1] !== 75 ||
    bytes[2] !== 3 ||
    bytes[3] !== 4
  )
    return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (
    let offset = bytes.length - 22;
    offset >= Math.max(0, bytes.length - 65557);
    offset--
  ) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      end = offset;
      break;
    }
  }
  if (
    end < 0 ||
    view.getUint16(end + 4, true) !== 0 ||
    view.getUint16(end + 6, true) !== 0 ||
    end + 22 + view.getUint16(end + 20, true) !== bytes.length
  )
    return false;
  const entries = view.getUint16(end + 10, true),
    start = view.getUint32(end + 16, true),
    length = view.getUint32(end + 12, true);
  if (
    entries > 500 ||
    view.getUint16(end + 8, true) !== entries ||
    start + length !== end
  )
    return false;
  const names = new Set<string>();
  let cursor = start,
    expanded = 0;
  for (let entry = 0; entry < entries; entry++) {
    if (
      cursor + 46 > end ||
      view.getUint32(cursor, true) !== 0x02014b50 ||
      view.getUint16(cursor + 8, true) & 1
    )
      return false;
    const compression = view.getUint16(cursor + 10, true);
    if (compression !== 0 && compression !== 8) return false;
    expanded += view.getUint32(cursor + 24, true);
    if (expanded > 20 * 1024 * 1024) return false;
    const size = view.getUint16(cursor + 28, true),
      extra = view.getUint16(cursor + 30, true),
      comment = view.getUint16(cursor + 32, true);
    if (size > 512 || cursor + 46 + size + extra + comment > end) return false;
    const name = new TextDecoder().decode(
      bytes.subarray(cursor + 46, cursor + 46 + size),
    );
    if (
      name.startsWith("/") ||
      name.includes("\\") ||
      name.split("/").includes("..") ||
      /\.(bin|exe|js|vbs|scr)$/i.test(name)
    )
      return false;
    names.add(name);
    cursor += 46 + size + extra + comment;
  }
  return (
    cursor === end &&
    names.has("[Content_Types].xml") &&
    names.has("word/document.xml")
  );
}
export async function validateDocumentFile(file: File) {
  if (!file.size) throw new HttpError(400, "Document is empty.");
  if (file.size > FILE_LIMIT)
    throw new HttpError(400, "Document exceeds the 2 MiB per-file limit.");
  const bytes = await file.arrayBuffer(),
    data = new Uint8Array(bytes);
  // Storage truncation must not remove the extension before validation.
  const name = file.name.normalize("NFKC").toLowerCase();
  let pdf = false;
  if (name.endsWith(".pdf")) {
    const mime = file.type.split(";", 1)[0].trim().toLowerCase();
    if (
      ![
        "",
        "application/pdf",
        "application/x-pdf",
        "application/octet-stream",
      ].includes(mime)
    )
      throw new HttpError(
        400,
        "PDF MIME type conflicts with its extension. Select a PDF reported as application/pdf or a generic binary file.",
      );
    await validatePdf(data);
    pdf = true;
  } else if (!name.endsWith(".docx") && !name.endsWith(".txt")) {
    throw new HttpError(
      400,
      "Unsupported document extension. Use .pdf, .docx or .txt.",
    );
  }
  const docx =
    file.type ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" &&
    name.endsWith(".docx") &&
    safeDocx(data);
  let text = false;
  if (file.type === "text/plain" && name.endsWith(".txt")) {
    try {
      const decoded = new TextDecoder("utf-8", {
        fatal: true,
        ignoreBOM: false,
      }).decode(bytes);
      text = !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(decoded);
    } catch {
      /* Reject invalid UTF-8. */
    }
  }
  if (!pdf && !docx && !text)
    throw new HttpError(
      400,
      name.endsWith(".docx")
        ? "DOCX MIME type or ZIP structure is invalid or contains unsupported entries."
        : "TXT must have MIME type text/plain and contain valid UTF-8 text without binary control characters.",
    );
  return bytes;
}
export async function uploadDocument(req: Request, env: Env, user: string) {
  const store = documentStore(env);
  // Bound the body even when Content-Length is absent or forged.
  const reader = req.body?.getReader();
  if (!reader) throw new HttpError(400, "Choose a document.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    size += next.value.byteLength;
    if (size > FILE_LIMIT + 65536) {
      await reader.cancel();
      throw new HttpError(413, "Upload body is too large.");
    }
    chunks.push(next.value);
  }
  const payload = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    payload.set(c, offset);
    offset += c.length;
  }
  let form: FormData;
  try {
    form = await new Response(payload, {
      headers: { "Content-Type": req.headers.get("Content-Type") || "" },
    }).formData();
  } catch {
    throw new HttpError(400, "Invalid multipart upload.");
  }
  const file = form.get("file") as unknown as File | string | null;
  if (!file || typeof file === "string")
    throw new HttpError(400, "Choose a document.");
  const bytes = await validateDocumentFile(file),
    checksum = await hash(bytes),
    docId = crypto.randomUUID(),
    key = `${user}/${docId}`;
  await consume(env, "kv-write:global", 100);
  await consume(env, `kv-write:${user}`, 10);
  const reserved = await env.DB.prepare(
    `INSERT INTO documents(id,user_id,name,object_key,content_type,size,storage_backend,storage_state,checksum,expires_at) SELECT ?,?,?,?,?,?,'kv','uploading',?,? WHERE (SELECT COALESCE(SUM(size),0) FROM documents WHERE user_id=? AND storage_state!='deleted')+?<=? AND (SELECT count(*) FROM documents WHERE user_id=? AND storage_state!='deleted')<10 AND (SELECT COALESCE(SUM(size),0) FROM documents WHERE storage_backend='kv' AND (expires_at IS NULL OR COALESCE(object_expires_at,MAX(expires_at,COALESCE(retained_until,0)))>unixepoch()*1000))+(SELECT COALESCE(SUM(size),0) FROM account_deletion_objects WHERE backend='kv' AND expires_at>unixepoch()*1000)+?<=? RETURNING id`,
  )
    .bind(
      docId,
      user,
      safeFilename(file.name),
      key,
      file.name.normalize("NFKC").toLowerCase().endsWith(".pdf")
        ? "application/pdf"
        : file.type,
      file.size,
      checksum,
      Date.now() + DOCUMENT_TTL * 1000,
      user,
      file.size,
      USER_BYTES,
      user,
      file.size,
      TOTAL_BYTES,
    )
    .first();
  if (!reserved)
    throw new HttpError(
      429,
      "Document count or storage quota reached. Delete unused documents first.",
    );
  try {
    await store.put(key, bytes);
    // Never reactivate a document concurrently marked for deletion.
    const ready = await env.DB.prepare(
      `UPDATE documents SET storage_state='ready',object_expires_at=expires_at+60000 WHERE id=? AND storage_state='uploading' RETURNING id`,
    )
      .bind(docId)
      .first();
    if (!ready) throw new Error("Upload cancelled");
    await env.DB.prepare(
      "INSERT INTO audit(id,user_id,action,entity_id) VALUES(?,?,'document.uploaded',?)",
    )
      .bind(crypto.randomUUID(), user, docId)
      .run();
    return Response.json({
      id: docId,
      available_after_seconds: 60,
      expires_at: new Date(Date.now() + DOCUMENT_TTL * 1000).toISOString(),
    });
  } catch {
    await env.DB.prepare(
      "UPDATE documents SET storage_state='deleting',purge_after=?,cleanup_after=? WHERE id=?",
    )
      .bind(Date.now() + 120000, Date.now() + 120000, docId)
      .run();
    throw new HttpError(
      503,
      "Upload could not be confirmed; cleanup has been queued. Retry later.",
      60,
    );
  }
}
export async function readyDocument(env: Env, user: string, id: string) {
  const row = await env.DB.prepare(
    "SELECT * FROM documents WHERE id=? AND user_id=? AND storage_state='ready' AND (expires_at IS NULL OR expires_at>? OR retained_until>?)",
  )
    .bind(id, user, Date.now(), Date.now())
    .first<any>();
  if (!row) throw new HttpError(404, "Not found");
  return row;
}
export async function documentBytes(env: Env, row: any): Promise<ArrayBuffer> {
  await consume(env, "kv-read:global", 10000);
  const bytes = await documentStore(env, row.storage_backend).get(
    row.object_key,
  );
  if (!bytes)
    throw new HttpError(
      503,
      "Document is still propagating or temporarily unavailable. Try again shortly.",
      30,
    );
  if (
    bytes.byteLength !== row.size ||
    (row.checksum && (await hash(bytes)) !== row.checksum)
  )
    throw new HttpError(503, "Document integrity check failed.");
  return bytes;
}
export async function downloadDocument(env: Env, user: string, id: string) {
  const row = await readyDocument(env, user, id),
    bytes = await documentBytes(env, row);
  const filename = encodeURIComponent(safeFilename(row.name)).replace(
    /['()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
  return new Response(bytes, {
    headers: {
      "Content-Type": row.content_type,
      "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
export async function deleteDocument(env: Env, user: string, id: string) {
  const row = await env.DB.prepare(
    "SELECT * FROM documents WHERE id=? AND user_id=? AND storage_state!='deleted'",
  )
    .bind(id, user)
    .first<any>();
  if (!row) throw new HttpError(404, "Not found");
  // A single conditional UPDATE prevents deleting a file referenced by queued mail.
  const marked = await env.DB.prepare(
    `UPDATE documents SET storage_state='deleting',purge_after=COALESCE(purge_after,?),cleanup_after=? WHERE id=? AND user_id=? AND NOT EXISTS(SELECT 1 FROM campaign_attachment_pins WHERE document_id=documents.id) AND NOT EXISTS(SELECT 1 FROM message_attachments a JOIN messages m ON m.id=a.message_id LEFT JOIN automation f ON f.message_id=m.id WHERE a.document_id=? AND (m.status IN ('draft','pending') OR (m.status='sent' AND (f.generated=0 OR EXISTS(SELECT 1 FROM followup_steps step LEFT JOIN transports child ON child.message_id=step.child_id WHERE step.root_id=m.id AND step.cancel_reason IS NULL AND (child.state IS NULL OR child.state!='confirmed')))))) RETURNING id`,
  )
    .bind(Date.now() + 120000, Date.now() + 120000, id, user, id)
    .first();
  if (!marked)
    throw new HttpError(
      409,
      "Cancel outstanding messages or follow-ups using this document before deleting it.",
    );
  await env.DB.prepare(
    "INSERT INTO audit(id,user_id,action,entity_id) VALUES(?,?,'document.deletion_requested',?)",
  )
    .bind(crypto.randomUUID(), user, id)
    .run();
  return Response.json({ ok: true, cleanup_pending: true });
}
export async function cleanDocuments(env: Env) {
  const now = Date.now();
  await maintainAttachmentRetention(env);
  await env.DB.prepare(
    `UPDATE documents SET storage_state='deleting',purge_after=COALESCE(purge_after,?),cleanup_after=? WHERE id IN (SELECT id FROM documents WHERE (storage_state='uploading' AND created_at<datetime('now','-10 minutes')) OR (storage_state='ready' AND expires_at IS NOT NULL AND MAX(expires_at,COALESCE(retained_until,0))<=? AND NOT EXISTS(SELECT 1 FROM campaign_attachment_pins WHERE document_id=documents.id)) LIMIT 2)`,
  )
    .bind(now + 120000, now + 120000, now)
    .run();
  const rows = await env.DB.prepare(
    "SELECT * FROM documents WHERE storage_state='deleting' AND cleanup_after<=? LIMIT 2",
  )
    .bind(now)
    .all<any>();
  for (const row of rows.results) {
    try {
      await consume(env, "kv-delete:global", 100);
      await documentStore(env, row.storage_backend).delete(row.object_key);
      await env.DB.prepare(
        "UPDATE documents SET storage_state='deleted' WHERE id=? AND storage_state='deleting' AND purge_after<=?",
      )
        .bind(row.id, now)
        .run();
    } catch {
      await env.DB.prepare(
        "UPDATE documents SET cleanup_attempts=cleanup_attempts+1,cleanup_after=? WHERE id=?",
      )
        .bind(now + 3600000, row.id)
        .run();
    }
  }
}

/** Release completed/cancelled plans and renew one near-expiry private object per tick. */
export async function maintainAttachmentRetention(env: Env) {
  await env.DB.prepare(
    `DELETE FROM campaign_attachment_pins WHERE NOT EXISTS(
    SELECT 1 FROM messages root WHERE root.id=campaign_attachment_pins.root_id AND
    (root.status='pending' OR (root.status='sent' AND (
      EXISTS(SELECT 1 FROM followup_steps f LEFT JOIN messages child ON child.id=f.child_id
        WHERE f.root_id=root.id AND f.cancel_reason IS NULL AND (child.status IS NULL OR child.status='pending')) OR
      EXISTS(SELECT 1 FROM automation a WHERE a.message_id=root.id AND a.generated=0 AND a.cancel_reason IS NULL) OR
      EXISTS(SELECT 1 FROM messages child WHERE child.parent_id=root.id AND child.status='pending')))))`,
  ).run();
  await env.DB.prepare(
    `UPDATE documents SET retained_until=(SELECT MAX(retained_until) FROM campaign_attachment_pins p WHERE p.document_id=documents.id)
    WHERE retained_until IS NOT (SELECT MAX(retained_until) FROM campaign_attachment_pins p WHERE p.document_id=documents.id)`,
  ).run();
  const row = await env.DB.prepare(
    "SELECT * FROM documents WHERE storage_state='ready' AND retained_until IS NOT NULL AND retained_until<? ORDER BY retained_until LIMIT 1",
  )
    .bind(Date.now() + 7 * 86400000)
    .first<any>();
  if (!row) return;
  try {
    const bytes = await documentBytes(env, row),
      until = Date.now() + (MAX_SEQUENCE_DAYS + 7) * 86400000;
    await consume(env, "kv-write:global", 100);
    await consume(env, `kv-write:${row.user_id}`, 10);
    await env.DB.prepare(
      "UPDATE documents SET object_expires_at=MAX(COALESCE(object_expires_at,expires_at,0),?) WHERE id=?",
    )
      .bind(until + 60000, row.id)
      .run();
    await documentStore(env, row.storage_backend).put(
      row.object_key,
      bytes,
      (MAX_SEQUENCE_DAYS + 7) * 86400,
    );
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE campaign_attachment_pins SET retained_until=MAX(retained_until,?) WHERE document_id=?",
      ).bind(until, row.id),
      env.DB.prepare(
        "UPDATE documents SET retained_until=MAX(COALESCE(retained_until,0),?) WHERE id=?",
      ).bind(until, row.id),
    ]);
  } catch {
    // Missing or inconsistent required bytes never become an attachment-free send.
    console.warn("campaign_attachment_retention", "renewal_deferred");
  }
}
