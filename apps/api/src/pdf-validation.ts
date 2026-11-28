import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFObjectParser,
} from "pdf-lib";
import { HttpError } from "./runtime";

export async function validatePdf(data: Uint8Array) {
  const source = new TextDecoder("latin1").decode(data);
  if (!/^%PDF-(?:1\.[0-7]|2\.0)[\r\n]/.test(source))
    throw new HttpError(
      400,
      "PDF signature is invalid: expected a %PDF- version header at the start of the file.",
    );
  if (!/%%EOF[\x00\t\n\f\r ]*$/.test(source))
    throw new HttpError(
      400,
      "PDF is incomplete: the final %%EOF marker is missing or has trailing data.",
    );
  const trailer = /startxref\s+(\d+)\s+%%EOF[\x00\t\n\f\r ]*$/.exec(source);
  const xrefOffset = trailer ? Number(trailer[1]) : -1;
  const target = source.slice(xrefOffset);
  if (
    !trailer ||
    xrefOffset < 0 ||
    xrefOffset >= trailer.index ||
    !/^(?:xref\s|\d+\s+\d+\s+obj\b)/.test(target)
  )
    throw new HttpError(
      400,
      "PDF cross-reference offset is missing or invalid. Export the PDF again.",
    );
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(data, {
      throwOnInvalidObject: true,
      updateMetadata: false,
    });
    if (!target.startsWith("xref")) {
      const header = /^(\d+)\s+(\d+)\s+obj\b/.exec(target)!;
      const stream = PDFObjectParser.forBytes(
        data.subarray(xrefOffset + header[0].length),
        doc.context,
      ).parseObject();
      if (
        !(stream instanceof PDFRawStream) ||
        stream.dict.lookup(PDFName.of("Type")) !== PDFName.of("XRef")
      )
        throw new Error("Invalid cross-reference stream");
    }
    if (
      doc.isEncrypted ||
      doc.catalog.get(PDFName.of("Type")) !== PDFName.of("Catalog") ||
      doc.getPageCount() < 1
    )
      throw new Error("Invalid page tree");
    for (const page of doc.getPages())
      if (page.node.get(PDFName.of("Type")) !== PDFName.of("Page"))
        throw new Error("Invalid page");
  } catch {
    throw new HttpError(
      400,
      "PDF could not be parsed or is encrypted. Export an unencrypted PDF and try again.",
    );
  }
  const blocked = new Set([
    "JavaScript",
    "JS",
    "Launch",
    "EmbeddedFile",
    "EmbeddedFiles",
    "RichMedia",
    "XFA",
  ]);
  // Inspect parsed names, including escaped names and compressed object streams.
  const visit = (object: unknown, depth = 0): void => {
    if (depth > 100)
      throw new HttpError(
        400,
        "PDF object nesting exceeds the validation limit.",
      );
    if (object instanceof PDFName && blocked.has(object.decodeText()))
      throw new HttpError(
        400,
        "PDF contains scripts, launch actions, embedded files or other unsupported active content. Export a static PDF.",
      );
    if (object instanceof PDFArray) {
      for (const item of object.asArray()) visit(item, depth + 1);
    } else if (object instanceof PDFDict) {
      for (const [key, value] of object.entries()) {
        visit(key, depth + 1);
        visit(value, depth + 1);
        if (key.decodeText() === "OpenAction") {
          const action = doc.context.lookup(value);
          // Destination arrays and local GoTo actions only select the opening page.
          if (
            !(action instanceof PDFArray) &&
            !(
              action instanceof PDFDict &&
              action.lookup(PDFName.of("S")) === PDFName.of("GoTo")
            )
          )
            throw new HttpError(
              400,
              "PDF opening action is unsupported. Export a PDF without automatic actions.",
            );
        }
        if (
          key.decodeText() === "S" &&
          value instanceof PDFName &&
          [
            "GoToR",
            "GoToE",
            "SubmitForm",
            "ImportData",
            "Rendition",
            "Movie",
            "Sound",
          ].includes(value.decodeText())
        )
          throw new HttpError(
            400,
            "PDF contains an unsupported active action. Export a static PDF.",
          );
      }
    }
  };
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    visit(object);
    if ("dict" in object) visit(object.dict);
  }
}
