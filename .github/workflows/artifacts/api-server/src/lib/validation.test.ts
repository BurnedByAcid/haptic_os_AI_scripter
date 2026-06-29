import { describe, it, expect } from "vitest";
import {
  FIELD_LIMITS,
  sanitizeText,
  validateUrl,
  validateFunscriptJson,
} from "./validation";

// ─── sanitizeText ──────────────────────────────────────────────────────────

describe("sanitizeText", () => {
  it("returns empty string for non-strings", () => {
    expect(sanitizeText(undefined)).toBe("");
    expect(sanitizeText(null)).toBe("");
    expect(sanitizeText(42)).toBe("");
    expect(sanitizeText({})).toBe("");
    expect(sanitizeText([])).toBe("");
  });

  it("strips HTML tags entirely", () => {
    expect(sanitizeText("<b>hello</b>")).toBe("hello");
    expect(sanitizeText("<p>foo</p><p>bar</p>")).toBe("foobar");
  });

  it("removes <script> blocks including their contents", () => {
    const out = sanitizeText("safe<script>alert('xss')</script>tail");
    expect(out).not.toContain("alert");
    expect(out).not.toContain("<script>");
    expect(out).toContain("safe");
    expect(out).toContain("tail");
  });

  it("strips inline event handlers and attributes", () => {
    const out = sanitizeText('<a href="x" onclick="bad()">click</a>');
    expect(out).toBe("click");
    expect(out).not.toContain("onclick");
    expect(out).not.toContain("href");
  });

  it("replaces ASCII control characters with spaces", () => {
    expect(sanitizeText("a\x00b\x01c\x1Fd\x7Fe")).toBe("a b c d e");
  });

  it("preserves regular whitespace inside the string", () => {
    expect(sanitizeText("hello world")).toBe("hello world");
  });

  it("trims leading and trailing whitespace", () => {
    expect(sanitizeText("   spaced   ")).toBe("spaced");
    expect(sanitizeText("\n  text  \n")).toBe("text");
  });

  it("handles a benign normal string unchanged", () => {
    expect(sanitizeText("Cool funscript by Author #1")).toBe(
      "Cool funscript by Author #1",
    );
  });

  it("FIELD_LIMITS define expected size caps", () => {
    expect(FIELD_LIMITS.title).toBe(255);
    expect(FIELD_LIMITS.description).toBe(2000);
    expect(FIELD_LIMITS.author_name).toBe(100);
    expect(FIELD_LIMITS.tags).toBe(500);
  });
});

// ─── validateUrl ───────────────────────────────────────────────────────────

describe("validateUrl", () => {
  it("rejects malformed URLs", () => {
    expect(validateUrl("not a url")).toMatch(/not a valid URL/);
    expect(validateUrl("")).toMatch(/not a valid URL/);
  });

  it("rejects non-https schemes", () => {
    expect(validateUrl("http://youtube.com/watch?v=x")).toMatch(/HTTPS/);
    expect(validateUrl("ftp://example.com/a.mp4")).toMatch(/HTTPS/);
    expect(validateUrl("javascript:alert(1)")).toMatch(/HTTPS/);
    expect(validateUrl("data:text/html,xx")).toMatch(/HTTPS/);
  });

  it("rejects private / loopback / link-local IP ranges", () => {
    const blocked = [
      "https://localhost/v.mp4",
      "https://127.0.0.1/v.mp4",
      "https://10.0.0.1/v.mp4",
      "https://192.168.1.1/v.mp4",
      "https://172.16.0.1/v.mp4",
      "https://172.31.255.255/v.mp4",
      "https://0.0.0.0/v.mp4",
      "https://[::1]/v.mp4",
      "https://[fc00::1]/v.mp4",
      "https://[fd12::1]/v.mp4",
    ];
    for (const url of blocked) {
      const err = validateUrl(url);
      expect(err, `expected ${url} to be blocked`).toMatch(
        /private or local address/,
      );
    }
  });

  it("accepts every allowed embed host", () => {
    const allowed = [
      "https://youtube.com/watch?v=x",
      "https://www.youtube.com/watch?v=x",
      "https://m.youtube.com/watch?v=x",
      "https://youtu.be/x",
      "https://pornhub.com/view_video.php?viewkey=x",
      "https://www.pornhub.com/",
      "https://xvideos.com/",
      "https://www.xvideos.com/",
      "https://xhamster.com/",
      "https://www.xhamster.com/",
      "https://xhamster.desi/",
      "https://redtube.com/",
      "https://www.redtube.com/",
      "https://vimeo.com/12345",
      "https://www.vimeo.com/12345",
      "https://player.vimeo.com/video/12345",
    ];
    for (const url of allowed) {
      expect(validateUrl(url), `expected ${url} to be accepted`).toBeNull();
    }
  });

  it("rejects disallowed hosts that are not direct video files", () => {
    expect(validateUrl("https://evil.example.com/page")).toMatch(
      /allowed platform/,
    );
  });

  it("accepts direct video URLs on arbitrary public hosts", () => {
    expect(validateUrl("https://cdn.example.com/clip.mp4")).toBeNull();
    expect(validateUrl("https://cdn.example.com/clip.webm")).toBeNull();
    expect(validateUrl("https://cdn.example.com/clip.ogg")).toBeNull();
    expect(validateUrl("https://cdn.example.com/clip.mov")).toBeNull();
    expect(
      validateUrl("https://cdn.example.com/clip.MP4?token=abc"),
    ).toBeNull();
  });

  it("trims surrounding whitespace", () => {
    expect(validateUrl("   https://youtu.be/abc   ")).toBeNull();
  });

  it("treats hostnames case-insensitively", () => {
    expect(validateUrl("https://YouTube.com/watch?v=x")).toBeNull();
  });
});

// ─── validateFunscriptJson ─────────────────────────────────────────────────

describe("validateFunscriptJson (backend)", () => {
  it("rejects non-object JSON", () => {
    expect(validateFunscriptJson("foo")).toMatch(/JSON object/);
    expect(validateFunscriptJson(42)).toMatch(/JSON object/);
    expect(validateFunscriptJson(null)).toMatch(/JSON object/);
    expect(validateFunscriptJson([])).toMatch(/JSON object/);
  });

  it("rejects objects without an actions array", () => {
    expect(validateFunscriptJson({})).toMatch(/actions/);
    expect(validateFunscriptJson({ actions: "nope" })).toMatch(/actions/);
    expect(validateFunscriptJson({ actions: { at: 0, pos: 0 } })).toMatch(
      /actions/,
    );
  });

  it("rejects bad action shapes", () => {
    expect(validateFunscriptJson({ actions: [{}] })).toMatch(/actions\[0\]/);
    expect(
      validateFunscriptJson({ actions: [{ at: "0", pos: 0 }] }),
    ).toMatch(/actions\[0\]/);
    expect(
      validateFunscriptJson({ actions: [{ at: 0, pos: "0" }] }),
    ).toMatch(/actions\[0\]/);
    expect(
      validateFunscriptJson({ actions: [{ at: -1, pos: 50 }] }),
    ).toMatch(/actions\[0\]/);
    expect(
      validateFunscriptJson({ actions: [{ at: 0, pos: -1 }] }),
    ).toMatch(/actions\[0\]/);
    expect(
      validateFunscriptJson({ actions: [{ at: 0, pos: 101 }] }),
    ).toMatch(/actions\[0\]/);
    expect(validateFunscriptJson({ actions: [null] })).toMatch(/actions\[0\]/);
  });

  it("reports the index of the first bad action when there are several", () => {
    expect(
      validateFunscriptJson({
        actions: [
          { at: 0, pos: 0 },
          { at: 1, pos: 50 },
          { at: 2, pos: 9999 },
        ],
      }),
    ).toMatch(/actions\[2\]/);
  });

  it("accepts a valid funscript", () => {
    expect(
      validateFunscriptJson({
        actions: [
          { at: 0, pos: 0 },
          { at: 100, pos: 100 },
        ],
      }),
    ).toBeNull();
  });

  it("accepts an empty actions array", () => {
    expect(validateFunscriptJson({ actions: [] })).toBeNull();
  });
});
