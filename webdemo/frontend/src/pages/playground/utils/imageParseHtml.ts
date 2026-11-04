/**
 * Self-contained HTML export that preserves the original page layout: the page
 * raster as a background image and every recognized text block overlaid at its
 * original bbox through an SVG layer (normalized block coordinates scaled to
 * the raster pixel space). The text layer toggles with a pure-CSS checkbox, so
 * the saved file works offline with no scripts.
 */
import type { ImageParseLayoutBlock, ImageParseRotationInfo } from './imageParseSample';
import { readImageSize } from './imageParseWordImages';

export interface ImageParseHtmlInput {
  blocks: readonly ImageParseLayoutBlock[];
  rotation?: ImageParseRotationInfo;
  /** Page raster data URL (single-image mode). */
  pageImage?: string;
  /** PDF source URL + 1-based page; the raster is rendered locally when pageImage is absent. */
  pdfSource?: string;
  pageIndex?: number;
  name?: string;
  page?: number;
}

const IMAGE_KINDS = new Set(['image', 'chart', 'seal']);

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function rotationAngle(rotation?: ImageParseRotationInfo): number {
  return rotation?.enabled && rotation.applied && Number.isFinite(rotation.totalAngle)
    ? rotation.totalAngle
    : 0;
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    if (typeof image.decode === 'function') {
      image.src = url;
      image.decode().then(() => resolve(image)).catch(() => resolve(null));
    } else {
      image.src = url;
    }
  });
}

/** Rotate the raster into the coordinate space the layout blocks refer to (matches the crop pipeline). */
async function rotateDataUrl(dataUrl: string, angle: number): Promise<string> {
  if (!angle) return dataUrl;
  const image = await loadImage(dataUrl);
  if (!image || !image.naturalWidth) return dataUrl;
  const radians = (angle * Math.PI) / 180;
  const width =
    image.naturalWidth * Math.abs(Math.cos(radians)) +
    image.naturalHeight * Math.abs(Math.sin(radians));
  const height =
    image.naturalWidth * Math.abs(Math.sin(radians)) +
    image.naturalHeight * Math.abs(Math.cos(radians));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const context = canvas.getContext('2d');
  if (!context) return dataUrl;
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate(-radians);
  context.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);
  const url = canvas.toDataURL('image/png');
  canvas.width = 0;
  canvas.height = 0;
  return url;
}

function dataUrlBytes(url: string): Uint8Array {
  const match = /^data:image\/[^;,]+;base64,(.+)/.exec(url);
  if (!match) return new Uint8Array();
  const binary = atob(match[1]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Approximate line advance in em units: CJK glyphs full-width, latin narrower. */
function lineWidthUnits(line: string): number {
  let units = 0;
  for (const char of line) units += /[\u3000-\u9fff\uff00-\uffef\uf900-\ufaff]/.test(char) ? 1 : 0.55;
  return Math.max(0.55, units);
}

interface TextBlockSpec {
  x: number;
  y: number;
  w: number;
  h: number;
  lines: string[];
  fontSize: number;
}

function charUnits(char: string): number {
  const code = char.codePointAt(0) ?? 0;
  if (code >= 0x3000 && code <= 0x9fff) return 1;
  if (code >= 0xff00 && code <= 0xffef) return 1;
  if (code >= 0xf900 && code <= 0xfaff) return 1;
  return 0.55;
}

/** Greedy wrap of one line to the pixel width at the given font size (CJK-aware units). */
function wrapLine(line: string, w: number, fontSize: number): string[] {
  if (lineWidthUnits(line) * fontSize <= w) return [line];
  const out: string[] = [];
  let current = '';
  let units = 0;
  for (const char of line) {
    const next = charUnits(char);
    if (units + next > w / fontSize && current) {
      out.push(current);
      current = char;
      units = next;
    } else {
      current += char;
      units += next;
    }
  }
  if (current) out.push(current);
  return out;
}

function wrapLines(lines: readonly string[], w: number, fontSize: number): string[] {
  return lines.flatMap((line) => wrapLine(line, w, fontSize));
}

/**
 * Largest font size whose wrapped text fits the block box. Newspaper columns
 * arrive as one long line per paragraph, so a width-only fit would collapse to
 * an unreadable font; wrapping keeps the whole block visible at the original spot.
 */
function fitBlockFont(
  lines: readonly string[],
  w: number,
  h: number,
): { lines: string[]; fontSize: number } | null {
  let lo = 0;
  let hi = Math.max(4, Math.min(h, w / 2));
  if (wrapLines(lines, w, hi).length * hi > h) {
    for (let i = 0; i < 20; i += 1) {
      const mid = (lo + hi) / 2;
      if (wrapLines(lines, w, mid).length * mid <= h) lo = mid;
      else hi = mid;
    }
  } else {
    lo = hi;
  }
  const fontSize = lo * 0.94;
  if (fontSize < 4) return null;
  return { lines: wrapLines(lines, w, fontSize), fontSize };
}

function blockSpec(
  block: ImageParseLayoutBlock,
  width: number,
  height: number,
): TextBlockSpec | null {
  if (IMAGE_KINDS.has(block.kind)) return null;
  const source = block.text
    .split('\n')
    .map((line) => line.replace(/\t/g, '  ').trimEnd())
    .filter((line) => line.trim().length > 0);
  if (!source.length) return null;
  const x = block.x * width;
  const y = block.y * height;
  const w = Math.max(4, block.w * width);
  const h = Math.max(4, block.h * height);
  const fit = fitBlockFont(source, w, h);
  if (!fit) return null;
  return { x, y, w, h, lines: fit.lines, fontSize: Math.min(fit.fontSize, h * 0.9) };
}

export async function createImageParseHtmlDocument(input: ImageParseHtmlInput): Promise<string> {
  let pageImage = input.pageImage;
  if (!pageImage && input.pdfSource && typeof document !== 'undefined') {
    try {
      const { loadPdfPreview } = await import('./pdfPreview');
      const { renderPdfPageImage } = await import('./pdfPageImage');
      const task = loadPdfPreview(input.pdfSource);
      try {
        const pdf = await task.promise;
        pageImage = await renderPdfPageImage(pdf, input.pageIndex ?? 1, new AbortController().signal);
      } finally {
        void task.destroy().catch(() => undefined);
      }
    } catch {
      pageImage = undefined;
    }
  }
  const angle = rotationAngle(input.rotation);
  const isDataUrl = Boolean(pageImage && /^data:image\/[^;,]+;base64,/.test(pageImage));
  const rotated = isDataUrl ? await rotateDataUrl(pageImage as string, angle) : pageImage;
  let size = rotated && isDataUrl ? readImageSize(dataUrlBytes(rotated)) : null;
  if (rotated && !size) {
    const probe = await loadImage(rotated);
    if (probe?.naturalWidth) size = { width: probe.naturalWidth, height: probe.naturalHeight };
  }

  const titleParts = [input.name, input.page ? `第 ${input.page} 頁` : ''].filter(Boolean);
  const title = escapeHtml(titleParts.join(' · ') || 'MiniCPM-OCR 版面還原');

  if (rotated && size) {
    const specs = input.blocks
      .map((block) => blockSpec(block, size.width, size.height))
      .filter((spec): spec is TextBlockSpec => spec !== null && spec.fontSize >= 4);
    const overlay = specs
      .map((spec) => {
        const lineHeight = (spec.h - spec.fontSize) / Math.max(1, spec.lines.length - 1);
        const rows = spec.lines
          .map((line, index) => {
            const x = spec.x + 1;
            const y = spec.y + spec.fontSize * 0.95 + index * lineHeight;
            const trimmed = line.trim();
            const wpx = Math.min(spec.w, lineWidthUnits(trimmed) * spec.fontSize + 3);
            const rect = `  <rect class="bg" x="${(x - 1.5).toFixed(1)}" y="${(
              y - spec.fontSize
            ).toFixed(1)}" width="${wpx.toFixed(1)}" height="${(spec.fontSize * 1.18).toFixed(1)}"/>`;
            const text = `  <text x="${x.toFixed(1)}" y="${y.toFixed(
              1
            )}" font-size="${spec.fontSize.toFixed(1)}">${escapeHtml(trimmed)}</text>`;
            return `${rect}\n${text}`;
          })
          .join('\n');
        return `<g>\n${rows}\n</g>`;
      })
      .join('\n');
    const stage = `<svg viewBox="0 0 ${size.width} ${size.height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${title}">
<image href="${rotated}" x="0" y="0" width="${size.width}" height="${size.height}"/>
<g class="textLayer">
${overlay}
</g>
</svg>`;
    return wrapHtml(title, stage, true);
  }
  const fallback = input.blocks
    .filter((block) => !IMAGE_KINDS.has(block.kind) && block.text.trim())
    .map((block) => `<p>${escapeHtml(block.text.trim())}</p>`)
    .join('\n');
  return wrapHtml(title, fallback || '<p class="empty">（無辨識結果）</p>', false);
}

function wrapHtml(title: string, body: string, hasLayout: boolean): string {
  const toggle = hasLayout
    ? '<input type="checkbox" id="showText"><label class="bar" for="showText">顯示辨識文字（白底覆蓋原文；未勾選時文字層隱形但仍可框選複製）</label>'
    : '';
  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  body { margin: 0; padding: 24px 16px; background: #eef2f7; font-family: "Noto Sans TC", "Microsoft JhengHei", system-ui, sans-serif; color: #0f172a; }
  main { max-width: 1100px; margin: 0 auto; background: #fff; border-radius: 10px; box-shadow: 0 2px 10px rgba(15, 23, 42, 0.08); padding: 18px; }
  h1 { font-size: 15px; margin: 0 0 12px; color: #334155; }
  .bar { display: block; margin: 0 0 12px; font-size: 13px; color: #475569; cursor: pointer; }\n  #showText { margin: 0 6px 0 0; vertical-align: -2px; }
  svg { width: 100%; height: auto; display: block; }
  .textLayer text { fill: transparent; pointer-events: all; }
  .textLayer rect.bg { fill: #ffffff; opacity: 0; }
  #showText:checked ~ .stage .textLayer text { fill: #0f172a; }
  #showText:checked ~ .stage .textLayer rect.bg { opacity: 0.92; }
  .stage { position: relative; }
  p { white-space: pre-wrap; line-height: 1.7; font-size: 14px; }
  .empty { color: #94a3b8; }
</style>
</head>
<body>
<main>
<h1>${title}</h1>
${toggle}
<div class="stage">
${body}
</div>
</main>
</body>
</html>
`;
}
