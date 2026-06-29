import { describe, it, expect } from "vitest";
import { getHostLabel } from "./url-utils";

describe("getHostLabel", () => {
  // ── Common platforms ──────────────────────────────────────────────────────

  it("strips scheme and TLD, title-cases common hosts", () => {
    expect(getHostLabel("https://youtube.com/watch?v=abc")).toBe("Youtube");
    expect(getHostLabel("https://pornhub.com/view_video.php?viewkey=abc")).toBe("Pornhub");
    expect(getHostLabel("https://xhamster.com/videos/abc")).toBe("Xhamster");
    expect(getHostLabel("https://xvideos.com/video123")).toBe("Xvideos");
    expect(getHostLabel("https://redtube.com/12345")).toBe("Redtube");
    expect(getHostLabel("https://vimeo.com/12345")).toBe("Vimeo");
  });

  // ── www. stripping ────────────────────────────────────────────────────────

  it("strips leading www.", () => {
    expect(getHostLabel("https://www.pornhub.com/")).toBe("Pornhub");
    expect(getHostLabel("https://www.youtube.com/watch?v=x")).toBe("Youtube");
    expect(getHostLabel("https://www.vimeo.com/12345")).toBe("Vimeo");
  });

  // ── Country-code TLDs (.co.uk, .com.au, etc.) ────────────────────────────

  it("strips multi-part ccTLDs (.co.uk)", () => {
    expect(getHostLabel("https://example.co.uk/page")).toBe("Example");
    expect(getHostLabel("https://www.bbc.co.uk/news")).toBe("Bbc");
  });

  it("strips multi-part ccTLDs (.com.au)", () => {
    expect(getHostLabel("https://example.com.au/")).toBe("Example");
  });

  it("strips multi-part ccTLDs (.org.uk)", () => {
    expect(getHostLabel("https://example.org.uk/")).toBe("Example");
  });

  it("strips multi-part ccTLDs (.net.au)", () => {
    expect(getHostLabel("https://example.net.au/path")).toBe("Example");
  });

  // ── Subdomains ────────────────────────────────────────────────────────────

  it("returns the SLD when a non-www subdomain is present", () => {
    // m.youtube.com → strip www? no. strip .com → m.youtube → last segment = youtube
    expect(getHostLabel("https://m.youtube.com/watch?v=x")).toBe("Youtube");
  });

  it("strips www. but keeps remaining subdomain label correctly", () => {
    // sub.example.co.uk → remove www (none), remove .co.uk → sub.example → last = example
    expect(getHostLabel("https://sub.example.co.uk/page")).toBe("Example");
  });

  it("handles player subdomain (e.g. player.vimeo.com)", () => {
    // player.vimeo.com → strip .com → player.vimeo → last segment = vimeo
    expect(getHostLabel("https://player.vimeo.com/video/12345")).toBe("Vimeo");
  });

  // ── Various single TLDs ───────────────────────────────────────────────────

  it("strips .net TLD", () => {
    expect(getHostLabel("https://example.net/page")).toBe("Example");
  });

  it("strips .tv TLD", () => {
    expect(getHostLabel("https://example.tv/live")).toBe("Example");
  });

  it("strips .io TLD", () => {
    expect(getHostLabel("https://example.io/app")).toBe("Example");
  });

  it("strips two-letter ccTLDs (.de, .fr, etc.)", () => {
    expect(getHostLabel("https://example.de/")).toBe("Example");
    expect(getHostLabel("https://example.fr/")).toBe("Example");
    expect(getHostLabel("https://example.jp/")).toBe("Example");
  });

  // ── youtu.be short link ───────────────────────────────────────────────────

  it("handles youtu.be short links", () => {
    // youtu.be → strip .be → youtu
    expect(getHostLabel("https://youtu.be/abcDEF123")).toBe("Youtu");
  });

  // ── xhamster variants ─────────────────────────────────────────────────────

  it("handles xhamster.desi and similar variants", () => {
    // xhamster.desi → strip .desi (4-letter TLD) → xhamster
    expect(getHostLabel("https://xhamster.desi/")).toBe("Xhamster");
  });

  // ── Edge cases ────────────────────────────────────────────────────────────

  it("returns empty string for a malformed URL", () => {
    expect(getHostLabel("not a url")).toBe("");
    expect(getHostLabel("")).toBe("");
  });

  it("is case-insensitive on input hostname", () => {
    expect(getHostLabel("https://YouTube.COM/watch?v=x")).toBe("Youtube");
  });

  it("handles URL with path, query, and fragment", () => {
    expect(getHostLabel("https://www.xvideos.com/video123?ref=foo#bar")).toBe("Xvideos");
  });
});
