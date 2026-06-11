declare module "pdf-parse" {
  interface PdfParseResult {
    text: string;
  }

  function pdfParse(data: Buffer | Uint8Array): Promise<PdfParseResult>;

  export default pdfParse;
}

declare module "jsdom" {
  export class JSDOM {
    public constructor(html?: string, options?: { url?: string });
    public window: {
      document: Document;
    };
  }
}
