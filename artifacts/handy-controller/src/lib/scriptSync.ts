import { setHDSP } from "./handyApi";

export interface FunscriptAction {
  at: number;
  pos: number;
}

export interface Funscript {
  actions: FunscriptAction[];
}

export class ScriptSyncEngine {
  private key: string = "";
  private script: Funscript | null = null;
  private isRunning: boolean = false;
  private animationFrameId: number | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private lastCallTime: number = 0;
  private readonly THROTTLE_MS = 1000 / 30; // max 30 calls per sec
  private velocity: number = 87;

  setKey(key: string) {
    this.key = key;
  }

  setScript(script: Funscript | null) {
    this.script = script;
  }

  setVideo(video: HTMLVideoElement | null) {
    this.videoElement = video;
  }
  
  setVelocity(vel: number) {
    this.velocity = vel;
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.loop();
  }

  stop() {
    this.isRunning = false;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  private loop = () => {
    if (!this.isRunning) return;

    this.update();

    this.animationFrameId = requestAnimationFrame(this.loop);
  };

  private update() {
    if (!this.key || !this.script || !this.videoElement || this.videoElement.paused) {
      return;
    }

    const now = performance.now();
    if (now - this.lastCallTime < this.THROTTLE_MS) {
      return;
    }

    const currentMs = this.videoElement.currentTime * 1000;
    const actions = this.script.actions;

    if (actions.length === 0) return;

    // Binary search for surrounding points
    let low = 0;
    let high = actions.length - 1;
    let mid = 0;

    while (low <= high) {
      mid = Math.floor((low + high) / 2);
      if (actions[mid].at === currentMs) {
        break;
      } else if (actions[mid].at < currentMs) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    // Interpolate
    let pos = 0;
    if (actions[mid].at === currentMs) {
      pos = actions[mid].pos;
    } else {
      let leftIdx = actions[mid].at <= currentMs ? mid : mid - 1;
      let rightIdx = leftIdx + 1;

      if (leftIdx < 0) {
        pos = actions[0].pos;
      } else if (rightIdx >= actions.length) {
        pos = actions[actions.length - 1].pos;
      } else {
        const left = actions[leftIdx];
        const right = actions[rightIdx];
        const t = (currentMs - left.at) / (right.at - left.at);
        pos = left.pos + t * (right.pos - left.pos);
      }
    }

    setHDSP(this.key, Math.round(pos), this.velocity);
    this.lastCallTime = now;
  }
}

// Global instance for the app
export const syncEngine = new ScriptSyncEngine();
