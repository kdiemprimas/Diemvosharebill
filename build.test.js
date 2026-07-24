import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildStaticSite } from "./build.mjs";

test("đóng gói đầy đủ webapp và tài nguyên OCR cho GitHub Pages", async (context) => {
  const outputDir = await mkdtemp(join(tmpdir(), "chia-bill-pages-"));
  context.after(() => rm(outputDir, { recursive: true, force: true }));

  await buildStaticSite(outputDir);

  const expectedFiles = [
    "index.html",
    "history.html",
    "styles.css",
    "app.js",
    "history.js",
    "bill-calculator.js",
    "bill-ocr.js",
    "bill-history.js",
    "assets/teolaegi-pet-logo.png",
    "assets/teolaegi-spritesheet.webp",
    "assets/melo-spritesheet.webp",
    ".nojekyll",
    "node_modules/tesseract.js/dist/tesseract.esm.min.js",
    "node_modules/tesseract.js/dist/worker.min.js",
    "node_modules/tesseract.js-core/tesseract-core.wasm.js",
    "ocr-data/vie.traineddata.gz",
    "ocr-data/eng.traineddata.gz",
  ];

  await Promise.all(expectedFiles.map((path) => access(join(outputDir, path))));
  const html = await readFile(join(outputDir, "index.html"), "utf8");
  const app = await readFile(join(outputDir, "app.js"), "utf8");
  assert.match(html, /<title>Ai \u0102n N\u1ea5y Tr\u1ea3<\/title>/);
  assert.match(html, /aria-label="Trang ch\u1ee7 Ai \u0102n N\u1ea5y Tr\u1ea3"/);
  assert.match(html, /class="brand-logo"[\s\S]*?<span>Ai \u0102n N\u1ea5y Tr\u1ea3<\/span>/);
  assert.match(html, /Ai \u0102n N\u1ea5y Tr\u1ea3 · T\u00ednh r\u00f5 \u0111\u1ec3 vui l\u00e2u/);
  assert.match(html, /rel="icon"[^>]+teolaegi-pet-logo\.png/);
  assert.match(html, /class="brand-logo"[^>]+teolaegi-pet-logo\.png/);
  assert.match(html, /class="melo-stage"[^>]+aria-hidden="true"/);
  assert.match(html, /class="melo-performer"/);
  assert.match(html, /class="melo-sprite"/);
  assert.match(html, /class="hero-pet-scene"[^>]+aria-hidden="true"/);
  assert.match(html, /class="hero-pet hero-pet-teolaegi"/);
  assert.match(html, /class="hero-pet hero-pet-melo"/);
  assert.match(html, /class="hero-action-sprite hero-action-teolaegi-waiting"/);
  assert.match(html, /class="hero-action-sprite hero-action-teolaegi-running"/);
  assert.match(html, /class="hero-action-sprite hero-action-teolaegi-review"/);
  assert.match(html, /class="hero-action-sprite hero-action-melo-running"/);
  assert.match(html, /class="hero-action-sprite hero-action-melo-review"/);
  assert.match(html, /href="\.\/history\.html"/);
  assert.match(html, /teolaegi-spritesheet\.webp\?v=[a-f0-9]{12}/);
  assert.match(html, /melo-spritesheet\.webp\?v=[a-f0-9]{12}/);
  assert.match(html, /name="split-mode"/);
  assert.match(html, /id="bill-image-input"[\s\S]*?multiple/);
  assert.match(html, /id="bill-image-preview-list"/);
  assert.match(html, /id="confirm-split"/);
  assert.match(html, /id="summary-review-pending"/);
  assert.match(html, /id="confirmed-summary"[^>]+hidden/);
  assert.match(html, /Chia đều tổng thanh toán/);
  assert.match(html, /Theo món đã gọi/);
  assert.match(html, /styles\.css\?v=[a-f0-9]{12}/);
  assert.match(html, /app\.js\?v=[a-f0-9]{12}/);
  assert.match(app, /bill-calculator\.js\?v=[a-f0-9]{12}/);
  assert.match(app, /bill-ocr\.js\?v=[a-f0-9]{12}/);
  assert.match(app, /bill-history\.js\?v=[a-f0-9]{12}/);
  const historyHtml = await readFile(join(outputDir, "history.html"), "utf8");
  const historyApp = await readFile(join(outputDir, "history.js"), "utf8");
  assert.match(historyHtml, /<title>Lịch sử chia bill · Ai Ăn Nấy Trả<\/title>/);
  assert.match(historyHtml, /id="history-list"/);
  assert.match(historyHtml, /id="history-empty"/);
  assert.match(historyHtml, /history\.js\?v=[a-f0-9]{12}/);
  assert.match(historyApp, /bill-history\.js\?v=[a-f0-9]{12}/);
  const css = await readFile(join(outputDir, "styles.css"), "utf8");
  assert.match(css, /@keyframes melo-sing-across/);
  assert.match(css, /@keyframes melo-sing-frames/);
  assert.match(
    css,
    /\.melo-sprite img\s*\{[^}]*top:\s*-800%[^}]*animation:\s*melo-sing-frames\s+\d+ms\s+steps\(6,\s*end\)/,
  );
  assert.match(css, /@keyframes hero-pet-action-frames/);
  assert.match(css, /@keyframes hero-show-teolaegi-waiting/);
  assert.match(css, /@keyframes hero-show-teolaegi-running/);
  assert.match(css, /@keyframes hero-show-teolaegi-review/);
  assert.match(css, /@keyframes hero-show-melo-running/);
  assert.match(css, /@keyframes hero-show-melo-review/);
  assert.match(css, /\.hero-action-teolaegi-waiting img\s*\{[^}]*top:\s*-600%/);
  assert.match(css, /\.hero-action-teolaegi-running img\s*\{[^}]*top:\s*-700%/);
  assert.match(css, /\.hero-action-teolaegi-review img\s*\{[^}]*top:\s*-800%/);
  assert.match(css, /\.hero-action-melo-running img\s*\{[^}]*top:\s*-700%/);
  assert.match(css, /\.hero-action-melo-review img\s*\{[^}]*top:\s*-800%/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /\.melo-performer[\s\S]*?pointer-events:\s*none/);
  assert.match(
    css,
    /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.melo-sprite img\s*\{[^}]*top:\s*-800%[^}]*animation:\s*none/,
  );
  assert.match(app, /chia-bill-state-v2/);
  assert.match(app, /scanBillImages\(files, requestId\)/);
  assert.match(app, /selectBillImages\(event\.target\.files\)/);
  assert.match(app, /selectBillImages\(event\.dataTransfer\.files\)/);
  assert.doesNotMatch(app, /event\.(?:target|dataTransfer)\.files\[0\]/);
  assert.match(app, /applyOcrBill\(\{ scroll: false \}\)/);
  assert.match(app, /ocrRawText\.addEventListener\("input"/);
  assert.match(app, /let isSplitConfirmed = false/);
  assert.match(
    app,
    /function updateStateAndSummary\(\)[\s\S]*?invalidateSplitConfirmation\(\);[\s\S]*?renderSummary\(\)/,
  );
  assert.match(
    app,
    /confirmedSummary\.hidden = !isSplitConfirmed/,
  );
  assert.match(
    app,
    /confirmSplitButton\.addEventListener\("click", confirmSplit\)/,
  );
  assert.match(
    app,
    /function resetBill\(\)[\s\S]*?removeBillImage\(\);[\s\S]*?uploadPanel\.scrollIntoView/,
  );
  assert.match(html, /<dialog[^>]+id="reset-confirm-dialog"/);
  assert.match(html, /B\u1ea1n mu\u1ed1n b\u1eaft \u0111\u1ea7u bill m\u1edbi\?/);
  assert.match(html, /Gi\u1eef bill hi\u1ec7n t\u1ea1i/);
  assert.match(html, /id="confirm-reset-bill"[^>]*>\s*T\u1ea1o bill m\u1edbi/);
  assert.doesNotMatch(app, /window\.confirm\(/);
  assert.match(
    app,
    /#reset-bill"\)\.addEventListener\("click", openResetDialog\)/,
  );
  assert.match(
    app,
    /#confirm-reset-bill"\)\.addEventListener\("click", resetBill\)/,
  );
  assert.match(html, /id="ocr-progress-text"[^>]+aria-live="polite"/);
});
