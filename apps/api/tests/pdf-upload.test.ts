import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { harness, fileForm } from "./harness";
import { pdfFixture } from "./pdf-fixture";
import { FILE_LIMIT, DOCUMENT_TTL } from "../src/storage";
let h: ReturnType<typeof harness>;
beforeEach(() => {
  h = harness();
});
afterEach(() => h.db.close());
describe("PDF upload validation", () => {
  it.each([
    "application/pdf",
    "application/octet-stream",
    "",
    "application/x-pdf",
    "Application/PDF; charset=binary",
  ])(
    "accepts a parsed PDF with MIME %s and stores canonical type",
    async (mime) => {
      const user = await h.user();
      const bytes = await pdfFixture({ action: "destination" });
      const response = await h.request(
        "/documents",
        "POST",
        fileForm(bytes, "CV.PDF", mime),
        user.session,
      );
      expect(response.status).toBe(200);
      const { id, expires_at } = await response.json();
      expect(new Date(expires_at).getTime() - Date.now()).toBeCloseTo(
        DOCUMENT_TTL * 1000,
        -3,
      );
      expect(
        h.db.prepare("SELECT content_type FROM documents WHERE id=?").get(id)!
          .content_type,
      ).toBe("application/pdf");
      const download = await h.request(
        "/documents/" + id,
        "GET",
        undefined,
        user.session,
      );
      expect(download.headers.get("Content-Type")).toBe("application/pdf");
      expect(download.headers.get("Cache-Control")).toContain(
        "private, no-store",
      );
      expect(download.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(new Uint8Array(await download.arrayBuffer())).toEqual(bytes);
    },
  );
  it.each([false, true])(
    "accepts common PDF structures (object streams: %s), local GoTo and long filenames",
    async (compressed) => {
      const user = await h.user();
      const response = await h.request(
        "/documents",
        "POST",
        fileForm(
          await pdfFixture({ compressed, action: "goto" }),
          "cv".repeat(60) + ".pdf",
          "application/pdf",
        ),
        user.session,
      );
      expect(response.status).toBe(200);
    },
  );
  it.each(["script", "escaped", "launch", "embedded"] as const)(
    "rejects %s content before storage, even in compressed objects",
    async (action) => {
      const user = await h.user();
      const response = await h.request(
        "/documents",
        "POST",
        fileForm(
          await pdfFixture({ action, compressed: true }),
          "cv.pdf",
          "application/pdf",
        ),
        user.session,
      );
      expect(response.status).toBe(400);
      expect((await response.json()).error).toMatch(
        /active content|opening action/,
      );
      expect(h.flags.writes).toBe(0);
    },
  );
  it("gives precise errors and never stores rejected documents", async () => {
    const user = await h.user(),
      valid = await pdfFixture();
    const cases: [string | Uint8Array, string, string, RegExp][] = [
      ["", "cv.pdf", "application/pdf", /empty/],
      ["not a PDF", "cv.pdf", "application/pdf", /signature/],
      [
        "%PDF-1.7\nnot a document\n%%EOF",
        "cv.pdf",
        "application/pdf",
        /cross-reference/,
      ],
      [
        new Uint8Array(
          Buffer.from(
            Buffer.from(valid)
              .toString("latin1")
              .replace("/Type /Catalog", "/Type /Invalid"),
            "latin1",
          ),
        ),
        "cv.pdf",
        "application/pdf",
        /parsed/,
      ],
      [valid.slice(0, -8), "cv.pdf", "application/pdf", /EOF/],
      [valid, "cv.exe", "application/pdf", /extension/],
      [valid, "cv.pdf", "text/html", /MIME/],
      [new Uint8Array(FILE_LIMIT + 1), "cv.pdf", "application/pdf", /2 MiB/],
      [
        new Uint8Array([...valid, 60, 115, 99, 114, 105, 112, 116, 62]),
        "cv.pdf",
        "application/pdf",
        /trailing data/,
      ],
    ];
    for (const [bytes, name, mime, error] of cases) {
      const response = await h.request(
        "/documents",
        "POST",
        fileForm(bytes, name, mime),
        user.session,
      );
      expect(response.status).toBe(400);
      expect((await response.json()).error).toMatch(error);
    }
    expect(h.flags.writes).toBe(0);
    expect(h.db.prepare("SELECT count(*) n FROM documents").get()!.n).toBe(0);
  });
  it("accepts exactly 2 MiB while retaining PDF validation", async () => {
    const user = await h.user(),
      valid = await pdfFixture();
    const padded = new Uint8Array(FILE_LIMIT).fill(32);
    padded.set(valid);
    expect(
      (
        await h.request(
          "/documents",
          "POST",
          fileForm(padded, "cv.pdf", "application/pdf"),
          user.session,
        )
      ).status,
    ).toBe(200);
  });
});
