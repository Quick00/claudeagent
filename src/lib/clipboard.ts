/**
 * Copies text to the clipboard and reports whether it worked. Falls back to a
 * hidden textarea + `execCommand('copy')` in non-secure contexts (HTTP on a
 * LAN), where `navigator.clipboard` is missing. `execCommand` is deprecated
 * but is still the standard fallback for that case.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    } finally {
      document.body.removeChild(textarea);
    }
  }
}
