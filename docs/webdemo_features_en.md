# Web Demo Features

The Web Demo is a self-hostable browser UI for MiniCPM-OCR: upload a document image or PDF, get structured parsing results, and export them. It ships with Chinese/English switching and a REST backend you can point at any MiniCPM-OCR serving stack (vLLM, SGLang, llama.cpp, Ollama, or the free hosted API).

- Deployment guide: [English](./webdemo_deploy.md) / [Chinese](./webdemo_deploy_zh.md)
- Fork changes are marked with 🛠️ (see [Fork Notes](../README.md#fork-notes-mibaoforge))

## Core Features (upstream)

### Document & image parsing

- **Image parse**: upload a document photo/scan and get Markdown with text, tables, formulas, seals, and chart regions recognized.
- **PDF document parse**: upload a whole PDF; pages are parsed concurrently as a background job (`/api/document-parse/jobs`) with per-page progress polling, so long documents stream in page by page.
- **Key Information Extraction (KIE)**: extract targeted fields (e.g. names, dates, amounts) from a document via structured prompts (`/api/kie`).
- **Editable draft**: the Markdown result can be edited in place before export.

### Export formats

| Format | File | What you get |
|---|---|---|
| Markdown | `.md` | Structured text with tables/formulas; image regions linked to crops |
| JSON | `.json` | Same schema as the online document parsing API |
| Word | `.docx` | Editable document |
| 🛠️ HTML | `.html` | Layout-preserved page reconstruction |

### Serving & integration

- FastAPI backend exposing `/api/image-parse`, `/api/page-parse`, `/api/kie`, document parse jobs, plus an OpenAI-compatible `/v1/chat/completions` endpoint for direct model access.
- `/health`, `/ready`, `/metrics` probes for deployment monitoring.
- Frontend/backend separation: the Vite frontend talks to the backend over HTTP(S), so the UI and the GPU engine can run on different machines.

### UI experience

- Chinese/English locale switching across the whole interface.
- Guided tour for first-time users.
- Model credential panel: switch between the free hosted API and your own endpoint/key.

## Fork Additions (mibaoforge) 🛠️

Built for plain self-hosted deployments (e.g. llama.cpp on a workstation LAN).

### 🛠️ Word export embeds cropped images

Upstream intentionally exports image regions as alt text only. This fork embeds the actual crops — cut from the page image in the browser — into the `.docx` as real pictures (PNG/JPEG, auto-resized to page width). If the draft was manually edited, exports fall back to alt text so images never misalign with text.

### 🛠️ Layout-preserved HTML export

A new download format that reconstructs each page as an SVG stage: the page raster as background with recognized text lines overlaid at their original positions and sizes. Reading order and visual layout stay faithful — useful for reviewing OCR output against the original without flipping back and forth.

### 🛠️ Whole-document exports

Word, HTML, and Markdown exports cover **every completed page of a PDF in one file** (upstream exports the current page only). Markdown export embeds page images as data URIs, so the single `.md` file is fully self-contained.

### 🛠️ KIE fix on plain-HTTP origins

Browsers only expose `crypto.randomUUID` on secure contexts (https/localhost). Self-hosting the demo over plain http on a LAN IP previously broke KIE; a fallback generator fixes it with no TLS setup required.

## Verification (2026-11-04)

- `tsc --noEmit` and `pnpm build` pass on the rebased tree.
- Headless module tests (esbuild bundle; the repo ships no test runner):
  - Word + crops: `word/media/*.png` present and `<w:drawing>` in `document.xml`.
  - Word with empty crops: no media entries, alt text preserved (upstream behavior regression).
  - Multi-page Word: one file containing all pages with embedded media.
- Multi-page HTML export renders page rasters via the browser DOM; the Node-side fallback path was verified separately.
