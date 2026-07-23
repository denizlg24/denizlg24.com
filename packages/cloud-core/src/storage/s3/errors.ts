const XML_CONTENT_TYPE = "application/xml";

export class S3Error extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly resource?: string,
  ) {
    super(message);
    this.name = "S3Error";
  }
}

export function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function s3ErrorResponse(error: S3Error, requestId: string): Response {
  const resource = error.resource
    ? `<Resource>${escapeXml(error.resource)}</Resource>`
    : "";
  const body = `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${escapeXml(error.code)}</Code><Message>${escapeXml(error.message)}</Message>${resource}<RequestId>${requestId}</RequestId></Error>`;
  return new Response(body, {
    status: error.status,
    headers: {
      "Content-Type": XML_CONTENT_TYPE,
      "x-amz-request-id": requestId,
    },
  });
}

export function xmlResponse(
  body: string,
  status = 200,
  headers?: HeadersInit,
): Response {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>${body}`, {
    status,
    headers: { "Content-Type": XML_CONTENT_TYPE, ...headers },
  });
}
