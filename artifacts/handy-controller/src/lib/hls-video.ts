import Hls from "hls.js";

// Tracks the active Hls instance keyed by video element so we can destroy
// and recreate it cleanly when the source changes.
const hlsInstances = new WeakMap<HTMLVideoElement, Hls>();

/**
 * Detach any existing hls.js instance bound to `video` and clean it up.
 */
export function detachHls(video: HTMLVideoElement): void {
  const existing = hlsInstances.get(video);
  if (existing) {
    existing.destroy();
    hlsInstances.delete(video);
  }
}

/**
 * Attach an HLS manifest URL to a `<video>` element.
 *
 * - Safari: uses native HLS — just sets `src` directly.
 * - Chrome/Firefox/others: creates an hls.js instance and loads via MSE.
 *
 * `authToken` is an optional Clerk JWT.  When provided, hls.js will attach it
 * as an `Authorization: Bearer <token>` header on every XHR it makes
 * (manifest, sub-manifest, segment).  This ensures the follow-on proxy routes
 * stay bound to the authenticated user even though the video stack issues the
 * requests rather than application code.
 *
 * Returns a cleanup function that destroys the hls.js instance (call it when
 * the component unmounts or the source changes).
 */
export function attachHlsSource(
  video: HTMLVideoElement,
  manifestUrl: string,
  authToken?: string | null,
): () => void {
  // Tear down any prior hls.js instance on this element first.
  detachHls(video);

  // Native HLS support (Safari, iOS)
  if (video.canPlayType("application/vnd.apple.mpegurl")) {
    video.src = manifestUrl;
    return () => { /* nothing to destroy for native HLS */ };
  }

  // hls.js for Chrome, Firefox, etc.
  if (!Hls.isSupported()) {
    // Last-ditch attempt: set src and hope for the best.
    video.src = manifestUrl;
    return () => {};
  }

  const hls = new Hls({
    enableWorker: true,
    lowLatencyMode: false,
    // -1 = automatic ABR: hls.js picks the starting level based on bandwidth
    // estimation and then adapts as playback continues.
    startLevel: -1,
    // Don't let the player size artificially cap the quality — the video
    // element may be smaller than the desired playback resolution.
    capLevelToPlayerSize: false,
    // Keep cross-origin fetch so canvas capture stays untainted.
    // When an auth token is present, attach it so the proxy routes can verify
    // the requesting user on every manifest and segment request.
    xhrSetup: (xhr) => {
      xhr.withCredentials = false;
      if (authToken) {
        xhr.setRequestHeader("Authorization", `Bearer ${authToken}`);
      }
    },
  });

  hls.loadSource(manifestUrl);
  hls.attachMedia(video);

  hlsInstances.set(video, hls);

  return () => {
    hls.destroy();
    hlsInstances.delete(video);
  };
}

/**
 * Returns the active hls.js instance bound to `video`, if any.
 * Returns undefined for native HLS (Safari) or non-HLS sources.
 */
export function getHls(video: HTMLVideoElement): Hls | undefined {
  return hlsInstances.get(video);
}

/**
 * Returns true if the given URL looks like an HLS manifest.
 */
export function isHlsUrl(url: string): boolean {
  try {
    const { pathname } = new URL(url);
    return pathname.includes(".m3u8");
  } catch {
    return false;
  }
}
