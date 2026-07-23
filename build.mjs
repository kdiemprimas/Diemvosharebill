import { createHash } from "node:crypto";
import { cp, copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const sourceRoot = dirname(fileURLToPath(import.meta.url));
const publicFiles = [
  "index.html",
  "history.html",
  "styles.css",
  "app.js",
  "history.js",
  "bill-calculator.js",
  "bill-ocr.js",
  "bill-history.js",
];
const imageAssets = [
  "assets/teolaegi-pet-logo.png",
  "assets/melo-spritesheet.webp",
];

export async function buildStaticSite(outputDir = join(sourceRoot, "dist")) {
  const target = resolve(outputDir);
  if (target === resolve(sourceRoot) || target.length < 4) {
    throw new Error("Thư mục build không hợp lệ.");
  }

  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  await Promise.all(publicFiles.map((file) => copyFile(join(sourceRoot, file), join(target, file))));
  await mkdir(join(target, "assets"), { recursive: true });
  await Promise.all(imageAssets.map((file) => copyFile(join(sourceRoot, file), join(target, file))));

  const sourceContents = await Promise.all(
    publicFiles.map((file) => readFile(join(sourceRoot, file), "utf8")),
  );
  const imageContents = await Promise.all(imageAssets.map((file) => readFile(join(sourceRoot, file))));
  const assetVersion = createHash("sha256")
    .update(sourceContents.join("\0"))
    .update(Buffer.concat(imageContents))
    .digest("hex")
    .slice(0, 12);
  const versionHtml = (html, scriptName) => html
    .replace("./styles.css", `./styles.css?v=${assetVersion}`)
    .replace(`./${scriptName}`, `./${scriptName}?v=${assetVersion}`)
    .replaceAll(
      "./assets/teolaegi-pet-logo.png",
      `./assets/teolaegi-pet-logo.png?v=${assetVersion}`,
    )
    .replaceAll(
      "./assets/melo-spritesheet.webp",
      `./assets/melo-spritesheet.webp?v=${assetVersion}`,
    );
  const versionedHtml = versionHtml(
    sourceContents[publicFiles.indexOf("index.html")],
    "app.js",
  );
  const versionedHistoryHtml = versionHtml(
    sourceContents[publicFiles.indexOf("history.html")],
    "history.js",
  );
  const versionedApp = sourceContents[publicFiles.indexOf("app.js")]
    .replace("./bill-calculator.js", `./bill-calculator.js?v=${assetVersion}`)
    .replace("./bill-ocr.js", `./bill-ocr.js?v=${assetVersion}`)
    .replace("./bill-history.js", `./bill-history.js?v=${assetVersion}`);
  const versionedHistoryApp = sourceContents[publicFiles.indexOf("history.js")]
    .replace("./bill-history.js", `./bill-history.js?v=${assetVersion}`);
  await Promise.all([
    writeFile(join(target, "index.html"), versionedHtml, "utf8"),
    writeFile(join(target, "history.html"), versionedHistoryHtml, "utf8"),
    writeFile(join(target, "app.js"), versionedApp, "utf8"),
    writeFile(join(target, "history.js"), versionedHistoryApp, "utf8"),
  ]);

  await mkdir(join(target, "node_modules", "tesseract.js", "dist"), { recursive: true });
  await Promise.all(
    ["tesseract.esm.min.js", "worker.min.js"].map((file) =>
      copyFile(
        join(sourceRoot, "node_modules", "tesseract.js", "dist", file),
        join(target, "node_modules", "tesseract.js", "dist", file),
      ),
    ),
  );
  await cp(
    join(sourceRoot, "node_modules", "tesseract.js-core"),
    join(target, "node_modules", "tesseract.js-core"),
    { recursive: true },
  );

  await mkdir(join(target, "ocr-data"), { recursive: true });
  await Promise.all([
    copyFile(
      join(sourceRoot, "node_modules", "@tesseract.js-data", "vie", "4.0.0_best_int", "vie.traineddata.gz"),
      join(target, "ocr-data", "vie.traineddata.gz"),
    ),
    copyFile(
      join(sourceRoot, "node_modules", "@tesseract.js-data", "eng", "4.0.0_best_int", "eng.traineddata.gz"),
      join(target, "ocr-data", "eng.traineddata.gz"),
    ),
  ]);
  await writeFile(join(target, ".nojekyll"), "", "utf8");
  return target;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = await buildStaticSite();
  console.log(`Đã tạo bản deploy tại ${output}`);
}
