import { pdfFixture } from "./pdf-fixture";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { harness, fileForm } from "./harness";
import { cleanDocuments, FILE_LIMIT, TOTAL_BYTES } from "../src/storage";
let h: ReturnType<typeof harness>;
beforeEach(() => {
  h = harness();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Live network forbidden in tests");
    }),
  );
});
afterEach(() => {
  h.db.close();
  vi.unstubAllGlobals();
});
describe("private KV document API", () => {
  it("handles eventual consistency, owner-only reads, immediate logical deletion and failed cleanup", async () => {
    const a = await h.user(),
      b = await h.user("other@example.com");
    h.flags.visible = false;
    const created = await h.request(
      "/documents",
      "POST",
      fileForm(),
      a.session,
    );
    expect(created.status).toBe(200);
    const { id } = await created.json();
    const early = await h.request(
      "/documents/" + id,
      "GET",
      undefined,
      a.session,
    );
    expect(early.status).toBe(503);
    expect(early.headers.get("Retry-After")).toBe("30");
    expect(early.headers.get("Cache-Control")).toContain("no-store");
    const reads = h.flags.reads;
    expect(
      (await h.request("/documents/" + id, "GET", undefined, b.session)).status,
    ).toBe(404);
    expect(h.flags.reads).toBe(reads);
    h.flags.visible = true;
    expect(
      await (
        await h.request("/documents/" + id, "GET", undefined, a.session)
      ).text(),
    ).toBe("private CV");
    expect(
      (
        await h.request(
          "/documents/" + id + "/delete",
          "POST",
          undefined,
          b.session,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await h.request(
          "/documents/" + id + "/delete",
          "POST",
          undefined,
          a.session,
        )
      ).status,
    ).toBe(200);
    expect(
      (await h.request("/documents/" + id, "GET", undefined, a.session)).status,
    ).toBe(404);
    h.db.prepare("UPDATE documents SET purge_after=0,cleanup_after=0").run();
    h.flags.failDelete = true;
    await cleanDocuments(h.env);
    expect(
      h.db.prepare("SELECT storage_state FROM documents").get()!.storage_state,
    ).toBe("deleting");
    h.flags.failDelete = false;
    h.db.prepare("UPDATE documents SET cleanup_after=0").run();
    await cleanDocuments(h.env);
    expect(
      h.db.prepare("SELECT storage_state FROM documents").get()!.storage_state,
    ).toBe("deleted");
    expect(h.bytes.size).toBe(0);
  });
  it("retains quota and hides incomplete uploads after ambiguous writes", async () => {
    const a = await h.user();
    h.flags.failPut = true;
    expect(
      (await h.request("/documents", "POST", fileForm(), a.session)).status,
    ).toBe(503);
    expect(
      h.db.prepare("SELECT storage_state FROM documents").get()!.storage_state,
    ).toBe("deleting");
    expect(h.bytes.size).toBe(1);
    const state = await (
      await h.request("/state", "GET", undefined, a.session)
    ).json();
    expect(state.documents).toEqual([]);
  });
  it("serializes competing quota reservations before KV writes", async () => {
    const a = await h.user();
    for (let i = 0; i < 9; i++)
      h.db
        .prepare(
          "INSERT INTO documents(id,user_id,name,object_key,content_type,size,storage_backend) VALUES(?,?,?,?,?,1,'kv')",
        )
        .run(
          crypto.randomUUID(),
          a.id,
          "synthetic.txt",
          "key-" + i,
          "text/plain",
        );
    const results = await Promise.all([
      h.request("/documents", "POST", fileForm(), a.session),
      h.request("/documents", "POST", fileForm(), a.session),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 429]);
    expect(h.flags.writes).toBe(1);
  });
  it("enforces total capacity even for deleted objects whose TTL has not passed", async () => {
    const a = await h.user();
    h.db
      .prepare(
        "INSERT INTO documents(id,user_id,name,object_key,content_type,size,storage_backend,storage_state,expires_at) VALUES(?,?,?,?,?,?,'kv','deleted',?)",
      )
      .run(
        crypto.randomUUID(),
        a.id,
        "retained.txt",
        "key",
        "text/plain",
        TOTAL_BYTES,
        Date.now() + 86400000,
      );
    expect(
      (await h.request("/documents", "POST", fileForm(), a.session)).status,
    ).toBe(429);
    expect(h.flags.writes).toBe(0);
  });
  it("rejects oversized bodies, unsafe types and misleading signatures without writing KV", async () => {
    const a = await h.user();
    for (const form of [
      fileForm(new Uint8Array(FILE_LIMIT + 65537)),
      fileForm("not a PDF", "cv.pdf", "application/pdf"),
      fileForm("<script>evil</script>", "cv.html", "text/html"),
      fileForm(
        "not a ZIP",
        "cv.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ])
      expect([400, 413]).toContain(
        (await h.request("/documents", "POST", form, a.session)).status,
      );
    expect(h.flags.writes).toBe(0);
  });
  it("protects attached files from deletion and makes expired documents unavailable", async () => {
    const a = await h.user();
    const { id } = await (
      await h.request("/documents", "POST", fileForm(), a.session)
    ).json();
    const professor = crypto.randomUUID(),
      message = crypto.randomUUID();
    h.db
      .prepare("INSERT INTO professors(id,user_id,name,email) VALUES(?,?,?,?)")
      .run(professor, a.id, "Test Professor", "prof@example.edu");
    h.db
      .prepare(
        "INSERT INTO messages(id,user_id,professor_id,subject,body,mode,scheduled_at,timezone) VALUES(?,?,?,'s','b','manual',?,'UTC')",
      )
      .run(message, a.id, professor, new Date().toISOString());
    h.db
      .prepare(
        "INSERT INTO message_attachments(message_id,document_id,user_id) VALUES(?,?,?)",
      )
      .run(message, id, a.id);
    expect(
      (
        await h.request(
          "/documents/" + id + "/delete",
          "POST",
          undefined,
          a.session,
        )
      ).status,
    ).toBe(409);
    h.db.prepare("UPDATE documents SET expires_at=0").run();
    expect(
      (await h.request("/documents/" + id, "GET", undefined, a.session)).status,
    ).toBe(404);
  });
  it("checks checksum and refuses incomplete backend configuration", async () => {
    const a = await h.user();
    const { id } = await (
      await h.request("/documents", "POST", fileForm(), a.session)
    ).json();
    const row = h.db
      .prepare("SELECT object_key FROM documents WHERE id=?")
      .get(id)!;
    h.bytes.set(
      String(row.object_key),
      new TextEncoder().encode("tampered").buffer,
    );
    expect(
      (await h.request("/documents/" + id, "GET", undefined, a.session)).status,
    ).toBe(503);
    h.env.DOCUMENTS_KV = undefined;
    const response = await h.request("/health");
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
  });
  it("reads a legacy R2 object only with an explicitly supplied adapter", async () => {
    const a = await h.user(),
      id = crypto.randomUUID(),
      bytes = new TextEncoder().encode("legacy private file").buffer;
    h.db
      .prepare(
        "INSERT INTO documents(id,user_id,name,object_key,content_type,size) VALUES(?,?,?,?,'text/plain',?)",
      )
      .run(id, a.id, "legacy.txt", "legacy-key", bytes.byteLength);
    h.env.DOCUMENTS = {
      get: async () => ({ arrayBuffer: async () => bytes }),
    } as any;
    expect(
      await (
        await h.request("/documents/" + id, "GET", undefined, a.session)
      ).text(),
    ).toBe("legacy private file");
    h.env.DOCUMENTS = undefined;
    expect(
      (await h.request("/documents/" + id, "GET", undefined, a.session)).status,
    ).toBe(503);
  });
  it("rejects active PDF content and bare ZIP files disguised as DOCX", async () => {
    const a = await h.user();
    expect(
      (
        await h.request(
          "/documents",
          "POST",
          fileForm(
            "%PDF-1.7\n/JavaScript (unsafe)\n%%EOF",
            "cv.pdf",
            "application/pdf",
          ),
          a.session,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await h.request(
          "/documents",
          "POST",
          fileForm(
            new Uint8Array([80, 75, 3, 4]),
            "cv.docx",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          ),
          a.session,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await h.request(
          "/documents",
          "POST",
          fileForm(await pdfFixture(), "cv.pdf", "application/pdf"),
          a.session,
        )
      ).status,
    ).toBe(200);
  });
  it("accepts a bounded synthetic Word ZIP container generated with standard ZIP tooling", async () => {
    const a = await h.user();
    const bytes = new Uint8Array(
      Buffer.from(
        "UEsDBBQAAAAIAClzVV19j8M5SgAAAE0AAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbLMJqSxILVaoyM3JK7ZVyigpKbDS1y9OzkjNTSzWyy9IzQPKpOUX5SaWALlF6foFicnZiemp+kYGBmb6yfl5Jal5JbolIDOU9O0AUEsDBBQAAAAIAClzVV1M12HDXAAAAGkAAAARAAAAd29yZC9kb2N1bWVudC54bWxFzEEKgCAQQNGrRAdookULMe9iaiU4M+IY1u1z1/Lz4OumPLsbA9XhwUSi2jZetWYFIO4KaGXiHKjbwQVt7VlOaFx8LuyCSKQTEyzzvALaSKPRTe3sXzAa/rn5AFBLAQIUABQAAAAIAClzVV19j8M5SgAAAE0AAAATAAAAAAAAAAAAAACAAQAAAABbQ29udGVudF9UeXBlc10ueG1sUEsBAhQAFAAAAAgAKXNVXUzXYcNcAAAAaQAAABEAAAAAAAAAAAAAAIABewAAAHdvcmQvZG9jdW1lbnQueG1sUEsFBgAAAAACAAIAgAAAAAYBAAAAAA==",
        "base64",
      ),
    );
    const response = await h.request(
      "/documents",
      "POST",
      fileForm(
        bytes,
        "synthetic.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
      a.session,
    );
    expect(response.status).toBe(200);
  });
  it("preserves atomic 500-row imports within the Free-plan query budget", async () => {
    const a = await h.user();
    let queries = 0;
    const prepare = h.env.DB.prepare.bind(h.env.DB);
    h.env.DB.prepare = ((sql: string) => {
      queries++;
      return prepare(sql);
    }) as any;
    const rows = Array.from({ length: 500 }, (_, i) => ({
      name: "Professor " + i,
      email: `prof-${i}@example.edu`,
      university: "Synthetic University",
      interests: "\u4e2d".repeat(1900),
    }));
    const response = await h.request("/professors", "POST", rows, a.session);
    expect(response.status).toBe(200);
    expect((await response.json()).imported).toBe(500);
    expect(queries).toBeLessThan(10);
    expect(h.db.prepare("SELECT count(*) n FROM professors").get()!.n).toBe(
      500,
    );
  });
  it("approves a full retained manual batch without per-message SQL round trips", async () => {
    const a = await h.user(),
      prof = crypto.randomUUID(),
      ids = Array.from({ length: 100 }, () => crypto.randomUUID());
    h.db
      .prepare("INSERT INTO professors(id,user_id,name,email) VALUES(?,?,?,?)")
      .run(prof, a.id, "Test", "test@example.edu");
    for (const id of ids)
      h.db
        .prepare(
          "INSERT INTO messages(id,user_id,professor_id,subject,body,mode,scheduled_at,timezone) VALUES(?,?,?,'s','b','manual',?,'UTC')",
        )
        .run(id, a.id, prof, new Date().toISOString());
    let queries = 0;
    const prepare = h.env.DB.prepare.bind(h.env.DB);
    h.env.DB.prepare = ((sql: string) => {
      queries++;
      return prepare(sql);
    }) as any;
    const response = await h.request(
      "/messages/approve",
      "POST",
      { ids },
      a.session,
    );
    expect(response.status).toBe(200);
    expect(queries).toBeLessThan(10);
    expect(
      h.db
        .prepare("SELECT count(*) n FROM messages WHERE status='pending'")
        .get()!.n,
    ).toBe(100);
  });
});
