/**
 * Copying from an extension popup.
 *
 * `navigator.clipboard` needs the document focused, which a popup usually is but
 * is not guaranteed to be when the user clicks straight after it opens, so the
 * legacy path stays as a fallback.
 */
export async function copyText(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
    return;
  } catch {
    // Fall through.
  }

  const scratch = document.createElement("textarea");
  scratch.value = value;
  scratch.setAttribute("readonly", "");
  scratch.style.position = "fixed";
  scratch.style.opacity = "0";
  document.body.appendChild(scratch);
  scratch.select();

  try {
    document.execCommand("copy");
  } finally {
    document.body.removeChild(scratch);
  }
}
