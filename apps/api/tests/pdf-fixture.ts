import { PDFDocument, PDFName } from "pdf-lib";
export async function pdfFixture(
  options: {
    compressed?: boolean;
    action?:
      "destination" | "goto" | "script" | "escaped" | "launch" | "embedded";
    producer?: string;
  } = {},
) {
  const doc = await PDFDocument.create();
  doc.setProducer(options.producer || "Microsoft Word");
  const page = doc.addPage();
  page.drawText("Synthetic CV - security regression fixture");
  const ctx = doc.context;
  if (options.action === "destination")
    doc.catalog.set(
      PDFName.of("OpenAction"),
      ctx.obj([page.ref, PDFName.of("Fit")]),
    );
  if (options.action === "goto")
    doc.catalog.set(
      PDFName.of("OpenAction"),
      ctx.register(ctx.obj({ S: "GoTo", D: [page.ref, PDFName.of("Fit")] })),
    );
  if (options.action === "script" || options.action === "escaped")
    doc.catalog.set(
      PDFName.of("OpenAction"),
      ctx.register(
        ctx.obj({
          S: PDFName.of(
            options.action === "escaped" ? "Java#53cript" : "JavaScript",
          ),
          JS: "evil",
        }),
      ),
    );
  if (options.action === "launch")
    doc.catalog.set(
      PDFName.of("OpenAction"),
      ctx.obj({ S: "Launch", F: "evil.exe" }),
    );
  if (options.action === "embedded")
    doc.catalog.set(PDFName.of("Names"), ctx.obj({ EmbeddedFiles: {} }));
  return doc.save({ useObjectStreams: options.compressed ?? false });
}
