import { calculateBill, calculateEqualSplit } from "./bill-calculator.js";
import {
  buildStructuredOcrText,
  findTemporaryTotalRows,
  mergeOcrPageTexts,
  parseBillText,
} from "./bill-ocr.js";

const STORAGE_KEY = "chia-bill-state-v2";
const TESSERACT_MODULE_PATH = "./node_modules/tesseract.js/dist/tesseract.esm.min.js";
const MAX_BILL_IMAGES = 10;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const colors = ["#cc6f6d", "#df9668", "#79a8b7", "#9c788c", "#b6a06e", "#6f918e"];

const defaultState = () => ({
  billName: "Trưa thứ Sáu",
  platform: "GrabFood",
  orderDate: "",
  people: [
    { id: crypto.randomUUID(), name: "Minh" },
    { id: crypto.randomUUID(), name: "An" },
  ],
  items: [
    { id: crypto.randomUUID(), name: "Cơm gà", quantity: 1, price: 45000, ownerId: "" },
  ],
  shippingFee: 15000,
  surcharge: 0,
  discount: 20000,
  detectedTotalPayable: 0,
  splitMode: "byItems",
});

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved?.people && saved?.items) return { ...defaultState(), ...saved };
  } catch {
    // Keep a usable default if the browser storage was edited or corrupted.
  }
  return defaultState();
}

let state = loadState();
if (!["equal", "byItems"].includes(state.splitMode)) state.splitMode = "byItems";
let selectedBillFiles = [];
let selectedBillUrls = [];
let parsedOcrBill = null;
let scanRequestId = 0;
if (state.items[0] && !state.items[0].ownerId) state.items[0].ownerId = state.people[0]?.id || "all";

const elements = {
  billName: document.querySelector("#bill-name"),
  platform: document.querySelector("#platform"),
  orderDate: document.querySelector("#order-date"),
  peopleList: document.querySelector("#people-list"),
  itemsList: document.querySelector("#items-list"),
  shippingFee: document.querySelector("#shipping-fee"),
  surcharge: document.querySelector("#surcharge"),
  discount: document.querySelector("#discount"),
  results: document.querySelector("#person-results"),
  emptyResults: document.querySelector("#empty-results"),
  saveStatus: document.querySelector("#save-status"),
  validation: document.querySelector("#validation-message"),
  imageInput: document.querySelector("#bill-image-input"),
  uploadDropzone: document.querySelector("#upload-dropzone"),
  uploadPreview: document.querySelector("#upload-preview"),
  imagePreviewList: document.querySelector("#bill-image-preview-list"),
  fileName: document.querySelector("#bill-file-name"),
  fileSize: document.querySelector("#bill-file-size"),
  scanButton: document.querySelector("#scan-bill"),
  ocrProgress: document.querySelector("#ocr-progress"),
  ocrProgressBar: document.querySelector("#ocr-progress-bar"),
  ocrProgressText: document.querySelector("#ocr-progress-text"),
  ocrResult: document.querySelector("#ocr-result"),
  ocrResultCount: document.querySelector("#ocr-result-count"),
  ocrDetectedList: document.querySelector("#ocr-detected-list"),
  ocrRawText: document.querySelector("#ocr-raw-text"),
  ocrError: document.querySelector("#ocr-error"),
  uploadPanel: document.querySelector(".upload-panel"),
  splitModeInputs: document.querySelectorAll('input[name="split-mode"]'),
  resetDialog: document.querySelector("#reset-confirm-dialog"),
};

const money = new Intl.NumberFormat("vi-VN");
const formatMoney = (value) => `${money.format(Math.round(value || 0))} ₫`;
const parseMoney = (value) => Number(String(value).replace(/\D/g, "")) || 0;

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  elements.saveStatus.textContent = "Đã lưu trên thiết bị";
}

function setDirty() {
  elements.saveStatus.textContent = "Đang lưu…";
  window.clearTimeout(setDirty.timer);
  setDirty.timer = window.setTimeout(persist, 250);
}

function updateStateAndSummary() {
  setDirty();
  renderSummary();
}

function createOwnerOptions(selectedId) {
  const options = [{ id: "all", name: "Cả nhóm" }, ...state.people];
  return options
    .map(
      ({ id, name }) =>
        `<option value="${id}" ${id === selectedId ? "selected" : ""}>${escapeHtml(name || "Chưa đặt tên")}</option>`,
    )
    .join("");
}

function escapeHtml(value) {
  const element = document.createElement("span");
  element.textContent = value;
  return element.innerHTML;
}

function formatFileSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function clearOcrResult() {
  parsedOcrBill = null;
  elements.ocrResult.hidden = true;
  elements.ocrProgress.hidden = true;
  elements.ocrError.textContent = "";
  elements.ocrRawText.value = "";
}

async function selectBillImages(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  if (files.length > MAX_BILL_IMAGES) {
    setScanBusy(false);
    elements.ocrError.textContent = `Mỗi bill chọn tối đa ${MAX_BILL_IMAGES} ảnh. Hãy bớt ảnh rồi thử lại.`;
    return;
  }
  const invalidFile = files.find((file) => !file.type.startsWith("image/"));
  if (invalidFile) {
    setScanBusy(false);
    elements.ocrError.textContent = "Vui lòng chỉ chọn ảnh PNG, JPG hoặc WEBP.";
    return;
  }
  const oversizedFile = files.find((file) => file.size > MAX_IMAGE_BYTES);
  if (oversizedFile) {
    setScanBusy(false);
    elements.ocrError.textContent = `Ảnh “${oversizedFile.name}” lớn hơn 15 MB. Hãy giảm kích thước rồi thử lại.`;
    return;
  }

  const requestId = ++scanRequestId;
  clearOcrResult();
  selectedBillUrls.forEach((url) => URL.revokeObjectURL(url));
  selectedBillFiles = files;
  selectedBillUrls = files.map((file) => URL.createObjectURL(file));
  elements.imagePreviewList.innerHTML = "";
  files.forEach((file, index) => {
    const item = document.createElement("figure");
    item.className = "upload-preview-item";
    const image = document.createElement("img");
    image.src = selectedBillUrls[index];
    image.alt = `Ảnh ${index + 1}: ${file.name}`;
    const caption = document.createElement("figcaption");
    caption.textContent = `Ảnh ${index + 1}`;
    item.append(image, caption);
    elements.imagePreviewList.append(item);
  });

  const totalSize = files.reduce((sum, file) => sum + file.size, 0);
  elements.fileName.textContent = files.length === 1 ? files[0].name : `${files.length} ảnh đã chọn`;
  elements.fileSize.textContent = `${formatFileSize(totalSize)} · Đọc theo thứ tự ảnh · Không lưu ảnh`;
  elements.uploadDropzone.hidden = true;
  elements.uploadPreview.hidden = false;
  await scanBillImages(files, requestId);
}

function removeBillImage() {
  scanRequestId += 1;
  selectedBillFiles = [];
  selectedBillUrls.forEach((url) => URL.revokeObjectURL(url));
  selectedBillUrls = [];
  setScanBusy(false);
  elements.imageInput.value = "";
  elements.imagePreviewList.innerHTML = "";
  elements.uploadPreview.hidden = true;
  elements.uploadDropzone.hidden = false;
  clearOcrResult();
}

const ocrStatusText = {
  "loading tesseract core": "Đang tải bộ nhận diện…",
  "initializing tesseract": "Đang khởi tạo OCR…",
  "loading language traineddata": "Đang tải dữ liệu tiếng Việt…",
  "initializing api": "Đang chuẩn bị đọc ảnh…",
  "recognizing text": "Đang đọc tên, món và giá…",
};

function updateOcrProgress(message, imageIndex = 0, imageCount = 1) {
  const progress = Math.max(0, Math.min(1, Number(message.progress) || 0));
  const overallProgress = (imageIndex + progress) / imageCount;
  elements.ocrProgressBar.style.width = `${Math.round(overallProgress * 100)}%`;
  const status = ocrStatusText[message.status] || "Đang xử lý ảnh bill…";
  elements.ocrProgressText.textContent = imageCount > 1
    ? `${status} · Ảnh ${imageIndex + 1}/${imageCount}`
    : status;
}

function setScanBusy(isBusy) {
  elements.uploadPanel.setAttribute("aria-busy", String(isBusy));
  elements.scanButton.disabled = isBusy;
  elements.scanButton.textContent = isBusy
    ? "Đang đọc bill…"
    : selectedBillFiles.length > 1
      ? `Đọc lại ${selectedBillFiles.length} ảnh bill`
      : "Đọc lại ảnh bill";
}

async function prepareOcrImage(file) {
  if (typeof createImageBitmap !== "function") return { image: file, width: 0, height: 0 };

  const bitmap = await createImageBitmap(file);
  const scale = Math.max(1, Math.min(3, 1600 / bitmap.width, 3000 / bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext("2d");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return { image: canvas, width: canvas.width, height: canvas.height };
}

async function recognizeMissingHeaders(worker, image, temporaryRows, imageWidth, imageHeight, PSM) {
  if (!temporaryRows.length || !imageWidth || !imageHeight) return [];
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE });
  const names = [];

  for (const row of temporaryRows.slice(0, 20)) {
    const rowHeight = Math.max(12, row.bbox.y1 - row.bbox.y0);
    const rectangle = {
      left: Math.round(imageWidth * 0.1),
      top: Math.max(0, Math.round(row.bbox.y0 - rowHeight * 2.7)),
      width: Math.round(imageWidth * 0.55),
      height: Math.min(imageHeight, Math.round(rowHeight * 3)),
    };
    const headerRecognition = await worker.recognize(image, { rectangle });
    names.push(headerRecognition.data.text.trim());
  }
  return names;
}

function renderOcrResult() {
  if (!parsedOcrBill) return;
  elements.ocrDetectedList.innerHTML = "";
  elements.ocrResultCount.textContent = `${parsedOcrBill.people.length} người · ${parsedOcrBill.items.length} món`;

  parsedOcrBill.people.forEach((ownerName) => {
    const ownerItems = parsedOcrBill.items.filter((item) => item.ownerName === ownerName);
    const ownerTotal = ownerItems.reduce((sum, item) => sum + item.lineTotal, 0);
    const card = document.createElement("article");
    card.className = "ocr-person-card";
    card.innerHTML = `
      <div class="ocr-person-heading">
        <strong>${escapeHtml(ownerName)}</strong>
        <span>Tổng món · ${formatMoney(ownerTotal)}</span>
      </div>
      <ul>
        ${ownerItems.map((item) => `
          <li>
            <span>${item.quantity > 1 ? `${item.quantity}× ` : ""}${escapeHtml(item.name)}</span>
            <strong>${formatMoney(item.lineTotal)}</strong>
          </li>
        `).join("")}
      </ul>
    `;
    elements.ocrDetectedList.append(card);
  });

  const meta = document.createElement("dl");
  meta.className = "ocr-detected-meta";
  meta.innerHTML = `
    ${parsedOcrBill.orderDate ? `<div><dt>Ngày đặt</dt><dd>${escapeHtml(parsedOcrBill.orderDate)}</dd></div>` : ""}
    <div><dt>Tiền món</dt><dd>${formatMoney(parsedOcrBill.subtotal)}</dd></div>
    <div><dt>Phí ship</dt><dd>${formatMoney(parsedOcrBill.shippingFee)}</dd></div>
    <div><dt>Phụ thu</dt><dd>${formatMoney(parsedOcrBill.surcharge)}</dd></div>
    <div><dt>Tổng giảm giá</dt><dd>− ${formatMoney(parsedOcrBill.discount)}</dd></div>
    <div class="ocr-payable"><dt>Tổng phải trả</dt><dd>${formatMoney(parsedOcrBill.totalPayable)}</dd></div>
  `;
  elements.ocrDetectedList.append(meta);
  elements.ocrResult.hidden = false;
}

function parseAndShowOcr(rawText) {
  parsedOcrBill = parseBillText(rawText);
  elements.ocrError.textContent = parsedOcrBill.items.length
    ? ""
    : "Chưa tìm thấy món và giá trong nội dung OCR. Bạn có thể sửa nội dung bên dưới rồi phân tích lại.";
  renderOcrResult();
}

function parseApplyAndShowOcr(rawText) {
  parseAndShowOcr(rawText);
  if (parsedOcrBill.items.length) applyOcrBill({ scroll: false });
}

async function scanBillImages(files = selectedBillFiles, requestId = ++scanRequestId) {
  files = Array.from(files || []);
  if (!files.length) return;
  elements.ocrError.textContent = "";
  elements.ocrResult.hidden = true;
  elements.ocrProgress.hidden = false;
  elements.ocrProgressBar.style.width = "2%";
  elements.ocrProgressText.textContent = "Đang tải bộ nhận diện…";
  setScanBusy(true);

  let worker;
  let currentImageIndex = 0;
  try {
    if (window.location.protocol === "file:") {
      throw new Error("OCR_REQUIRES_LOCALHOST");
    }
    const tesseractModule = await import(TESSERACT_MODULE_PATH);
    const { createWorker, PSM } = tesseractModule.default || tesseractModule;
    worker = await createWorker("vie+eng", 1, {
      workerPath: "./node_modules/tesseract.js/dist/worker.min.js",
      corePath: "./node_modules/tesseract.js-core",
      langPath: "./ocr-data",
      workerBlobURL: false,
      logger: (message) => {
        if (requestId === scanRequestId) {
          updateOcrProgress(message, currentImageIndex, files.length);
        }
      },
    });
    const pageTexts = [];
    for (currentImageIndex = 0; currentImageIndex < files.length; currentImageIndex += 1) {
      if (requestId !== scanRequestId) return;
      elements.ocrProgressText.textContent = files.length > 1
        ? `Đang chuẩn bị ảnh ${currentImageIndex + 1}/${files.length}…`
        : "Đang chuẩn bị đọc ảnh…";
      const prepared = await prepareOcrImage(files[currentImageIndex]);
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.SPARSE_TEXT,
        preserve_interword_spaces: "1",
      });
      const recognition = await worker.recognize(
        prepared.image,
        { rotateAuto: true },
        { text: true, blocks: true },
      );
      const blocks = recognition.data.blocks || [];
      const layoutWidth = prepared.width || Math.max(0, ...blocks.map((block) => block.bbox?.x1 || 0));
      const layoutHeight = prepared.height || Math.max(0, ...blocks.map((block) => block.bbox?.y1 || 0));
      const temporaryRows = findTemporaryTotalRows(blocks, layoutWidth);
      const headerNames = await recognizeMissingHeaders(
        worker,
        prepared.image,
        temporaryRows,
        layoutWidth,
        layoutHeight,
        PSM,
      );
      pageTexts.push((blocks.length
        ? buildStructuredOcrText(blocks, headerNames, layoutWidth)
        : recognition.data.text).trim());
    }
    const rawText = mergeOcrPageTexts(pageTexts);
    if (requestId !== scanRequestId) return;
    elements.ocrRawText.value = rawText;
    parseApplyAndShowOcr(rawText);
  } catch (error) {
    if (requestId !== scanRequestId) return;
    console.error("OCR failed", error);
    elements.ocrError.textContent = error.message === "OCR_REQUIRES_LOCALHOST"
      ? "OCR không chạy khi mở trực tiếp file index.html. Hãy mở http://127.0.0.1:4173 rồi thử lại."
      : "Không thể khởi tạo OCR local. Hãy chạy npm install, khởi động lại server rồi thử lại.";
  } finally {
    if (worker) await worker.terminate();
    if (requestId === scanRequestId) {
      elements.ocrProgress.hidden = true;
      setScanBusy(false);
    }
  }
}

function applyOcrBill({ scroll = true } = {}) {
  if (!parsedOcrBill?.items.length) return;
  const peopleNames = parsedOcrBill.people.length ? parsedOcrBill.people : ["Chưa xác định"];
  const people = peopleNames.map((name) => ({ id: crypto.randomUUID(), name }));
  const peopleByName = new Map(people.map((person) => [person.name, person.id]));

  state.people = people;
  state.items = parsedOcrBill.items.map((item) => ({
    id: crypto.randomUUID(),
    name: item.name,
    quantity: item.quantity,
    price: item.price,
    ownerId: peopleByName.get(item.ownerName) || people[0].id,
  }));
  state.shippingFee = parsedOcrBill.shippingFee;
  state.surcharge = parsedOcrBill.surcharge;
  state.discount = parsedOcrBill.discount;
  state.orderDate = parsedOcrBill.orderDate;
  state.detectedTotalPayable = parsedOcrBill.totalPayable;
  if (parsedOcrBill.platform !== "Khác") state.platform = parsedOcrBill.platform;
  renderAll();
  persist();
  if (scroll) document.querySelector(".items-panel").scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderPeople() {
  elements.peopleList.innerHTML = "";
  state.people.forEach((person, index) => {
    const fragment = document.querySelector("#person-template").content.cloneNode(true);
    const chip = fragment.querySelector(".person-chip");
    const avatar = fragment.querySelector(".avatar");
    const input = fragment.querySelector("input");
    chip.dataset.id = person.id;
    avatar.style.background = colors[index % colors.length];
    avatar.textContent = (person.name || "?").trim().charAt(0).toUpperCase();
    input.value = person.name;
    input.addEventListener("input", (event) => {
      person.name = event.target.value;
      avatar.textContent = (person.name || "?").trim().charAt(0).toUpperCase();
      updateOwnerOptions();
      updateStateAndSummary();
    });
    fragment.querySelector(".remove-person").addEventListener("click", () => removePerson(person.id));
    elements.peopleList.append(fragment);
  });
}

function renderItems() {
  elements.itemsList.innerHTML = "";
  state.items.forEach((item) => {
    const fragment = document.querySelector("#item-template").content.cloneNode(true);
    const row = fragment.querySelector(".item-row");
    const nameInput = fragment.querySelector(".item-name");
    const quantityInput = fragment.querySelector(".item-quantity");
    const priceInput = fragment.querySelector(".item-price");
    const ownerSelect = fragment.querySelector(".item-owner");
    row.dataset.id = item.id;
    nameInput.value = item.name;
    quantityInput.value = item.quantity;
    priceInput.value = money.format(item.price);
    ownerSelect.innerHTML = createOwnerOptions(item.ownerId);

    nameInput.addEventListener("input", (event) => {
      item.name = event.target.value;
      updateStateAndSummary();
    });
    quantityInput.addEventListener("input", (event) => {
      item.quantity = Math.max(1, parseInt(event.target.value, 10) || 1);
      updateStateAndSummary();
    });
    priceInput.addEventListener("input", (event) => {
      item.price = parseMoney(event.target.value);
      updateStateAndSummary();
    });
    priceInput.addEventListener("blur", () => {
      priceInput.value = money.format(item.price);
    });
    ownerSelect.addEventListener("change", (event) => {
      item.ownerId = event.target.value;
      updateStateAndSummary();
    });
    fragment.querySelector(".remove-item").addEventListener("click", () => {
      state.items = state.items.filter(({ id }) => id !== item.id);
      renderItems();
      updateStateAndSummary();
    });
    elements.itemsList.append(fragment);
  });
}

function updateOwnerOptions() {
  elements.itemsList.querySelectorAll(".item-row").forEach((row) => {
    const item = state.items.find(({ id }) => id === row.dataset.id);
    row.querySelector(".item-owner").innerHTML = createOwnerOptions(item.ownerId);
  });
}

function removePerson(personId) {
  state.people = state.people.filter(({ id }) => id !== personId);
  state.items.forEach((item) => {
    if (item.ownerId === personId) item.ownerId = "all";
  });
  renderPeople();
  renderItems();
  updateStateAndSummary();
}

function getCalculatedBill() {
  const detailedBill = calculateBill(state);
  if (state.splitMode !== "equal") return detailedBill;

  const finalTotal = Math.max(
    0,
    Math.round(Number(state.detectedTotalPayable) || detailedBill.total),
  );
  const equalBill = calculateEqualSplit({ people: state.people, total: finalTotal });
  return { ...detailedBill, ...equalBill };
}

function renderSummary() {
  const bill = getCalculatedBill();
  const isEqualSplit = state.splitMode === "equal";
  document.querySelector("#summary-name").textContent = state.billName.trim() || "Bill mới";
  document.querySelector("#summary-platform").textContent = state.platform.toUpperCase();
  const summaryDate = document.querySelector("#summary-date");
  summaryDate.textContent = state.orderDate || "";
  summaryDate.hidden = !state.orderDate;
  document.querySelector("#summary-split-mode").textContent = isEqualSplit
    ? "Chia đều tổng thanh toán"
    : "Theo món đã gọi";
  document.querySelector("#subtotal").textContent = formatMoney(bill.subtotal);
  document.querySelector("#summary-shipping").textContent = formatMoney(bill.shippingFee);
  document.querySelector("#summary-surcharge").textContent = formatMoney(bill.surcharge);
  document.querySelector("#summary-discount").textContent = `− ${formatMoney(bill.discount)}`;
  document.querySelector("#grand-total").textContent = formatMoney(bill.total);
  elements.results.innerHTML = "";
  elements.emptyResults.hidden = bill.results.length > 0;

  bill.results.forEach((result, index) => {
    const article = document.createElement("article");
    article.className = "result-row";
    const itemDetails = isEqualSplit
      ? `<li><span>1 phần tổng thanh toán</span><strong>${formatMoney(result.payable)}</strong></li>`
      : result.lineItems.length
      ? result.lineItems
          .map(
            (item) => `
              <li>
                <span>${item.shared ? "Chung · " : ""}${item.quantity > 1 ? `${item.quantity}× ` : ""}${escapeHtml(item.name)}</span>
                <strong>${formatMoney(item.amount)}</strong>
              </li>
            `,
          )
          .join("")
      : `<li class="no-items"><span>Chưa có món</span><strong>0 ₫</strong></li>`;
    article.innerHTML = `
      <div class="result-header">
        <span class="result-avatar" style="background:${colors[index % colors.length]}">${escapeHtml((result.name || "?").trim().charAt(0).toUpperCase())}</span>
        <div class="result-person">
          <strong>${escapeHtml(result.name || "Chưa đặt tên")}</strong>
          <small>${isEqualSplit
            ? `Chia đều từ tổng ${formatMoney(bill.total)}`
            : `Ship ${formatMoney(result.shippingShare)} · Phụ thu ${formatMoney(result.surchargeShare)} · Giảm ${formatMoney(result.discountShare)}`}</small>
        </div>
        <strong class="result-amount">${formatMoney(result.payable)}</strong>
      </div>
      <ul class="result-item-list">${itemDetails}</ul>
    `;
    elements.results.append(article);
  });

  const unassignedItems = state.items.filter(
    (item) => item.ownerId !== "all" && !state.people.some(({ id }) => id === item.ownerId),
  );
  if (!state.people.length) {
    elements.validation.textContent = "Hãy thêm ít nhất một người để chia bill.";
  } else if (unassignedItems.length) {
    elements.validation.textContent = "Có món chưa được gán cho người tham gia.";
  } else if (bill.discount > bill.subtotal + bill.shippingFee + bill.surcharge) {
    elements.validation.textContent = "Tổng giảm giá đang lớn hơn tiền món và các khoản phí.";
  } else if (!isEqualSplit && state.detectedTotalPayable && Math.abs(state.detectedTotalPayable - bill.total) > 1) {
    elements.validation.textContent = `Tổng từ ảnh là ${formatMoney(state.detectedTotalPayable)}, đang lệch ${formatMoney(Math.abs(state.detectedTotalPayable - bill.total))}. Hãy kiểm tra lại món hoặc phí.`;
  } else {
    elements.validation.textContent = "";
  }
}

function bindMoneyInput(input, key) {
  input.addEventListener("input", (event) => {
    state[key] = parseMoney(event.target.value);
    updateStateAndSummary();
  });
  input.addEventListener("blur", () => {
    input.value = money.format(state[key]);
  });
}

function getShareText() {
  const bill = getCalculatedBill();
  const isEqualSplit = state.splitMode === "equal";
  const lines = [
    `🍜 ${state.billName.trim() || "Chia bill đồ ăn"} (${state.platform})`,
    ...(state.orderDate ? [`Ngày đặt: ${state.orderDate}`] : []),
    `Cách chia: ${isEqualSplit ? "Chia đều tổng thanh toán" : "Theo món đã gọi"}`,
    ...bill.results.flatMap((result) => [
      `• ${result.name || "Chưa đặt tên"}: ${formatMoney(result.payable)}`,
      ...(isEqualSplit ? [] : result.lineItems.map(
        (item) => `  - ${item.shared ? "[Chung] " : ""}${item.quantity > 1 ? `${item.quantity}× ` : ""}${item.name}: ${formatMoney(item.amount)}`,
      )),
    ]),
    `Phí ship: ${formatMoney(bill.shippingFee)} · Phụ thu: ${formatMoney(bill.surcharge)} · Giảm: ${formatMoney(bill.discount)}`,
    `Tổng phải trả: ${formatMoney(bill.total)}`,
    isEqualSplit
      ? "Tổng thanh toán đã được chia đều cho tất cả người tham gia."
      : "Các khoản phí và giảm giá đã được chia đều.",
  ];
  return lines.join("\n");
}

async function copyResult() {
  const button = document.querySelector("#copy-result");
  if (!state.people.length) return;
  try {
    await navigator.clipboard.writeText(getShareText());
    button.textContent = "Đã sao chép ✓";
  } catch {
    button.textContent = "Không thể sao chép";
  }
  window.setTimeout(() => (button.textContent = "Sao chép kết quả"), 1600);
}

function openResetDialog() {
  if (typeof elements.resetDialog.showModal === "function") {
    elements.resetDialog.showModal();
    return;
  }
  elements.resetDialog.setAttribute("open", "");
}

function closeResetDialog() {
  if (typeof elements.resetDialog.close === "function") {
    elements.resetDialog.close();
    return;
  }
  elements.resetDialog.removeAttribute("open");
}

function resetBill() {
  closeResetDialog();
  removeBillImage();
  state = defaultState();
  state.items[0].ownerId = state.people[0].id;
  renderAll();
  persist();
  elements.uploadPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderAll() {
  elements.billName.value = state.billName;
  elements.platform.value = state.platform;
  elements.orderDate.value = state.orderDate || "";
  elements.shippingFee.value = money.format(state.shippingFee);
  elements.surcharge.value = money.format(state.surcharge || 0);
  elements.discount.value = money.format(state.discount);
  elements.splitModeInputs.forEach((input) => {
    input.checked = input.value === state.splitMode;
  });
  renderPeople();
  renderItems();
  renderSummary();
}

elements.billName.addEventListener("input", (event) => {
  state.billName = event.target.value;
  updateStateAndSummary();
});
elements.platform.addEventListener("change", (event) => {
  state.platform = event.target.value;
  updateStateAndSummary();
});
elements.orderDate.addEventListener("input", (event) => {
  state.orderDate = event.target.value;
  updateStateAndSummary();
});
document.querySelector("#add-person").addEventListener("click", () => {
  const person = { id: crypto.randomUUID(), name: `Người ${state.people.length + 1}` };
  state.people.push(person);
  renderPeople();
  updateOwnerOptions();
  updateStateAndSummary();
  elements.peopleList.lastElementChild?.querySelector("input")?.focus();
});
document.querySelector("#add-item").addEventListener("click", () => {
  state.items.push({
    id: crypto.randomUUID(),
    name: "",
    quantity: 1,
    price: 0,
    ownerId: state.people[0]?.id || "all",
  });
  renderItems();
  updateStateAndSummary();
  elements.itemsList.lastElementChild?.querySelector(".item-name")?.focus();
});
document.querySelector("#copy-result").addEventListener("click", copyResult);
document.querySelector("#reset-bill").addEventListener("click", openResetDialog);
document.querySelector("#confirm-reset-bill").addEventListener("click", resetBill);
elements.imageInput.addEventListener("change", (event) => selectBillImages(event.target.files));
elements.uploadDropzone.addEventListener("dragover", (event) => {
  event.preventDefault();
  elements.uploadDropzone.classList.add("is-dragging");
});
elements.uploadDropzone.addEventListener("dragleave", () => {
  elements.uploadDropzone.classList.remove("is-dragging");
});
elements.uploadDropzone.addEventListener("drop", (event) => {
  event.preventDefault();
  elements.uploadDropzone.classList.remove("is-dragging");
  selectBillImages(event.dataTransfer.files);
});
document.querySelector("#remove-bill-image").addEventListener("click", removeBillImage);
elements.scanButton.addEventListener("click", () => scanBillImages());
document.querySelector("#reparse-ocr").addEventListener("click", () => {
  parseApplyAndShowOcr(elements.ocrRawText.value);
});
elements.ocrRawText.addEventListener("input", () => {
  window.clearTimeout(elements.ocrRawText.reparseTimer);
  elements.ocrRawText.reparseTimer = window.setTimeout(
    () => parseApplyAndShowOcr(elements.ocrRawText.value),
    350,
  );
});
document.querySelector("#apply-ocr").addEventListener("click", () => applyOcrBill());
bindMoneyInput(elements.shippingFee, "shippingFee");
bindMoneyInput(elements.surcharge, "surcharge");
bindMoneyInput(elements.discount, "discount");
elements.splitModeInputs.forEach((input) => {
  input.addEventListener("change", (event) => {
    if (!event.target.checked) return;
    state.splitMode = event.target.value;
    updateStateAndSummary();
  });
});

renderAll();
