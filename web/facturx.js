const XML_CANDIDATES = ["factur-x.xml", "zugferd-invoice.xml", "xrechnung.xml"];

const decodeXml = (bytes) => {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (data[0] === 0xff && data[1] === 0xfe) return new TextDecoder("utf-16le").decode(data);
  if (data[0] === 0xfe && data[1] === 0xff) {
    const swapped = new Uint8Array(data.length - 2);
    for (let index = 2; index + 1 < data.length; index += 2) {
      swapped[index - 2] = data[index + 1];
      swapped[index - 1] = data[index];
    }
    return new TextDecoder("utf-16le").decode(swapped);
  }
  return new TextDecoder("utf-8").decode(data);
};

const looksLikeInvoiceXml = (text) => /<(?:\w+:)?CrossIndustryInvoice\b|<(?:\w+:)?Invoice\b|<(?:\w+:)?CreditNote\b/i.test(text);

export async function extractFacturXXml(file, pdfjsModule = null) {
  const pdfjs = pdfjsModule || await import("./vendor/pdf.mjs");
  if (!pdfjsModule) pdfjs.GlobalWorkerOptions.workerSrc = new URL("./vendor/pdf.worker.mjs", import.meta.url).href;

  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    isEvalSupported: false,
    useWorkerFetch: false
  });

  let document;
  try {
    document = await loadingTask.promise;
    const attachments = await document.getAttachments();
    const entries = attachments instanceof Map
      ? [...attachments.entries()]
      : Object.entries(attachments || {});
    if (!entries.length) throw new Error("Ce PDF ne contient aucun XML embarqué. Il ne semble pas être une facture Factur-X.");

    const ranked = entries.sort(([leftName], [rightName]) => {
      const rank = (name) => {
        const normalized = name.toLowerCase();
        const index = XML_CANDIDATES.indexOf(normalized);
        return index === -1 ? 99 : index;
      };
      return rank(leftName) - rank(rightName);
    });

    for (const [name, attachment] of ranked) {
      if (!/\.xml$/i.test(name) && !/xml/i.test(attachment?.filename || "")) continue;
      const content = attachment?.content || await document.getAttachmentContent(name);
      if (!content) continue;
      const xmlText = decodeXml(content).replace(/^\uFEFF/, "").trim();
      if (looksLikeInvoiceXml(xmlText)) {
        return { xmlText, attachmentName: attachment.filename || name, container: "FACTUR-X" };
      }
    }

    throw new Error("Le PDF contient des pièces jointes, mais aucun XML de facture UBL/CII exploitable.");
  } catch (error) {
    if (error?.message?.includes("PDF")) throw error;
    throw new Error(`Factur-X non lisible : ${error?.message || "extraction impossible"}.`);
  } finally {
    await loadingTask.destroy();
  }
}
