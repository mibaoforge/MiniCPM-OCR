# Web Demo 功能總覽

Web Demo 是可自架的 MiniCPM-OCR 瀏覽器介面：上傳文件圖片或 PDF，取得結構化解析結果並匯出。內建中英文切換，後端可接任何 MiniCPM-OCR 服務堆疊（vLLM、SGLang、llama.cpp、Ollama 或官方免費 API）。

- 部署指南：[中文](./webdemo_deploy_zh.md) / [English](./webdemo_deploy.md)
- 標有 🛠️ 者為本分支新增（見 [分支說明](../README_zh.md#分支說明mibaoforge)）

## 核心功能（上游）

### 文件與圖片解析

- **圖片解析**：上傳文件照片/掃描件，輸出含文字、表格、公式、印章與圖表區域的 Markdown。
- **PDF 文件解析**：上傳整份 PDF，各頁以背景任務並行解析（`/api/document-parse/jobs`），輪詢各頁進度，長文件逐頁出現結果。
- **關鍵資訊擷取（KIE）**：以結構化提示從文件中擷取指定欄位（如姓名、日期、金額，`/api/kie`）。
- **可編輯草稿**：Markdown 結果可在匯出前直接修改。

### 匯出格式

| 格式 | 檔案 | 內容 |
|---|---|---|
| Markdown | `.md` | 含表格/公式的結構化文字，圖片區域連結至裁圖 |
| JSON | `.json` | 與線上文件解析 API 相同的輸出格式 |
| Word | `.docx` | 可編輯文件 |
| 🛠️ HTML | `.html` | 版面還原的頁面重建 |

### 服務與整合

- FastAPI 後端提供 `/api/image-parse`、`/api/page-parse`、`/api/kie`、文件解析任務，另有 OpenAI 相容的 `/v1/chat/completions` 可直接存取模型。
- `/health`、`/ready`、`/metrics` 探測端點供部署監控。
- 前後端分離：Vite 前端經 HTTP(S) 呼叫後端，UI 與 GPU 引擎可分居不同機器。

### 介面體驗

- 全介面中英文語系切換。
- 首次使用導覽教學。
- 模型憑證面板：可在官方免費 API 與自有端點/金鑰間切換。

## 本分支新增功能（mibaoforge）🛠️

為純自架場景（如工作站 LAN 上的 llama.cpp）打造。

### 🛠️ Word 匯出嵌入裁切圖片

上游刻意只輸出圖片 alt 文字。本分支將瀏覽器端從頁面圖裁出的實際圖片，以真圖片（PNG/JPEG，自動等比縮至頁寬）嵌入 .docx。草稿若經手動編輯，匯出自動退回 alt 文字，確保圖文永不錯位。

### 🛠️ 版面還原 HTML 匯出

新增匯出格式：將每頁重建為 SVG 舞台——頁面光柵圖作底，辨識出的文字依原始位置與字級疊加其上。閱讀順序與視覺版面忠於原稿，比對 OCR 結果與原文時不必來回翻頁。

### 🛠️ 整份文件單檔匯出

Word、HTML、Markdown 匯出改為**單檔涵蓋 PDF 全部已完成頁面**（上游僅匯出目前頁）。Markdown 匯出以 data URI 嵌入頁面圖片，單一 `.md` 檔即完全自足。

### 🛠️ 純 HTTP 來源的 KIE 修復

瀏覽器只在安全內容（https/localhost）提供 `crypto.randomUUID`。過去以 LAN IP 走純 http 自架時 KIE 會失效；本分支加入備援產生器，無需設定 TLS 即可修復。

## 驗證結果（2026-11-04）

- 於 rebase 後的程式樹執行 `tsc --noEmit` 與 `pnpm build`，皆通過。
- 無測試框架下的 headless 模組直測（esbuild bundle）：
  - Word 含裁圖：`word/media/*.png` 存在且 `document.xml` 含 `<w:drawing>`。
  - Word 無裁圖：無 media 條目、保留 alt 文字（上游行為回歸）。
  - 多頁 Word：單檔涵蓋全部頁面並嵌入圖片。
- 多頁 HTML 匯出的頁面光柵需瀏覽器 DOM 渲染，Node 端退回路徑已另行驗證。
