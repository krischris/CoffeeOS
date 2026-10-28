/** JPEG data URLs keep photos portable in both CSV and Parquet backups. */
export function isBeanPhoto(value: string): boolean {
  return value.length <= 2_000_000 && /^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]*={0,2}$/.test(value);
}

/** New photos use canonical base64 and both JPEG boundary markers. */
export function isValidBeanPhoto(value: string): boolean {
  if (!isBeanPhoto(value)) return false;
  const encoded = value.slice('data:image/jpeg;base64,'.length);
  try {
    const bytes = atob(encoded);
    return btoa(bytes) === encoded && bytes.startsWith('\xff\xd8\xff') && bytes.endsWith('\xff\xd9');
  } catch { return false; }
}

export async function compressBeanPhoto(file: File): Promise<string> {
  if (file.size > 30 * 1024 * 1024) throw new Error('Choose a photo smaller than 30 MB.');
  const url = URL.createObjectURL(file);
  const image = new Image();
  try {
    image.src = url;
    await image.decode();
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Photo processing is unavailable.');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.8, 0.65, 0.5]) {
      const jpeg = canvas.toDataURL('image/jpeg', quality);
      if (isValidBeanPhoto(jpeg)) return jpeg;
    }
    throw new Error('This photo is too large. Choose a smaller image.');
  } catch (error) {
    if (error instanceof DOMException) throw new Error('This photo could not be read. Try a JPEG or PNG image.');
    throw error;
  } finally {
    URL.revokeObjectURL(url);
  }
}
