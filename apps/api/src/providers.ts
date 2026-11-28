import { base64, base64url, HttpError } from "./runtime";
export type ProviderName = "gmail" | "outlook";
export type TokenSet = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope?: string;
};
export type Attachment = { name: string; type: string; bytes: ArrayBuffer };
export type Envelope = {
  recipient: string;
  subject: string;
  body: string;
  messageKey: string;
  threadId?: string;
  inReplyTo?: string;
  attachments: Attachment[];
};
export type Receipt = {
  id: string | null;
  threadId: string | null;
  acceptedAt?: string;
};
export type MailEvent = {
  id: string;
  sender: string;
  receivedAt: string;
  text: string;
  bounce: boolean;
  labels?: string[];
};
export class ProviderError extends Error {
  constructor(
    public kind: "retry" | "reconnect" | "uncertain" | "rejected",
    public retryAfter = 60,
  ) {
    super("Email provider request could not be completed.");
  }
}
export type Fetcher = typeof fetch;
export async function providerRequest(
  url: string,
  init: RequestInit = {},
  network: Fetcher = fetch,
  sending = false,
): Promise<any> {
  let response: Response;
  try {
    response = await network.call(globalThis, url, {
      ...init,
      signal: AbortSignal.timeout(15000),
      redirect: "manual",
    });
  } catch {
    throw new ProviderError(sending ? "uncertain" : "retry");
  }
  if (response.status === 401) throw new ProviderError("reconnect");
  if (response.status === 403) throw new ProviderError("rejected");
  if (response.status === 429)
    throw new ProviderError(
      "retry",
      Math.min(
        3600,
        Math.max(60, Number(response.headers.get("Retry-After")) || 60),
      ),
    );
  if (!response.ok)
    throw new ProviderError(
      response.status >= 500 ? (sending ? "uncertain" : "retry") : "rejected",
    );
  if (response.status === 202 || response.status === 204) return {};
  // Bound provider responses rather than trusting an absent Content-Length.
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader)
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > 512 * 1024) {
        await reader.cancel();
        throw new ProviderError(sending ? "uncertain" : "rejected");
      }
      chunks.push(next.value);
    }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new ProviderError(sending ? "uncertain" : "rejected");
  }
}
// This wrapper is used only for authorization-code exchange, never mailbox traffic.
// Diagnostics contain fixed enums and a numeric status; provider text is discarded.
export async function oauthTokenRequest(
  url: string,
  init: RequestInit,
  network: Fetcher = fetch,
  operation: "exchange" | "refresh" = "exchange",
): Promise<any> {
  let status = 0;
  let reported = false;
  let failure = "request_setup_exception";
  let tokenFailure = "";
  const observed: Fetcher = async (input, options) => {
    failure = "request_validation_exception";
    // Validate locally so Request construction failures are not called network failures.
    new Request(input, options);
    failure = "fetch_exception";
    let response: Response;
    try {
      response = await network(input, options);
    } catch (error) {
      // Names are reduced to fixed categories; never log messages, stacks or causes.
      failure =
        error instanceof DOMException && error.name === "TimeoutError"
          ? "fetch_timeout"
          : error instanceof DOMException && error.name === "AbortError"
            ? "fetch_aborted"
            : error instanceof TypeError
              ? "fetch_type_error"
              : "fetch_exception";
      throw error;
    }
    failure = "response_processing_exception";
    status = response.status;
    if (!response.ok) {
      let category = "unrecognized_error";
      const reader = response.body?.getReader();
      try {
        const chunks: Uint8Array[] = [];
        let size = 0;
        if (reader)
          while (true) {
            const next = await reader.read();
            if (next.done) break;
            size += next.value.length;
            if (size > 8192) {
              category = "error_body_too_large";
              await reader.cancel();
              break;
            }
            chunks.push(next.value);
          }
        if (size <= 8192) {
          const bytes = new Uint8Array(size);
          let offset = 0;
          for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.length;
          }
          const parsed = JSON.parse(new TextDecoder().decode(bytes));
          const allowed = [
            "invalid_client",
            "invalid_grant",
            "invalid_request",
            "unauthorized_client",
            "unsupported_grant_type",
            "invalid_scope",
            "access_denied",
            "server_error",
            "temporarily_unavailable",
          ];
          if (
            typeof parsed?.error === "string" &&
            allowed.includes(parsed.error)
          )
            category = parsed.error;
        }
      } catch {
        category = "error_body_unreadable";
      } finally {
        reader?.releaseLock();
      }
      tokenFailure = category;
      console.warn(
        operation === "refresh"
          ? "oauth_token_refresh_failure"
          : "oauth_token_exchange_failure",
        status,
        category,
      );
      reported = true;
    }
    return response;
  };
  try {
    return await providerRequest(url, init, observed);
  } catch (error) {
    if (!reported)
      console.warn(
        operation === "refresh"
          ? "oauth_token_refresh_failure"
          : "oauth_token_exchange_failure",
        status,
        status ? "success_body_unreadable" : failure,
      );
    if (operation === "refresh")
      throw new ProviderError(
        tokenFailure === "invalid_grant" ? "reconnect" : "retry",
      );
    throw error;
  }
}

export function oauthConfig(provider: ProviderName) {
  return provider === "gmail"
    ? {
        authorization: "https://accounts.google.com/o/oauth2/v2/auth",
        token: "https://oauth2.googleapis.com/token",
      }
    : {
        authorization:
          "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
        token: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
      };
}
export function scopes(provider: ProviderName, read: boolean) {
  return provider === "gmail"
    ? [
        "openid",
        "email",
        "https://www.googleapis.com/auth/gmail.send",
        ...(read ? ["https://www.googleapis.com/auth/gmail.readonly"] : []),
      ]
    : [
        "offline_access",
        "User.Read",
        "Mail.Send",
        ...(read ? ["Mail.Read"] : []),
      ];
}
function cleanHeader(text: string) {
  if (/[\r\n\x00]/.test(text)) throw new HttpError(400, "Invalid mail header.");
  return text;
}
function encodedSubject(subject: string) {
  const words: string[] = [];
  let part = "";
  for (const char of cleanHeader(subject)) {
    if (new TextEncoder().encode(part + char).length > 42) {
      words.push("=?UTF-8?B?" + base64(new TextEncoder().encode(part)) + "?=");
      part = "";
    }
    part += char;
  }
  if (part)
    words.push("=?UTF-8?B?" + base64(new TextEncoder().encode(part)) + "?=");
  return words.join("\r\n ");
}
function encoded(text: string) {
  return (
    base64(new TextEncoder().encode(text))
      .match(/.{1,76}/g)
      ?.join("\r\n") || ""
  );
}
export function mime(envelope: Envelope) {
  const boundary = "outreach-" + crypto.randomUUID();
  const lines = [
    `To: ${cleanHeader(envelope.recipient)}`,
    `Subject: ${encodedSubject(envelope.subject)}`,
    `Message-ID: <${cleanHeader(envelope.messageKey)}>`,
    ...(envelope.inReplyTo
      ? [
          `In-Reply-To: <${cleanHeader(envelope.inReplyTo)}>`,
          `References: <${cleanHeader(envelope.inReplyTo)}>`,
        ]
      : []),
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    encoded(envelope.body),
  ];
  for (const file of envelope.attachments) {
    const name = encodeURIComponent(cleanHeader(file.name)).replace(
      /['()*]/g,
      (c) => "%" + c.charCodeAt(0).toString(16),
    );
    lines.push(
      `--${boundary}`,
      `Content-Type: ${cleanHeader(file.type)}`,
      `Content-Disposition: attachment; filename*=UTF-8''${name}`,
      "Content-Transfer-Encoding: base64",
      "",
      base64(new Uint8Array(file.bytes))
        .match(/.{1,76}/g)
        ?.join("\r\n") || "",
    );
  }
  lines.push(`--${boundary}--`, "");
  return lines.join("\r\n");
}
export interface EmailProvider {
  send(access: string, envelope: Envelope): Promise<Receipt>;
  reconcile(access: string, key: string): Promise<Receipt | null>;
  replies(
    access: string,
    thread: string,
    cursor?: string | null,
    context?: {recipient:string;key:string;sentAt:string},
  ): Promise<{ events: MailEvent[]; cursor: string | null }>;
}
export function emailProvider(
  provider: ProviderName,
  network: Fetcher = fetch,
): EmailProvider {
  // Per-provider-instance cache; never shared between users or scheduler invocations.
  const reads=new Map<string,Promise<any>>();
  const auth = (access: string) => ({ Authorization: `Bearer ${access}` });
  const request = (
    url: string,
    access: string,
    init: RequestInit = {},
    sending = false,
  ) =>
    providerRequest(
      url,
      { ...init, headers: { ...auth(access), ...init.headers } },
      network,
      sending,
    );
  if (provider === "gmail")
    return {
      async send(access, envelope) {
        if (
          envelope.attachments.length > 3 ||
          envelope.attachments.reduce(
            (total, file) => total + file.bytes.byteLength,
            0,
          ) >
            2 * 1024 * 1024
        )
          throw new HttpError(
            400,
            "Email attachments exceed the 3-file / 2 MiB message limit.",
          );
        const encodedMessage = new TextEncoder().encode(mime(envelope));
        if (encodedMessage.byteLength > 4 * 1024 * 1024)
          throw new HttpError(
            400,
            "Encoded email exceeds the safe 4 MiB message limit.",
          );
        const result = await request(
          "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
          access,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              raw: base64url(encodedMessage),
              ...(envelope.threadId ? { threadId: envelope.threadId } : {}),
            }),
          },
          true,
        );
        if (!result.id) throw new ProviderError("uncertain");
        return {
          id: result.id,
          threadId: result.threadId || null,
          ...(Number.isFinite(Number(result.internalDate)) &&
          Number(result.internalDate) > 0
            ? {
                acceptedAt: new Date(Number(result.internalDate)).toISOString(),
              }
            : {}),
        };
      },
      async reconcile(access, key) {
        const rows = await request(
          "https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=2&q=" +
            encodeURIComponent(`in:sent rfc822msgid:${key}`),
          access,
        );
        if (rows.messages?.length !== 1) return null;
        const result = await request(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(rows.messages[0].id)}?format=metadata`,
          access,
        );
        return {
          id: result.id,
          threadId: result.threadId || null,
          ...(Number.isFinite(Number(result.internalDate)) &&
          Number(result.internalDate) > 0
            ? {
                acceptedAt: new Date(Number(result.internalDate)).toISOString(),
              }
            : {}),
        };
      },
      async replies(access, thread, cursor, context) {
        const metadata = "format=metadata&metadataHeaders=From&metadataHeaders=Content-Type&metadataHeaders=Auto-Submitted&metadataHeaders=Message-ID&metadataHeaders=In-Reply-To&metadataHeaders=References&fields=id,threadId,labelIds,internalDate,snippet,payload(headers)";
        const result = await request(
          `https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(thread)}?${metadata.replace("fields=id,threadId,labelIds,internalDate,snippet,payload(headers)","fields=messages(id,threadId,labelIds,internalDate,snippet,payload(headers))")}`,
          access,
        );
        if ((result.messages || []).length > 100) throw new ProviderError("retry");
        const messages = new Map<string,any>((result.messages || []).map((m:any)=>[m.id,m]));
        const header=(m:any,name:string)=>m.payload?.headers?.find((h:any)=>h.name.toLowerCase()===name)?.value || "";
        const references=new Set<string>([context?.key, ...(result.messages || []).filter((m:any)=>m.labelIds?.includes("SENT")).map((m:any)=>header(m,"message-id"))].filter(Boolean).map((v:string)=>v.replace(/[<>]/g,"")));
        let next:string|null=null;
        if(context){
          const since=Math.floor(Date.parse(context.sentAt)/1000);
          if(!Number.isFinite(since) || !/^[^\s<>"()]+@[^\s<>"()]+$/.test(context.recipient)) throw new ProviderError("rejected");
          const params=new URLSearchParams({includeSpamTrash:"true",maxResults:"5",q:`from:(${context.recipient}) after:${since}`});
          if(cursor) params.set("pageToken",cursor);
          const pageURL="https://gmail.googleapis.com/gmail/v1/users/me/messages?"+params;
          if(!reads.has(pageURL)) reads.set(pageURL,request(pageURL,access));
          const page=await reads.get(pageURL)!;
          next=page.nextPageToken || null;
          for(const candidate of page.messages || []){
            if(messages.has(candidate.id)) continue;
            const detailURL=`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(candidate.id)}?${metadata}`;
            if(!reads.has(detailURL)) reads.set(detailURL,request(detailURL,access));
            const m=await reads.get(detailURL)!;
            const refs=(header(m,"in-reply-to")+" "+header(m,"references")).match(/<[^>]+>/g) || [];
            if(m.threadId===thread || refs.some((ref:string)=>references.has(ref.slice(1,-1)))) messages.set(m.id,m);
          }
        }
        return {
          events: [...messages.values()].map((m:any)=>({
            id:m.id,sender:header(m,"from"),receivedAt:new Date(Number(m.internalDate)).toISOString(),text:m.snippet || "",
            labels:Array.isArray(m.labelIds)?m.labelIds:[],
            bounce:/delivery-status|report-type=delivery-status/i.test(header(m,"content-type")),
          })),cursor:next,
        };
      },
    };
  return {
    async send(access, envelope) {
      const message = {
        subject: cleanHeader(envelope.subject),
        body: { contentType: "Text", content: envelope.body },
        toRecipients: [
          { emailAddress: { address: cleanHeader(envelope.recipient) } },
        ],
        internetMessageHeaders: [
          { name: "x-outreach-id", value: cleanHeader(envelope.messageKey) },
        ],
        attachments: envelope.attachments.map((file) => ({
          "@odata.type": "#microsoft.graph.fileAttachment",
          name: file.name,
          contentType: file.type,
          contentBytes: base64(new Uint8Array(file.bytes)),
        })),
      };
      await request(
        "https://graph.microsoft.com/v1.0/me/sendMail",
        access,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message, saveToSentItems: true }),
        },
        true,
      );
      return { id: null, threadId: null };
    },
    async reconcile(access, key) {
      const rows = await request(
        "https://graph.microsoft.com/v1.0/me/mailFolders/sentitems/messages?$top=25&$select=id,conversationId,internetMessageHeaders",
        access,
      );
      const matches = (rows.value || []).filter((m: any) =>
        (m.internetMessageHeaders || []).some(
          (h: any) =>
            h.name.toLowerCase() === "x-outreach-id" && h.value === key,
        ),
      );
      return matches.length === 1
        ? { id: matches[0].id, threadId: matches[0].conversationId }
        : null;
    },
    async replies(access, thread, cursor) {
      let url =
        "https://graph.microsoft.com/v1.0/me/messages?$top=20&$select=id,from,receivedDateTime,bodyPreview,internetMessageHeaders&$filter=" +
        encodeURIComponent(`conversationId eq '${thread.replace(/'/g, "''")}'`);
      if (cursor) {
        const next = new URL(cursor);
        if (
          next.origin !== "https://graph.microsoft.com" ||
          next.pathname !== "/v1.0/me/messages"
        )
          throw new ProviderError("rejected");
        url = next.href;
      }
      const rows = await request(url, access);
      return {
        events: (rows.value || []).map((m: any) => ({
          id: m.id,
          sender: m.from?.emailAddress?.address || "",
          receivedAt: m.receivedDateTime,
          text: m.bodyPreview || "",
          bounce: (m.internetMessageHeaders || []).some(
            (h: any) =>
              h.name.toLowerCase() === "content-type" &&
              /report-type=delivery-status/i.test(h.value),
          ),
        })),
        cursor: rows["@odata.nextLink"] || null,
      };
    },
  };
}
