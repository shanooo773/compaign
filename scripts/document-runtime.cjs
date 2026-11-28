const fs = require("node:fs"),
  assert = require("node:assert/strict"),
  crypto = require("node:crypto");
const { build } = require("esbuild");
const { Miniflare, convertV4MiniflareOptions } = require(
  require.resolve("miniflare", {
    paths: [require.resolve("wrangler/package.json")],
  }),
);
(async () => {
  const bundled = await build({
    entryPoints: ["apps/api/src/index.ts"],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
  });
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: bundled.outputFiles[0].text,
      compatibilityDate: "2026-10-01",
      d1Databases: ["DB"],
      kvNamespaces: ["DOCUMENTS_KV"],
      bindings: {
        APP_ORIGIN: "https://synthetic.invalid",
      },
      outboundService: () => {
        throw Error("All outbound traffic forbidden");
      },
    }),
  );
  try {
    const db = await mf.getD1Database("DB");
    for (const file of fs
      .readdirSync("apps/api/migrations")
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await db.exec(
        fs
          .readFileSync("apps/api/migrations/" + file, "utf8")
          .replace(/--[^\n]*/g, "")
          .replace(/\r?\n/g, " "),
      );
    const session = "synthetic-document-session";
    await db.batch([
      db.prepare(
        "INSERT INTO users(id,email,password,legacy_access) VALUES('document-qa','qa@example.invalid','synthetic',1)",
      ),
      db.prepare("INSERT INTO profiles(user_id) VALUES('document-qa')"),
      db
        .prepare(
          "INSERT INTO sessions(token,user_id,expires_at) VALUES(?,'document-qa',?)",
        )
        .bind(
          crypto.createHash("sha256").update(session).digest("hex"),
          Date.now() + 600000,
        ),
    ]);
    const { PDFDocument, PDFName } = require("pdf-lib");
    const doc = await PDFDocument.create(),
      page = doc.addPage();
    doc.catalog.set(
      PDFName.of("OpenAction"),
      doc.context.obj([page.ref, PDFName.of("Fit")]),
    );
    const valid = await doc.save();
    const upload = async (bytes, type = "application/octet-stream") => {
      const form = new FormData();
      form.set("file", new File([bytes], "cv.pdf", { type }));
      const serialized = new Request("https://synthetic.invalid", {
        method: "POST",
        body: form,
      });
      return mf.dispatchFetch("https://synthetic.invalid/api/documents", {
        method: "POST",
        headers: {
          Origin: "https://synthetic.invalid",
          Cookie: "session=" + session,
          "Content-Type": serialized.headers.get("Content-Type"),
        },
        body: await serialized.arrayBuffer(),
      });
    };
    const result = await upload(valid);
    assert.equal(result.status, 200, await result.clone().text());
    const { id } = await result.json();
    const downloaded = await mf.dispatchFetch(
      "https://synthetic.invalid/api/documents/" + id,
      { headers: { Cookie: "session=" + session } },
    );
    assert.equal(downloaded.status, 200);
    assert.equal(downloaded.headers.get("Content-Type"), "application/pdf");
    assert.match(downloaded.headers.get("Cache-Control"), /private, no-store/);
    assert.deepEqual(
      Buffer.from(await downloaded.arrayBuffer()),
      Buffer.from(valid),
    );
    const invalid = await upload("%PDF-1.7\nnot a PDF\n%%EOF");
    assert.equal(invalid.status, 400);
    assert.match((await invalid.json()).error, /cross-reference/);
    doc.catalog.set(
      PDFName.of("OpenAction"),
      doc.context.obj({ S: "JavaScript", JS: "evil" }),
    );
    const active = await upload(await doc.save());
    assert.equal(active.status, 400);
    assert.match((await active.json()).error, /active content/);
    const row = await db.prepare("SELECT count(*) n FROM documents").first();
    assert.equal(row.n, 1);
    console.log(
      "PASS native Workers/D1/KV: generic-MIME PDF with benign OpenAction uploads, canonical MIME/private download and exact bytes; malformed and scripted PDFs rejected before storage; all outbound traffic forbidden.",
    );
  } finally {
    await mf.dispose();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
