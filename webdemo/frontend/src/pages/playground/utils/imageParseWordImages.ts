/**
 * Fetch crop data URLs / blob URLs produced by the parse pipeline and read
 * intrinsic pixel sizes, so image runs can be embedded into the Word export.
 * A failed crop falls back to text runs (the previous '[image]' behaviour).
 */
export interface WordImageData {
  bytes: Uint8Array;
  width: number;
  height: number;
}

/** Max display width in pixels (~6.27in at 96dpi, fits A4 with 1in margins). */
export const WORD_IMAGE_MAX_WIDTH_PX = 600;

export function readImageSize(bytes: Uint8Array): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length > 24 && view.getUint32(0) === 0x89504e47) {
    // PNG: IHDR width/height are big-endian at byte 16/20.
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    // JPEG: walk segments to an SOF marker.
    let off = 2;
    while (off + 9 < bytes.length) {
      if (bytes[off] !== 0xff) { off += 1; continue; }
      const marker = bytes[off + 1];
      const len = view.getUint16(off + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: view.getUint16(off + 5), width: view.getUint16(off + 7) };
      }
      off += 2 + len;
    }
  }
  return null;
}

function dataUrlToBytes(url: string): Uint8Array | null {
  const match = /^data:image\/(png|jpe?g|gif|webp);base64,(.+)$/i.exec(url);
  if (!match) return null;
  try {
    const binary = atob(match[2]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

export async function loadWordImages(urls: readonly string[]): Promise<Array<WordImageData | null>> {
  return Promise.all(
    urls.map(async (url): Promise<WordImageData | null> => {
      try {
        let bytes: Uint8Array | null = null;
        if (url.startsWith('data:')) bytes = dataUrlToBytes(url);
        else if (url.startsWith('blob:') || url.startsWith('/') || /^https?:/i.test(url)) {
          const res = await fetch(url);
          if (!res.ok) return null;
          bytes = new Uint8Array(await res.arrayBuffer());
        }
        if (!bytes || bytes.length === 0) return null;
        const size = readImageSize(bytes);
        if (!size || size.width <= 0 || size.height <= 0) return null;
        return { bytes, ...size };
      } catch {
        return null;
      }
    }),
  );
}

export function wordImageTransform(width: number, height: number): { width: number; height: number } {
  const scale = width > WORD_IMAGE_MAX_WIDTH_PX ? WORD_IMAGE_MAX_WIDTH_PX / width : 1;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
