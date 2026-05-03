/**
 * Returns a stripped, title-cased host label for a given URL.
 *
 * Rules applied in order:
 *  1. Parse hostname via URL constructor (throws on malformed input → return "").
 *  2. Strip a leading `www.` prefix.
 *  3. Strip multi-part ccTLDs (.co.uk, .com.au, .net.au, .org.uk, …).
 *  4. Strip any remaining single TLD (.com, .net, .tv, …).
 *  5. If subdomains still remain, take the last label.
 *  6. Title-case the result.
 *
 * Examples:
 *   "https://www.pornhub.com/..."  → "Pornhub"
 *   "https://xhamster.com/..."     → "Xhamster"
 *   "https://youtube.com/..."      → "Youtube"
 *   "https://example.co.uk/..."    → "Example"
 *   "https://sub.domain.co.uk/..."  → "Domain"
 */
export function getHostLabel(url: string): string {
  try {
    let hostname = new URL(url).hostname.toLowerCase();
    // Strip leading www.
    hostname = hostname.replace(/^www\./, "");
    // Strip multi-part ccTLDs: .(co|com|net|org|gov|edu|ac|sch|me|tv|info|biz|io).[a-z]{2}
    // Only apply single-TLD stripping afterwards if no multi-part ccTLD was found —
    // otherwise "sub.example" (post-ccTLD strip) would incorrectly lose ".example".
    const multiPartTLDRegex =
      /\.(co|com|net|org|gov|edu|ac|sch|me|tv|info|biz|io)\.[a-z]{2}$/i;
    const hadMultiPartTLD = multiPartTLDRegex.test(hostname);
    hostname = hostname.replace(multiPartTLDRegex, "");
    if (!hadMultiPartTLD) {
      hostname = hostname.replace(/\.[a-z]{2,}$/i, "");
    }
    // If subdomains remain take the last segment
    const parts = hostname.split(".");
    const name = parts[parts.length - 1];
    if (!name) return "";
    return name.charAt(0).toUpperCase() + name.slice(1);
  } catch {
    return "";
  }
}
