/** The pixel size of a PNG data URL (read from its header), or null if it isn't one. */
export function pngSize(dataUrl: string): { width: number; height: number } | null {
  const m = /^data:image\/png;base64,(.{44})/.exec(dataUrl);
  if (!m) return null;
  const bytes = atob(m[1]);
  if (bytes.slice(1, 4) !== "PNG") return null;
  const at = (i: number) => (bytes.charCodeAt(i) << 24) | (bytes.charCodeAt(i + 1) << 16) | (bytes.charCodeAt(i + 2) << 8) | bytes.charCodeAt(i + 3);
  const width = at(16);
  const height = at(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

/** The largest size within `maxW` x `maxH` that keeps the picture's shape. */
export function fitInside(size: { width: number; height: number }, maxW: number, maxH: number) {
  const scale = Math.min(maxW / size.width, maxH / size.height);
  return { width: size.width * scale, height: size.height * scale };
}
