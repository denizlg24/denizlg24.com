/** Normalize line breaks commonly produced in LLM-authored whiteboard text. */
export function normalizeWhiteboardText(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/\\r\\n|\\n/g, "\n");
}
