import encode, { init } from '@jsquash/webp/encode.js';
import wasm from '@jsquash/webp/codec/enc/webp_enc.wasm?url';
import simdWasm from '@jsquash/webp/codec/enc/webp_enc_simd.wasm?url';

let initialized: Promise<unknown> | undefined;

/** Vite-managed, same-origin assets are included in the offline build manifest. */
export async function encodeWebP(pixels: ImageData, quality: number): Promise<Uint8Array> {
  if (!initialized) initialized = init({ locateFile: (path: string) => path.includes('_simd') ? simdWasm : wasm });
  try {
    await initialized;
    // Yield before CPU work so Safari can paint the preparation status.
    await new Promise(resolve => setTimeout(resolve, 0));
    return new Uint8Array(await encode(pixels, { quality, method: 4, use_sharp_yuv: 1 }));
  } catch (error) {
    initialized = undefined;
    throw new Error('Could not prepare this photo. Try again; your saved photos are unchanged.', { cause: error });
  }
}
