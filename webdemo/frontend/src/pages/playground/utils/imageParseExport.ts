import type { ImageParseTextRange } from './imageParseBlocks';
import { imageParseBlockId } from './imageParseBlocks';
import type { ImageParseLayoutBlock } from './imageParseSample';
import type { ImageParseRotationInfo } from './imageParseSample';

/** Download formats supported for the current OCR result. */
export type ImageParseDownloadFormat = 'markdown' | 'json' | 'word' | 'html';

/** A download snapshot does not accept a source token, API Key, or the raw request, so credentials do not enter the exported file. */
export interface ImageParseExportInput {
  /** Crop data/blob URLs aligned with the markdown image order (Word embed only). */
  crops?: readonly string[];
  /** Page raster data URL for the layout HTML export (single-image mode). */
  pageImage?: string;
  /** PDF source URL and 1-based page for the layout HTML export (document mode). */
  pdfSource?: string;
  pageIndex?: number;
  /** All completed PDF pages (document mode); Word/HTML exports cover them in one file when present. */
  pdfPages?: Array<{
    page: number;
    markdown: string;
    blocks: ImageParseExportInput['blocks'];
    rotation?: ImageParseExportInput['rotation'];
    crops?: readonly string[];
  }>;
  markdown: string;
  blocks: readonly ImageParseLayoutBlock[];
  rotation?: ImageParseRotationInfo;
  ranges?: ReadonlyMap<string, ImageParseTextRange>;
  edited?: boolean;
}

const EXTENSIONS: Record<ImageParseDownloadFormat, string> = {
  markdown: 'md',
  json: 'json',
  word: 'docx',
  html: 'html',
};

/**
 * Name the current result from the original document; a PDF is explicitly marked with the current page so it is not mistaken for an export of every page.
 * @param name original file name
 * @param format download format
 * @param page optional PDF page number, starting at 1
 * @returns download file name with the correct extension
 */
export function imageParseExportFileName(
  name: string | undefined,
  format: ImageParseDownloadFormat,
  page?: number,
): string {
  const base = name?.replace(/\.[^.]+$/, '').trim() || 'image-parse';
  return `${base}${page ? `-page-${page}` : ''}.${EXTENSIONS[format]}`;
}

/** Replace body `![image]()` placeholders with crops in order (data URLs render anywhere). */
function embedImages(markdown: string, crops: readonly string[]): string {
  let index = 0;
  return markdown.replace(/!\[image\]\(\)/g, () => {
    const crop = crops[index++];
    return crop ? `![image](${crop})` : '![image]()';
  });
}

/** Per-page markdown with crops; untouched pages rebuild crops from the local PDF at export time. */
async function resolveExportPageCrops(input: ImageParseExportInput): Promise<Array<{ page: number; markdown: string; crops: readonly string[] }>> {
  const pages = input.pdfPages ?? [];
  const out: Array<{ page: number; markdown: string; crops: readonly string[] }> = [];
  for (const page of pages) {
    let crops = page.crops ?? [];
    if (!crops.length && input.pdfSource && /!\[image\]\(\)/.test(page.markdown)) {
      try {
        const { rebuildPdfPageCrops } = await import('./pdfImageParseCrops');
        crops = await rebuildPdfPageCrops(
          input.pdfSource,
          page.page,
          { markdown: page.markdown, blocks: page.blocks, ...(page.rotation ? { rotation: page.rotation } : {}) },
          new AbortController().signal,
        );
      } catch {
        crops = [];
      }
    }
    out.push({ page: page.page, markdown: page.markdown, crops });
  }
  return out;
}

/**
 * Create download content; Word is loaded on demand, and JSON rebuilds only the layout fields that are allowed to be exported.
 * @param format format the user selected
 * @param input current editable body and recognition-block snapshot
 * @returns a file Blob, without modifying the draft or the service return value
 */
export async function createImageParseExport(
  format: ImageParseDownloadFormat,
  input: ImageParseExportInput,
): Promise<Blob> {
  if (format === 'html') {
    if (input.pdfPages && input.pdfPages.length > 1 && input.pdfSource) {
      const { createImageParseMultiPageHtmlDocument } = await import('./imageParseHtml');
      const html = await createImageParseMultiPageHtmlDocument(
        input.pdfSource,
        input.pdfPages.map((page) => ({
          page: page.page,
          blocks: page.blocks,
          rotation: page.rotation,
        })),
        (input as { name?: string }).name,
      );
      return new Blob([html], { type: 'text/html;charset=utf-8' });
    }
    const { createImageParseHtmlDocument } = await import('./imageParseHtml');
    const html = await createImageParseHtmlDocument({
      blocks: input.blocks,
      rotation: input.rotation,
      pageImage: input.pageImage,
      pdfSource: input.pdfSource,
      pageIndex: input.pageIndex,
      name: (input as { name?: string }).name,
      page: (input as { page?: number }).page,
    });
    return new Blob([html], { type: 'text/html;charset=utf-8' });
  }
  if (format === 'word') {
    const { createImageParseWordBlob, createImageParseWordBlobPages } = await import('./imageParseWord');
    if (input.pdfPages && input.pdfPages.length > 1) {
      const pages = [];
      for (const page of await resolveExportPageCrops(input)) {
        pages.push({ markdown: page.markdown, crops: page.crops });
      }
      return createImageParseWordBlobPages(pages);
    }
    return createImageParseWordBlob(input.markdown, input.crops ?? []);
  }
  if (format === 'markdown') {
    if (input.pdfPages && input.pdfPages.length > 1) {
      const pages = await resolveExportPageCrops(input);
      const joined = pages
        .map((page) => (pages.length > 1 && page.page > 1 ? `\n\n---\n\n<!-- 第 ${page.page} 頁 -->\n\n` : '') + embedImages(page.markdown, page.crops))
        .join('')
        .replace(/^\n+/, '');
      return new Blob([joined], { type: 'text/markdown;charset=utf-8' });
    }
    return new Blob([embedImages(input.markdown, input.crops ?? [])], { type: 'text/markdown;charset=utf-8' });
  }

  const blocks = input.blocks.map((block, index) => {
    const range = input.ranges?.get(imageParseBlockId(block, index));
    return {
      id: block.id,
      order: block.order,
      label: block.label,
      status: block.status,
      kind: block.kind,
      x: block.x,
      y: block.y,
      w: block.w,
      h: block.h,
      regions: block.regions,
      ttsInvalid: block.ttsInvalid,
      // text and confidence are the original recognition evidence; only positionable Markdown is updated with a manual edit.
      text: block.text,
      markdown: range ? input.markdown.slice(range.start, range.end) : block.markdown,
      confidence: block.confidence,
      markdownStart: range?.start,
      markdownEnd: range?.end,
    };
  });
  const json = JSON.stringify(
    {
      markdown: input.markdown,
      blocks,
      rotation: input.rotation,
      edited: Boolean(input.edited),
    },
    null,
    2,
  );
  return new Blob([json], { type: 'application/json;charset=utf-8' });
}

/**
 * Start a local download and release the object URL after a delay, leaving the browser time to consume the file.
 * @param blob file content
 * @param fileName download file name
 */
export function saveImageParseExport(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
