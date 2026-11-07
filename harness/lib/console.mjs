/**
 * Console messages that only say the browser cancelled one of the page's own loads: a navigation, a closed
 * page or a terminated worker cut it off while it was coming. Not an application failure: a load the app
 * needed and didn't get shows as a failed check or a page error.
 *
 * - WebKit says "Cannot load <url> due to access control checks." for any cancelled load, the scripts of a
 *   worker that is starting (the page's idle warm-up starts two) and their blob: bootstrap included.
 * - Firefox says "downloadable font: download failed (…): status=2152398850 source: <url>" for a font
 *   (2152398850 is NS_BINDING_ABORTED).
 *
 * Only for the page's own origin: there a load can't fail access control checks, while a cross-origin one may.
 */
const CANCELLED = [
  /^Cannot load (\S+) due to access control checks\.$/,
  /downloadable font: download failed \(.*\): status=2152398850 source: ([^\s"]+)/,
];

/** Whether console message `text`, logged on a page at `pageUrl`, is only a cancelled load of the page's own. */
export function cancelledLoad(text, pageUrl) {
  for (const re of CANCELLED) {
    const m = re.exec(text);
    if (!m) continue;
    try {
      return new URL(m[1].replace(/^blob:/, '')).origin === new URL(pageUrl).origin;
    } catch {
      return false;
    }
  }
  return false;
}
