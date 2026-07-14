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
    ".nojekyll",
    "node_modules/tesseract.js/dist/tesseract.esm.min.js",
    "node_modules/tesseract.js/dist/worker.min.js",
    "node_modules/tesseract.js-core/tesseract-core.wasm.js",
    "ocr-data/vie.traineddata.gz",
    "ocr-data/eng.traineddata.gz",
  ];

  await Promise.all(expectedFiles.map((path) => access(join(outputDir, path))));
  const html = await readFile(join(outputDir, "index.html"), "utf8");
  assert.match(html, /<title>Chia Bill<\/title>/);
  assert.match(html, /name="split-mode"/);
  assert.match(html, /Chia đều tổng thanh toán/);
  assert.match(html, /Theo món đã gọi/);
});
