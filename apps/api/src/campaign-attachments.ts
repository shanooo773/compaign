import { z } from "zod";
import { type Env, HttpError, consume } from "./runtime";
import {
  readyDocument,
  documentBytes,
  documentStore,
  validateDocumentFile,
  FILE_LIMIT,
  safeFilename,
} from "./storage";
import { MAX_SEQUENCE_DAYS } from "../../../shared/followup-sequence";
export const attachmentSelectionSchema = z.object({
  initial: z.array(z.string().uuid()).max(3).default([]),
  followups: z
    .record(
      z.string().regex(/^(?:[1-9]|10)$/),
      z.array(z.string().uuid()).max(3),
    )
    .default({}),
});
export const campaignAttachmentsSchema = attachmentSelectionSchema.extend({
  recipients: z
    .record(z.string().uuid(), attachmentSelectionSchema)
    .default({}),
});
export type AttachmentDescriptor = {
  id: string;
  checksum: string;
  size: number;
  name: string;
  content_type: string;
};
export type AuthorizedAttachments = {
  initial: AttachmentDescriptor[];
  followups: Record<string, AttachmentDescriptor[]>;
};
export type CachedDocument = {
  row: any;
  bytes: ArrayBuffer;
  descriptor: AttachmentDescriptor;
};
export function attachmentRetentionUntil(scheduled: string) {
  return (
    Math.max(Date.now(), Date.parse(scheduled)) +
    (MAX_SEQUENCE_DAYS + 7) * 86400000
  );
}
export async function resolveAttachmentPlan(
  env: Env,
  user: string,
  initial: string[],
  followups: Record<string, string[]>,
  count: number,
  cache: Map<string, CachedDocument>,
): Promise<AuthorizedAttachments> {
  const resolve = async (ids: string[]) => {
    const out: AttachmentDescriptor[] = [];
    for (const id of new Set(ids)) {
      if (!cache.has(id)) {
        if (cache.size >= 3)
          throw new HttpError(
            400,
            "A campaign supports at most 3 distinct documents; each message supports 2 MiB total.",
          );
        const row = await readyDocument(env, user, id);
        const bytes = await documentBytes(env, row);
        const extension: Record<string, string> = {
          "application/pdf": ".pdf",
          "text/plain": ".txt",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
            ".docx",
        };
        if (!extension[row.content_type])
          throw new HttpError(
            400,
            "Unsupported attachment type. Upload a PDF, DOCX or TXT document.",
          );
        const validationName =
          safeFilename(row.name) +
          (row.name.toLowerCase().endsWith(extension[row.content_type])
            ? ""
            : extension[row.content_type]);
        await validateDocumentFile(
          new File([bytes], validationName, { type: row.content_type }),
        );
        if (!row.checksum)
          throw new HttpError(
            409,
            "Attachment has no integrity checksum. Upload it again before approval.",
          );
        cache.set(id, {
          row,
          bytes,
          descriptor: {
            id,
            checksum: row.checksum,
            size: row.size,
            name: row.name,
            content_type: row.content_type,
          },
        });
      }
      out.push(cache.get(id)!.descriptor);
    }
    if (out.reduce((total, doc) => total + doc.size, 0) > FILE_LIMIT)
      throw new HttpError(
        400,
        "Selected attachments exceed the 2 MiB total per message.",
      );
    return out;
  };
  const plan: AuthorizedAttachments = {
    initial: await resolve(initial),
    followups: {},
  };
  for (const [step, ids] of Object.entries(followups))
    if (+step <= count) plan.followups[step] = await resolve(ids);
  return plan;
}
export async function retainApprovalFiles(
  env: Env,
  cache: Map<string, CachedDocument>,
  until: number,
) {
  for (const { row, bytes } of cache.values()) {
    const expiration = Math.max(
      until,
      row.expires_at || 0,
      row.retained_until || 0,
    );
    await consume(env, "kv-write:global", 100);
    await consume(env, `kv-write:${row.user_id}`, 10);
    const reserved = await env.DB.prepare(
      "UPDATE documents SET object_expires_at=MAX(COALESCE(object_expires_at,expires_at,0),?) WHERE id=? AND user_id=? AND storage_state='ready' RETURNING id",
    )
      .bind(expiration + 60000, row.id, row.user_id)
      .first();
    if (!reserved)
      throw new HttpError(
        409,
        "Attachment changed availability before approval. Refresh and review again.",
      );
    await documentStore(env, row.storage_backend).put(
      row.object_key,
      bytes,
      Math.max(60, Math.ceil((expiration - Date.now()) / 1000)),
    );
  }
}
export function followupAttachments<T>(
  authorization: any,
  original: T[],
  step: number,
): T[] {
  return authorization?.attachment_plan
    ? authorization.attachment_plan.followups[String(step)] || []
    : original;
}
