import { describe, it, expect } from "vitest";
import {
  FUNSCRIPT_MAX_BYTES,
  validateFunscriptFile,
  validateFunscriptJson,
  validateAndParseFunscriptFile,
  validateVideoUrl,
} from "./validation";

// ─── Test helpers ──────────────────────────────────────────────────────────

function makeFile(
  contents: string,
  name: string,
  opts: { sizeOverride?: number } = {},
): File {
  const blob = new Blob([contents], { type: "application/json" });
  const file = new File([blob], name, { type: "application/json" });
  if (opts.sizeOverride !== undefined) {
    Object.defineProperty(file, "size", {
      value: opts.sizeOverride,
      configurable: true,
    });
  }
  return file;
}

// ─── validateFunscriptFile ─────────────────────────────────────────────────

describe("validateFunscriptFile", () => {
  it("rejects oversized files (> 50 MB)", () => {
    const file = makeFile("{}", "big.funscript", {
      sizeOverride: FUNSCRIPT_MAX_BYTES + 1,
    });
    const err = validateFunscriptFile(file);
    expect(err).not.toBeNull();
    expect(err?.code).toBe("TOO_LARGE");
  });

  it("accepts a file exactly at the size limit", () => {
    const file = makeFile("{}", "limit.funscript", {
      sizeOverride: FUNSCRIPT_MAX_BYTES,
    });
    expect(validateFunscriptFile(file)).toBeNull();
  });

  it("rejects wrong extensions", () => {
    const file = makeFile("{}", "script.txt");
    const err = validateFunscriptFile(file);
    expect(err?.code).toBe("WRONG_EXTENSION");
  });

  it("rejects files with no extension", () => {
    const file = makeFile("{}", "script");
    const err = validateFunscriptFile(file);
    expect(err?.code).toBe("WRONG_EXTENSION");
  });

  it("accepts .funscript extension (case insensitive)", () => {
    expect(validateFunscriptFile(makeFile("{}", "a.funscript"))).toBeNull();
    expect(validateFunscriptFile(makeFile("{}", "A.FUNSCRIPT"))).toBeNull();
  });

  it("accepts .json extension", () => {
    expect(validateFunscriptFile(makeFile("{}", "a.json"))).toBeNull();
  });
});

// ─── validateFunscriptJson ─────────────────────────────────────────────────

describe("validateFunscriptJson", () => {
  it("rejects non-object JSON", () => {
    expect(validateFunscriptJson("string")?.code).toBe("INVALID_JSON");
    expect(validateFunscriptJson(42)?.code).toBe("INVALID_JSON");
    expect(validateFunscriptJson(null)?.code).toBe("INVALID_JSON");
    expect(validateFunscriptJson([])?.code).toBe("INVALID_JSON");
  });

  it("rejects objects without an actions array", () => {
    expect(validateFunscriptJson({})?.code).toBe("MISSING_ACTIONS");
    expect(validateFunscriptJson({ actions: "nope" })?.code).toBe(
      "MISSING_ACTIONS",
    );
    expect(validateFunscriptJson({ actions: { at: 0, pos: 0 } })?.code).toBe(
      "MISSING_ACTIONS",
    );
  });

  it("rejects malformed action shapes", () => {
    // missing at/pos
    expect(validateFunscriptJson({ actions: [{}] })?.code).toBe(
      "INVALID_ACTION",
    );
    // wrong types
    expect(
      validateFunscriptJson({ actions: [{ at: "0", pos: 0 }] })?.code,
    ).toBe("INVALID_ACTION");
    expect(
      validateFunscriptJson({ actions: [{ at: 0, pos: "0" }] })?.code,
    ).toBe("INVALID_ACTION");
    // negative at
    expect(
      validateFunscriptJson({ actions: [{ at: -1, pos: 50 }] })?.code,
    ).toBe("INVALID_ACTION");
    // negative pos
    expect(
      validateFunscriptJson({ actions: [{ at: 0, pos: -1 }] })?.code,
    ).toBe("INVALID_ACTION");
    // pos > 100
    expect(
      validateFunscriptJson({ actions: [{ at: 0, pos: 101 }] })?.code,
    ).toBe("INVALID_ACTION");
    // null entry
    expect(validateFunscriptJson({ actions: [null] })?.code).toBe(
      "INVALID_ACTION",
    );
  });

  it("includes the offending index in INVALID_ACTION messages", () => {
    const err = validateFunscriptJson({
      actions: [
        { at: 0, pos: 0 },
        { at: 100, pos: 200 },
      ],
    });
    expect(err?.code).toBe("INVALID_ACTION");
    expect(err?.message).toContain("actions[1]");
  });

  it("accepts a valid funscript", () => {
    expect(
      validateFunscriptJson({
        actions: [
          { at: 0, pos: 0 },
          { at: 1000, pos: 50 },
          { at: 2000, pos: 100 },
        ],
      }),
    ).toBeNull();
  });

  it("accepts a funscript with an empty actions array", () => {
    expect(validateFunscriptJson({ actions: [] })).toBeNull();
  });

  it("accepts boundary pos values 0 and 100", () => {
    expect(
      validateFunscriptJson({
        actions: [
          { at: 0, pos: 0 },
          { at: 1, pos: 100 },
        ],
      }),
    ).toBeNull();
  });
});

// ─── validateAndParseFunscriptFile ─────────────────────────────────────────

describe("validateAndParseFunscriptFile", () => {
  it("throws on oversized file", async () => {
    const file = makeFile("{}", "big.funscript", {
      sizeOverride: FUNSCRIPT_MAX_BYTES + 1,
    });
    await expect(validateAndParseFunscriptFile(file)).rejects.toThrow(
      /too large/i,
    );
  });

  it("throws on wrong extension", async () => {
    const file = makeFile("{}", "x.txt");
    await expect(validateAndParseFunscriptFile(file)).rejects.toThrow(
      /\.funscript or \.json/,
    );
  });

  it("throws on malformed JSON", async () => {
    const file = makeFile("not json{", "x.funscript");
    await expect(validateAndParseFunscriptFile(file)).rejects.toThrow(
      /not valid JSON/,
    );
  });

  it("throws on missing actions", async () => {
    const file = makeFile(JSON.stringify({ foo: 1 }), "x.funscript");
    await expect(validateAndParseFunscriptFile(file)).rejects.toThrow(
      /actions/,
    );
  });

  it("throws on invalid action shape", async () => {
    const file = makeFile(
      JSON.stringify({ actions: [{ at: 0, pos: 200 }] }),
      "x.funscript",
    );
    await expect(validateAndParseFunscriptFile(file)).rejects.toThrow(
      /actions\[0\]/,
    );
  });

  it("returns parsed script for a valid file", async () => {
    const data = { actions: [{ at: 0, pos: 25 }] };
    const file = makeFile(JSON.stringify(data), "ok.funscript");
    const result = await validateAndParseFunscriptFile(file);
    expect(result.actions).toEqual(data.actions);
  });
});

// ─── validateVideoUrl ──────────────────────────────────────────────────────

describe("validateVideoUrl", () => {
  it("rejects malformed URLs", () => {
    expect(validateVideoUrl("not a url")?.code).toBe("INVALID_URL");
    expect(validateVideoUrl("")?.code).toBe("INVALID_URL");
  });

  it("rejects non-https schemes", () => {
    expect(validateVideoUrl("http://youtube.com/watch?v=x")?.code).toBe(
      "NOT_HTTPS",
    );
    expect(validateVideoUrl("ftp://example.com/a.mp4")?.code).toBe(
      "NOT_HTTPS",
    );
    expect(
      validateVideoUrl("javascript:alert(1)")?.code,
    ).toBe("NOT_HTTPS");
    expect(
      validateVideoUrl(
        "data:text/html,<script>alert(1)</script>",
      )?.code,
    ).toBe("NOT_HTTPS");
  });

  it("rejects private / loopback / link-local IPs and localhost", () => {
    const blocked = [
      "https://localhost/video.mp4",
      "https://127.0.0.1/video.mp4",
      "https://10.0.0.1/video.mp4",
      "https://192.168.1.1/video.mp4",
      "https://172.16.0.1/video.mp4",
      "https://172.31.255.255/video.mp4",
      "https://0.0.0.0/video.mp4",
      "https://[::1]/video.mp4",
      "https://[fc00::1]/video.mp4",
      "https://[fd12::1]/video.mp4",
    ];
    for (const url of blocked) {
      const err = validateVideoUrl(url);
      expect(err, `expected ${url} to be blocked`).not.toBeNull();
      expect(err?.code, `expected ${url} -> PRIVATE_IP`).toBe("PRIVATE_IP");
    }
  });

  it("does not block public IPs that are outside private ranges via PRIVATE_IP", () => {
    // 172.15 and 172.32 are public (only 172.16-172.31 is private)
    // These will be rejected for DISALLOWED_HOST instead.
    expect(validateVideoUrl("https://172.15.0.1/x.mp4")?.code).not.toBe(
      "PRIVATE_IP",
    );
    expect(validateVideoUrl("https://172.32.0.1/x.mp4")?.code).not.toBe(
      "PRIVATE_IP",
    );
  });

  it("accepts allowed hosts", () => {
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
      expect(validateVideoUrl(url), `expected ${url} to be allowed`).toBeNull();
    }
  });

  it("rejects disallowed hosts that are not direct video files", () => {
    const err = validateVideoUrl("https://evil.example.com/page");
    expect(err?.code).toBe("DISALLOWED_HOST");
  });

  it("accepts direct video file URLs on arbitrary hosts", () => {
    expect(
      validateVideoUrl("https://cdn.example.com/clip.mp4"),
    ).toBeNull();
    expect(
      validateVideoUrl("https://cdn.example.com/clip.webm"),
    ).toBeNull();
    expect(
      validateVideoUrl("https://cdn.example.com/clip.ogg"),
    ).toBeNull();
    expect(
      validateVideoUrl("https://cdn.example.com/clip.mov"),
    ).toBeNull();
    // case insensitive + query string
    expect(
      validateVideoUrl("https://cdn.example.com/clip.MP4?token=abc"),
    ).toBeNull();
  });

  it("trims surrounding whitespace before validating", () => {
    expect(
      validateVideoUrl("  https://youtu.be/abc  "),
    ).toBeNull();
  });

  it("is case-insensitive on hostnames", () => {
    expect(validateVideoUrl("https://YouTube.com/watch?v=x")).toBeNull();
  });
});
