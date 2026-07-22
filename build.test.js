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
    "styles.css",
    "app.js",
    "bill-calculator.js",
    "bill-ocr.js",
    "assets/teolaegi-pet-logo.png",
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
  assert.match(html, /name="split-mode"/);
  assert.match(html, /Chia đều tổng thanh toán/);
  assert.match(html, /Theo món đã gọi/);
  assert.match(html, /styles\.css\?v=[a-f0-9]{12}/);
  assert.match(html, /app\.js\?v=[a-f0-9]{12}/);
  assert.match(app, /bill-calculator\.js\?v=[a-f0-9]{12}/);
  assert.match(app, /bill-ocr\.js\?v=[a-f0-9]{12}/);
  assert.match(app, /chia-bill-state-v2/);
  assert.match(app, /scanBillImage\(file, requestId\)/);
  assert.match(app, /applyOcrBill\(\{ scroll: false \}\)/);
  assert.match(app, /ocrRawText\.addEventListener\("input"/);
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
