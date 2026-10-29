/** Limit new uploads to 100 decimal kB of image bytes, excluding base64 overhead. */
export const MAX_BEAN_PHOTO_BYTES = 100_000;
const JPEG_PREFIX = 'data:image/jpeg;base64,';

/** Exact decoded size of a canonical image data URL, excluding its MIME prefix. */
export function beanPhotoByteLength(value: string): number {
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return (value.length - value.indexOf(',') - 1) / 4 * 3 - padding;
}

/** Image data URLs keep photos portable in both CSV and Parquet backups. */
export function isBeanPhoto(value: string): boolean {
  return value.length <= 2_000_000 && (/^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]*={0,2}$/.test(value) || isValidWebPPhoto(value));
}

/** Preserve the historical JPEG validation contract for older records/backups. */
export function isValidJPEGPhoto(value: string): boolean {
  if (!value.startsWith(JPEG_PREFIX) || !isBeanPhoto(value)) return false;
  const encoded = value.slice(JPEG_PREFIX.length);
  try {
    const bytes = atob(encoded);
    return btoa(bytes) === encoded && bytes.startsWith('\xff\xd8\xff') && bytes.endsWith('\xff\xd9');
  } catch { return false; }
}

export function isValidWebPPhoto(value: string): boolean {
  const prefix = 'data:image/webp;base64,';
  if (value.length > 2_000_000 || !value.startsWith(prefix)) return false;
  try {
    const encoded = value.slice(prefix.length);
    const bytes = atob(encoded);
    if (btoa(bytes) !== encoded || bytes.length < 20 || !bytes.startsWith('RIFF') || bytes.slice(8, 12) !== 'WEBP') return false;
    const u32 = (offset: number): number => (bytes.charCodeAt(offset) | bytes.charCodeAt(offset + 1) << 8 |
      bytes.charCodeAt(offset + 2) << 16 | bytes.charCodeAt(offset + 3) << 24) >>> 0;
    if (u32(4) !== bytes.length - 8) return false;
    let image = false;
    let offset = 12;
    while (offset + 8 <= bytes.length) {
      const type = bytes.slice(offset, offset + 4);
      const size = u32(offset + 4);
      const start = offset + 8;
      const end = start + size;
      if (end > bytes.length) return false;
      if (type === 'VP8 ') {
        if (size < 10 || (bytes.charCodeAt(start) & 1) !== 0 || bytes.slice(start + 3, start + 6) !== '\x9d\x01\x2a') return false;
        image = true;
      } else if (type === 'VP8L') {
        if (size < 5 || bytes.charCodeAt(start) !== 0x2f) return false;
        image = true;
      }
      offset = end + (size & 1);
    }
    return image && offset === bytes.length;
  } catch { return false; }
}

export function isValidBeanPhoto(value: string): boolean { return isValidJPEGPhoto(value) || isValidWebPPhoto(value); }

export async function compressBeanPhoto(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  const image = new Image();
  try {
    image.src = url;
    await image.decode();
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    let width = Math.max(1, Math.round(image.naturalWidth * scale));
    let height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Photo processing is unavailable.');
    const { encodeWebP } = await import('./webpEncoder');
    let result: Uint8Array;
    while (true) {
      canvas.width = width;
      canvas.height = height;
      context.fillStyle = '#fff';
      context.fillRect(0, 0, width, height);
      // Always redraw from the source to avoid repeated resampling losses.
      context.drawImage(image, 0, 0, width, height);
      const pixels = context.getImageData(0, 0, width, height);
      const encode = (quality: number) => encodeWebP(pixels, quality);
      const highQuality = await encode(80);
      if (highQuality.byteLength <= MAX_BEAN_PHOTO_BYTES) {
        result = highQuality;
        break;
      }
      let fitting = await encode(50);
      const bytes = fitting.byteLength;
      if (bytes <= MAX_BEAN_PHOTO_BYTES) {
        // Keep the best measured fit; size estimates never decide acceptance.
        let low = 50;
        let high = 80;
        for (let attempt = 0; attempt < 5; attempt++) {
          const quality = (low + high) / 2;
          const webp = await encode(quality);
          if (webp.byteLength <= MAX_BEAN_PHOTO_BYTES) {
            fitting = webp;
            low = quality;
          } else high = quality;
        }
        result = fitting;
        break;
      }
      if (width === 1 && height === 1) throw new Error('Could not compress this photo to 100 kB. Choose another image.');
      // Size roughly follows pixel count; estimates never decide acceptance.
      const shrink = Math.min(0.8, Math.sqrt(MAX_BEAN_PHOTO_BYTES / bytes) * 0.9);
      width = Math.max(1, Math.floor(width * shrink));
      height = Math.max(1, Math.floor(height * shrink));
    }
    let binary = '';
    for (const byte of result) binary += String.fromCharCode(byte);
    const photo = 'data:image/webp;base64,' + btoa(binary);
    if (!isValidWebPPhoto(photo)) throw new Error('Photo processing is unavailable.');
    return photo;
  } catch (error) {
    if (error instanceof DOMException) throw new Error('This photo could not be read. Try a JPEG or PNG image.');
    throw error;
  } finally {
    URL.revokeObjectURL(url);
  }
}
