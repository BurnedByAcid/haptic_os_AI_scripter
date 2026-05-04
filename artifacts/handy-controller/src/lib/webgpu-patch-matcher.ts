/**
 * WebGPU-accelerated patch similarity scorer.
 *
 * Pipeline per frame:
 *   1. createImageBitmap(video) captures the current frame as an ImageBitmap.
 *   2. device.queue.copyExternalImageToTexture copies it into a regular
 *      texture_2d<f32> (TEXTURE_BINDING | COPY_DST | RENDER_ATTACHMENT).
 *   3. A compute dispatch (8×8 workgroups) reads patch pixels from the frame
 *      texture, computes squared grayscale differences against the reference
 *      float buffer, and reduces within each workgroup using workgroup-shared
 *      memory, writing one partial sum per workgroup.
 *   4. The partial sums are copied to a staging buffer and read back via mapAsync.
 *   5. CPU sums the partials, divides by patch area, and returns √(msd) × 255 —
 *      the same scale as GlPatchMatcher and the CPU patchRms helper.
 *
 * Use WebGpuPatchMatcher.create() (async) instead of `new`.
 * Throws if navigator.gpu is absent or adapter/device acquisition fails.
 */

const WGSL = /* wgsl */ `
struct Params {
  patchX   : u32,
  patchY   : u32,
  patchW   : u32,
  patchH   : u32,
  wgCountX : u32,
}

@group(0) @binding(0) var          frameTex  : texture_2d<f32>;
@group(0) @binding(1) var<storage, read>           refData   : array<f32>;
@group(0) @binding(2) var<storage, read_write>     partials  : array<f32>;
@group(0) @binding(3) var<uniform>                 params    : Params;

var<workgroup> localSums : array<f32, 64>;

@compute @workgroup_size(8, 8, 1)
fn main(
  @builtin(global_invocation_id)    gid  : vec3<u32>,
  @builtin(local_invocation_index)  lid  : u32,
  @builtin(workgroup_id)            wgid : vec3<u32>,
) {
  let px = gid.x;
  let py = gid.y;
  var diff : f32 = 0.0;

  if (px < params.patchW && py < params.patchH) {
    let vx = i32(params.patchX + px);
    let vy = i32(params.patchY + py);
    let col = textureLoad(frameTex, vec2<i32>(vx, vy), 0);
    let fg  = dot(col.rgb, vec3<f32>(0.299, 0.587, 0.114));
    let ref = refData[py * params.patchW + px];
    let d   = fg - ref;
    diff    = d * d;
  }

  localSums[lid] = diff;
  workgroupBarrier();

  if (lid < 32u) { localSums[lid] += localSums[lid + 32u]; } workgroupBarrier();
  if (lid < 16u) { localSums[lid] += localSums[lid + 16u]; } workgroupBarrier();
  if (lid <  8u) { localSums[lid] += localSums[lid +  8u]; } workgroupBarrier();
  if (lid <  4u) { localSums[lid] += localSums[lid +  4u]; } workgroupBarrier();
  if (lid <  2u) { localSums[lid] += localSums[lid +  2u]; } workgroupBarrier();
  if (lid <  1u) { localSums[lid] += localSums[lid +  1u]; } workgroupBarrier();

  if (lid == 0u) {
    partials[wgid.y * params.wgCountX + wgid.x] = localSums[0];
  }
}
`;

/** Maximum number of workgroup partial sums we pre-allocate for. */
const MAX_PARTIALS = 4096; // covers patches up to ~512 × 512 with 8×8 tiles

export class WebGpuPatchMatcher {
  private device: GPUDevice;
  private pipeline: GPUComputePipeline;
  private refBuffer: GPUBuffer;
  private partialsBuffer: GPUBuffer;
  private stagingBuffer: GPUBuffer;
  private paramsBuffer: GPUBuffer;
  /** Reusable frame texture — recreated only when video dimensions change. */
  private frameTex: GPUTexture | null = null;
  private frameTexW = 0;
  private frameTexH = 0;
  private patchW = 0;
  private patchH = 0;
  private refCapacity = 0;

  private constructor(
    device: GPUDevice,
    pipeline: GPUComputePipeline,
    refBuffer: GPUBuffer,
    partialsBuffer: GPUBuffer,
    stagingBuffer: GPUBuffer,
    paramsBuffer: GPUBuffer,
  ) {
    this.device         = device;
    this.pipeline       = pipeline;
    this.refBuffer      = refBuffer;
    this.partialsBuffer = partialsBuffer;
    this.stagingBuffer  = stagingBuffer;
    this.paramsBuffer   = paramsBuffer;
  }

  /** Async factory — throws if WebGPU is unavailable or device acquisition fails. */
  static async create(): Promise<WebGpuPatchMatcher> {
    if (!navigator.gpu) throw new Error("WebGPU: navigator.gpu not available");

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error("WebGPU: no adapter");

    const device = await adapter.requestDevice();

    const shaderModule = device.createShaderModule({ code: WGSL });
    const pipeline = await device.createComputePipelineAsync({
      layout: "auto",
      compute: { module: shaderModule, entryPoint: "main" },
    });

    const initialRefCap = 256 * 256;
    const refBuffer = device.createBuffer({
      size: initialRefCap * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    const partialsBuffer = device.createBuffer({
      size: MAX_PARTIALS * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });

    const stagingBuffer = device.createBuffer({
      size: MAX_PARTIALS * 4,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });

    // 5 × u32 (patchX, patchY, patchW, patchH, wgCountX) + 3 pad = 32 bytes (16-byte aligned)
    const paramsBuffer = device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const matcher = new WebGpuPatchMatcher(
      device, pipeline, refBuffer, partialsBuffer, stagingBuffer, paramsBuffer,
    );
    matcher.refCapacity = initialRefCap;
    return matcher;
  }

  /** Call once after sampling the patch. gray = uint8 grayscale array, w/h = patch pixel dims. */
  setReference(gray: Uint8Array, w: number, h: number): void {
    this.patchW = w;
    this.patchH = h;

    const needed = w * h;
    if (needed > this.refCapacity) {
      this.refBuffer.destroy();
      this.refBuffer = this.device.createBuffer({
        size: needed * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      this.refCapacity = needed;
    }

    const f32 = new Float32Array(needed);
    for (let i = 0; i < needed; i++) f32[i] = gray[i] / 255;
    this.device.queue.writeBuffer(this.refBuffer, 0, f32);
  }

  /**
   * Compute RMS difference vs reference in 0–255 scale (matches GlPatchMatcher / CPU patchRms).
   * nx/ny/nw/nh: patch rectangle in normalised video coords (0–1, top-left origin).
   */
  async computeRms(
    video: HTMLVideoElement,
    nx: number,
    ny: number,
    nw: number,
    nh: number,
  ): Promise<number> {
    const pw = this.patchW;
    const ph = this.patchH;
    if (pw === 0 || ph === 0) throw new Error("call setReference first");

    const vw = video.videoWidth  || 640;
    const vh = video.videoHeight || 360;
    const patchX = Math.round(nx * vw);
    const patchY = Math.round(ny * vh);

    const wgX = Math.ceil(pw / 8);
    const wgY = Math.ceil(ph / 8);
    const numPartials = wgX * wgY;

    if (numPartials > MAX_PARTIALS) {
      throw new Error(`Patch too large (${numPartials} workgroups > ${MAX_PARTIALS})`);
    }

    // ── Capture the current video frame into a GPU texture ──────────────────
    // createImageBitmap gives a snapshot of the current frame that can be
    // uploaded via copyExternalImageToTexture into a regular texture_2d,
    // which is valid as a compute shader texture binding.
    const bmp = await createImageBitmap(video);

    if (bmp.width !== this.frameTexW || bmp.height !== this.frameTexH) {
      this.frameTex?.destroy();
      this.frameTex = this.device.createTexture({
        size: [bmp.width, bmp.height],
        format: "rgba8unorm",
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_DST |
          GPUTextureUsage.RENDER_ATTACHMENT,
      });
      this.frameTexW = bmp.width;
      this.frameTexH = bmp.height;
    }

    this.device.queue.copyExternalImageToTexture(
      { source: bmp },
      { texture: this.frameTex! },
      [bmp.width, bmp.height],
    );
    bmp.close();

    // ── Upload uniform params ────────────────────────────────────────────────
    const paramsData = new Uint32Array([patchX, patchY, pw, ph, wgX]);
    this.device.queue.writeBuffer(this.paramsBuffer, 0, paramsData);

    // ── Build bind group and dispatch ────────────────────────────────────────
    const bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.frameTex!.createView() },
        { binding: 1, resource: { buffer: this.refBuffer } },
        { binding: 2, resource: { buffer: this.partialsBuffer } },
        { binding: 3, resource: { buffer: this.paramsBuffer } },
      ],
    });

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(wgX, wgY, 1);
    pass.end();

    const readBytes = numPartials * 4;
    encoder.copyBufferToBuffer(this.partialsBuffer, 0, this.stagingBuffer, 0, readBytes);
    this.device.queue.submit([encoder.finish()]);

    // ── Read back and reduce on CPU ──────────────────────────────────────────
    await this.stagingBuffer.mapAsync(GPUMapMode.READ, 0, readBytes);
    const arr = new Float32Array(this.stagingBuffer.getMappedRange(0, readBytes));
    let sum = 0;
    for (let i = 0; i < numPartials; i++) sum += arr[i];
    this.stagingBuffer.unmap();

    // mean-squared-diff in [0, 1]; scale to [0, 255] to match CPU / WebGL paths
    const msd = sum / (pw * ph);
    return Math.sqrt(msd) * 255;
  }

  destroy(): void {
    this.frameTex?.destroy();
    this.refBuffer.destroy();
    this.partialsBuffer.destroy();
    this.stagingBuffer.destroy();
    this.paramsBuffer.destroy();
    this.device.destroy();
  }
}
