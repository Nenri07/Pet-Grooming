/**
 * Record a DOM node's live animation into an animated GIF, in the browser.
 *
 * Grabs frames with html-to-image while the CSS/Framer Motion animation keeps
 * running, then encodes them with gifenc. Each frame's delay is the real time
 * that passed between captures, so the GIF plays at the true speed even when
 * a slow phone captures fewer frames per second.
 */

export interface RecordGifOptions {
  /** How long to record, ms. */
  durationMs?: number;
  /** Target frames to capture (fewer if the device is slow). */
  maxFrames?: number;
  /** Output scale vs CSS pixels (1 = same size as on screen). */
  pixelRatio?: number;
}

export async function recordNodeAsGif(
  node: HTMLElement,
  { durationMs = 3000, maxFrames = 24, pixelRatio = 1.25 }: RecordGifOptions = {}
): Promise<Blob> {
  const [{ toCanvas, getFontEmbedCSS }, { GIFEncoder, quantize, applyPalette }] = await Promise.all([
    import('html-to-image'),
    import('gifenc'),
  ]);

  // Resolve fonts once instead of on every frame.
  const fontEmbedCSS = await getFontEmbedCSS(node).catch(() => undefined);
  const rect = node.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  // html-to-image copies the node's computed styles onto the clone, including
  // centring margins and the 3D tilt, which shifted and clipped the card.
  // Flatten those on the captured root and leave the outside transparent.
  const capture = () =>
    toCanvas(node, {
      width,
      height,
      pixelRatio,
      fontEmbedCSS,
      style: { margin: '0', transform: 'none', boxShadow: 'none' },
    });

  const frames: { data: Uint8ClampedArray; at: number; w: number; h: number }[] = [];
  const start = performance.now();
  const gap = durationMs / maxFrames;
  while (frames.length < maxFrames && performance.now() - start < durationMs + gap) {
    const t = performance.now();
    const canvas = await capture();
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) break;
    frames.push({ data: ctx.getImageData(0, 0, canvas.width, canvas.height).data, at: t, w: canvas.width, h: canvas.height });
    const wait = gap - (performance.now() - t);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
  if (frames.length === 0) throw new Error('No frames captured');

  const gif = GIFEncoder();
  // One shared palette (from the first frame) keeps colours stable and the file
  // small. 1-bit alpha keeps the area outside the rounded corners transparent.
  const format = 'rgba4444';
  const palette = quantize(frames[0].data, 256, { format, oneBitAlpha: true });
  const transparentIndex = palette.findIndex((c) => c[3] === 0);
  frames.forEach((f, i) => {
    const next = frames[i + 1];
    const delay = Math.max(20, Math.round((next ? next.at : f.at + gap) - f.at));
    gif.writeFrame(applyPalette(f.data, palette, format), f.w, f.h, {
      palette,
      delay,
      repeat: 0,
      ...(transparentIndex >= 0 ? { transparent: true, transparentIndex } : {}),
    });
  });
  gif.finish();
  const bytes = gif.bytes();
  return new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'image/gif' });
}
