import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const port = Number(process.argv[2] || process.env.PORT) || 4173;
const root = process.cwd();
const languageAssets = new Map([
  [
    "/ocr-data/vie.traineddata.gz",
    join(root, "node_modules", "@tesseract.js-data", "vie", "4.0.0_best_int", "vie.traineddata.gz"),
  ],
  [
    "/ocr-data/eng.traineddata.gz",
    join(root, "node_modules", "@tesseract.js-data", "eng", "4.0.0_best_int", "eng.traineddata.gz"),
  ],
]);
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
};

createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const filePath = normalize(languageAssets.get(pathname) || join(root, relativePath));
    if (!filePath.startsWith(root)) throw new Error("Invalid path");
    const file = await stat(filePath);
    if (!file.isFile()) throw new Error("Not a file");
    response.writeHead(200, { "Content-Type": contentTypes[extname(filePath)] || "application/octet-stream" });
    createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Không tìm thấy trang");
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`Ai Ăn Nấy Trả đang chạy tại http://127.0.0.1:${port}`);
});
