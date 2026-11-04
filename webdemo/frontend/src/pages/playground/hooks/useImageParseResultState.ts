import { useMemo } from 'react';

import type { useImageParse } from './useImageParse';
import { useImageParseDraft } from './useImageParseDraft';
import { useImageParseDownload } from './useImageParseDownload';
import { imageParseBlockRanges } from '../utils/imageParseBlocks';
import { imageParseQuality } from '../utils/imageParseQuality';
import {
  imageParseSealDisplayCrops,
  imageParseSealDisplayResult,
} from '../utils/imageParseSealDisplay';

/**
 * Connect the result draft, original-image positioning ranges, and download data, so export uses the current edited content.
 * @param parse current recognition result
 * @param examplePageKey per-page identity of a shared example
 * @returns the draft, positioning ranges, quality summary, and download actions
 */
export function useImageParseResultState(
  parse: ReturnType<typeof useImageParse>,
  examplePageKey?: string,
) {
  const baseRanges = useMemo(
    () => imageParseBlockRanges(parse.markdown, parse.layout),
    [parse.markdown, parse.layout],
  );
  const draft = useImageParseDraft(parse.markdown, examplePageKey ?? parse.resultKey, baseRanges);
  const ranges = draft.ranges;
  const linkedRanges = useMemo(() => [...ranges].map(([id, range]) => ({ id, range })), [ranges]);
  const preview = useMemo(
    () =>
      imageParseSealDisplayResult(
        { markdown: draft.value, blocks: parse.layout },
        parse.recognizeSeal,
        parse.recognizeChart,
        ranges,
      ),
    [draft.value, parse.layout, parse.recognizeChart, parse.recognizeSeal, ranges],
  );
  const previewRanges = useMemo(
    () => imageParseBlockRanges(preview.markdown, preview.blocks),
    [preview.markdown, preview.blocks],
  );
  const previewLinkedRanges = useMemo(
    () => [...previewRanges].map(([id, range]) => ({ id, range })),
    [previewRanges],
  );
  const previewCrops = useMemo(
    () =>
      imageParseSealDisplayCrops(
        parse.layout,
        parse.crops ?? [],
        parse.recognizeSeal,
        parse.recognizeChart,
      ),
    [parse.crops, parse.layout, parse.recognizeChart, parse.recognizeSeal],
  );
  const quality = useMemo(() => imageParseQuality(parse.layout), [parse.layout]);
  // Completed PDF pages for one-file Word/HTML exports; the edited current page uses the draft text.
  const pdfPages = useMemo(() => {
    const pdf = parse.pdf;
    if (!pdf) return undefined;
    const out: Array<{
      page: number;
      markdown: string;
      blocks: typeof parse.layout;
      rotation: typeof parse.rotation;
      crops?: readonly string[];
    }> = [];
    for (let page = 1; page <= pdf.pages; page += 1) {
      const entry = pdf.results[page];
      if (!entry?.result) continue;
      const current = page === pdf.page;
      out.push({
        page,
        markdown: current ? draft.value : entry.result.markdown,
        blocks: current ? preview.blocks : entry.result.blocks,
        rotation: entry.result.rotation,
        crops: current && !draft.dirty ? previewCrops : entry.crops,
      });
    }
    return out.length ? out : undefined;
  }, [draft.dirty, draft.value, parse.pdf, preview.blocks, previewCrops]);
  const download = useImageParseDownload({
    markdown: draft.value,
    blocks: parse.layout,
    rotation: parse.rotation,
    ranges,
    crops: draft.dirty ? [] : previewCrops,
    pageImage: parse.pdf ? undefined : parse.attachment?.dataUrl,
    pdfSource: parse.pdf ? parse.attachment?.dataUrl : undefined,
    pageIndex: parse.pdf ? parse.pdf.page : undefined,
    pdfPages,
    edited: draft.manuallyEdited ?? draft.dirty,
    name: parse.attachment?.name,
    page: parse.pdf?.page,
    disabled: parse.loading,
  });
  return {
    draft,
    ranges,
    linkedRanges,
    preview,
    previewRanges,
    previewLinkedRanges,
    previewCrops,
    quality,
    download,
  };
}
