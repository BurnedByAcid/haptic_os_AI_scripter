export const BASE = "https://www.handyfeeling.com/api/handy/v2";

const headers = (key: string) => ({ 
  "X-Connection-Key": key, 
  "Content-Type": "application/json",
  "Accept": "application/json"
});

export async function getStatus(key: string): Promise<{ connected: boolean; info?: any }> {
  try {
    const res = await fetch(`${BASE}/connected`, {
      method: "GET",
      headers: headers(key)
    });
    if (!res.ok) return { connected: false };
    const data = await res.json();
    return { connected: data.connected, info: data };
  } catch (e) {
    return { connected: false };
  }
}

export async function setMode(key: string, mode: number): Promise<void> {
  try {
    await fetch(`${BASE}/mode`, {
      method: "PUT",
      headers: headers(key),
      body: JSON.stringify({ mode })
    });
  } catch (e) {
    console.error("setMode error", e);
  }
}

export async function setHAMP(key: string, opts: { velocity?: number; slideMin?: number; slideMax?: number }): Promise<void> {
  try {
    // First ensure we are in HAMP mode (mode=0)
    await setMode(key, 0);

    if (opts.velocity !== undefined) {
      await fetch(`${BASE}/hamp/velocity`, {
        method: "PUT",
        headers: headers(key),
        body: JSON.stringify({ velocity: Math.min(opts.velocity, 87) })
      });
    }
    
    if (opts.slideMin !== undefined && opts.slideMax !== undefined) {
      await fetch(`${BASE}/hamp/slide`, {
        method: "PUT",
        headers: headers(key),
        body: JSON.stringify({ min: opts.slideMin, max: opts.slideMax })
      });
    }
  } catch (e) {
    console.error("setHAMP error", e);
  }
}

export async function setHDSP(key: string, position: number, velocity: number): Promise<void> {
  try {
    await fetch(`${BASE}/hdsp/xava`, {
      method: "PUT",
      headers: headers(key),
      body: JSON.stringify({ 
        position: Math.max(0, Math.min(100, position)), 
        velocity: Math.min(velocity, 87) 
      })
    });
  } catch (e) {
    console.error("setHDSP error", e);
  }
}

export async function stopDevice(key: string): Promise<void> {
  try {
    await fetch(`${BASE}/hamp/stop`, {
      method: "PUT",
      headers: headers(key)
    });
  } catch (e) {
    console.error("stopDevice error", e);
  }
}
