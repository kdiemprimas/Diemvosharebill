import {
  HISTORY_STORAGE_KEY,
  clearHistory as clearStoredHistory,
  filterHistoryByDateRange,
  isHistoryDateRangeValid,
  paginateHistoryRecords,
  readHistory,
  removeHistoryRecord,
} from "./bill-history.js";
import {
  DEBT_STORAGE_KEY,
  clearDebtEntries as clearStoredDebtEntries,
  createManualDebtEntry,
  filterDebtEntriesByYear,
  formatDebtAmountInput,
  getDebtOverview,
  getDebtSummary,
  getDebtYears,
  paginateDebtEntries,
  parseDebtAmountInput,
  readDebtEntries,
  removeDebtEntries,
  removeDebtEntry,
  updateDebtStatuses,
  updateDebtStatus,
  upsertDebtEntries,
} from "./debt-ledger.js";
import {
  createPersonDebtReport,
  createPersonDebtReportFilename,
  createDebtWorkbook,
  createDebtWorkbookFilename,
  getDebtExportEntries,
  getDebtReportPeriodLabel,
} from "./debt-export.js";
import {
  createDebtStatusConfirmation,
  createDebtStatusUpdateFeedback,
} from "./debt-status-update.js";

const money = new Intl.NumberFormat("vi-VN");
const confirmedTime = new Intl.DateTimeFormat("vi-VN", {
  dateStyle: "medium",
  timeStyle: "short",
});

const elements = {
  count: document.querySelector("#history-count"),
  list: document.querySelector("#history-list"),
  empty: document.querySelector("#history-empty"),
  clearButton: document.querySelector("#clear-history"),
  deleteDialog: document.querySelector("#history-delete-dialog"),
  deleteTitle: document.querySelector("#history-delete-title"),
  deleteDescription: document.querySelector("#history-delete-description"),
  confirmDelete: document.querySelector("#confirm-delete-history"),
  debtList: document.querySelector("#debt-ledger-list"),
  debtSummaryList: document.querySelector("#debt-summary-list"),
  debtFilter: document.querySelector("#debt-person-filter"),
  debtYearFilter: document.querySelector("#debt-year-filter"),
  debtTableWrap: document.querySelector("#debt-table-wrap"),
  debtEmpty: document.querySelector("#debt-ledger-empty"),
  debtFilterEmpty: document.querySelector("#debt-filter-empty"),
  debtClearButton: document.querySelector("#clear-debt-ledger"),
  debtExportButton: document.querySelector("#export-debt-excel"),
  debtReportButton: document.querySelector("#export-person-debt-image"),
  debtExportStatus: document.querySelector("#debt-export-status"),
  debtTotalUnpaid: document.querySelector("#debt-total-unpaid"),
  debtTotalPaid: document.querySelector("#debt-total-paid"),
  debtUnpaidCount: document.querySelector("#debt-unpaid-count"),
  debtPersonCount: document.querySelector("#debt-person-count"),
  debtPagination: document.querySelector("#debt-pagination"),
  debtPagePrev: document.querySelector("#debt-page-prev"),
  debtPageStatus: document.querySelector("#debt-page-status"),
  debtPageNext: document.querySelector("#debt-page-next"),
  debtBulkActions: document.querySelector("#debt-bulk-actions"),
  debtSelectionCount: document.querySelector("#debt-selection-count"),
  debtBulkMarkPaid: document.querySelector("#debt-bulk-mark-paid"),
  debtBulkMarkUnpaid: document.querySelector("#debt-bulk-mark-unpaid"),
  debtBulkDelete: document.querySelector("#debt-bulk-delete"),
  debtBulkFeedback: document.querySelector("#debt-bulk-feedback"),
  debtStatusDialog: document.querySelector("#debt-status-dialog"),
  debtStatusTitle: document.querySelector("#debt-status-title"),
  debtStatusDescription: document.querySelector("#debt-status-description"),
  confirmDebtStatusUpdate: document.querySelector("#confirm-debt-status-update"),
  debtSelectPage: document.querySelector("#debt-select-page"),
  openManualDebt: document.querySelector("#open-manual-debt"),
  openManualDebtEmpty: document.querySelector("#open-manual-debt-empty"),
  manualDebtDialog: document.querySelector("#manual-debt-dialog"),
  manualDebtForm: document.querySelector("#manual-debt-form"),
  manualDebtCreditor: document.querySelector("#manual-debt-creditor"),
  manualDebtDebtor: document.querySelector("#manual-debt-debtor"),
  manualDebtAmount: document.querySelector("#manual-debt-amount"),
  manualDebtDate: document.querySelector("#manual-debt-date"),
  manualDebtNote: document.querySelector("#manual-debt-note"),
  manualDebtStatus: document.querySelector("#manual-debt-status"),
  manualDebtPersonOptions: document.querySelector("#manual-debt-person-options"),
  manualDebtError: document.querySelector("#manual-debt-error"),
  cancelManualDebt: document.querySelector("#cancel-manual-debt"),
  historyDateFrom: document.querySelector("#history-date-from"),
  historyDateTo: document.querySelector("#history-date-to"),
  historyDateClear: document.querySelector("#history-date-clear"),
  historyDateError: document.querySelector("#history-date-error"),
  historyFilterEmpty: document.querySelector("#history-filter-empty"),
  historyFilterEmptyClear: document.querySelector("#history-filter-empty-clear"),
  historyPagination: document.querySelector("#history-pagination"),
  historyPagePrev: document.querySelector("#history-page-prev"),
  historyPageStatus: document.querySelector("#history-page-status"),
  historyPageNext: document.querySelector("#history-page-next"),
};

const DEBT_PAGE_SIZE = 10;
const HISTORY_PAGE_SIZE = 5;
let records = readHistory();
let debtEntries = readDebtEntries();
let debtPersonFilter = "";
let debtYearFilter = "";
let debtPage = 1;
let visibleDebtEntryIds = [];
const selectedDebtIds = new Set();
let historyDateFrom = "";
let historyDateTo = "";
let historyPage = 1;
let pendingDelete = null;
let pendingDebtStatusUpdate = null;

const formatMoney = (value) => `${money.format(Math.round(value || 0))} ₫`;

function escapeHtml(value) {
  const element = document.createElement("span");
  element.textContent = String(value ?? "");
  return element.innerHTML;
}

function getSplitModeLabel(splitMode) {
  return splitMode === "equal" ? "Chia đều tổng thanh toán" : "Theo món đã gọi";
}

function normalizeName(value) {
  return String(value || "").trim().toLocaleLowerCase("vi-VN");
}

function formatDebtDate(date) {
  const [year, month, day] = String(date).split("-");
  return year && month && day ? `${day}/${month}/${year}` : date;
}

function getTodayDateKey() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60 * 1000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function getManualDebtPeople() {
  const names = new Map();
  const addName = (value) => {
    const name = String(value || "").trim().replace(/\s+/g, " ");
    const key = normalizeName(name);
    if (key && !names.has(key)) names.set(key, name);
  };
  debtEntries.forEach(({ creditor, debtor }) => {
    addName(creditor);
    addName(debtor);
  });
  records.forEach(({ people }) => people.forEach(({ name }) => addName(name)));
  return [...names.values()].sort((left, right) => left.localeCompare(right, "vi"));
}

function clearManualDebtErrors() {
  elements.manualDebtError.textContent = "";
  [
    elements.manualDebtCreditor,
    elements.manualDebtDebtor,
    elements.manualDebtAmount,
    elements.manualDebtDate,
  ].forEach((input) => input.removeAttribute("aria-invalid"));
}

function formatManualDebtAmount() {
  const input = elements.manualDebtAmount;
  const selectionStart = input.selectionStart ?? input.value.length;
  const trailingDigitCount = input.value.slice(selectionStart).replace(/\D/g, "").length;
  input.value = formatDebtAmountInput(input.value);

  let caretPosition = input.value.length;
  let remainingTrailingDigits = trailingDigitCount;
  while (caretPosition > 0 && remainingTrailingDigits > 0) {
    caretPosition -= 1;
    if (/\d/.test(input.value[caretPosition])) remainingTrailingDigits -= 1;
  }
  input.setSelectionRange(caretPosition, caretPosition);
  clearManualDebtErrors();
}

function showManualDebtError(message, input) {
  elements.manualDebtError.textContent = message;
  input?.setAttribute("aria-invalid", "true");
  input?.focus();
}

function openManualDebtDialog() {
  elements.manualDebtForm.reset();
  elements.manualDebtDate.value = getTodayDateKey();
  elements.manualDebtStatus.value = "unpaid";
  elements.manualDebtPersonOptions.innerHTML = getManualDebtPeople()
    .map((name) => `<option value="${escapeHtml(name)}"></option>`)
    .join("");
  clearManualDebtErrors();
  if (typeof elements.manualDebtDialog.showModal === "function") {
    elements.manualDebtDialog.showModal();
  } else {
    elements.manualDebtDialog.setAttribute("open", "");
  }
  window.setTimeout(() => elements.manualDebtCreditor.focus(), 0);
}

function closeManualDebtDialog() {
  if (typeof elements.manualDebtDialog.close === "function") {
    elements.manualDebtDialog.close();
  } else {
    elements.manualDebtDialog.removeAttribute("open");
  }
}

function saveManualDebt(event) {
  event.preventDefault();
  clearManualDebtErrors();
  const creditor = elements.manualDebtCreditor.value.trim();
  const debtor = elements.manualDebtDebtor.value.trim();
  const amount = parseDebtAmountInput(elements.manualDebtAmount.value);
  const date = elements.manualDebtDate.value;

  if (!creditor) return showManualDebtError("Hãy nhập người đã ứng tiền.", elements.manualDebtCreditor);
  if (!debtor) return showManualDebtError("Hãy nhập người cần trả khoản này.", elements.manualDebtDebtor);
  if (normalizeName(creditor) === normalizeName(debtor)) {
    return showManualDebtError("Chủ nợ và người nợ cần là hai người khác nhau.", elements.manualDebtDebtor);
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return showManualDebtError("Số tiền cần lớn hơn 0 ₫.", elements.manualDebtAmount);
  }
  if (!date) return showManualDebtError("Hãy chọn ngày ghi nhận khoản nợ.", elements.manualDebtDate);

  const generatedId = globalThis.crypto?.randomUUID?.()
    || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const entry = createManualDebtEntry({
    id: generatedId,
    savedAt: new Date().toISOString(),
    creditor,
    debtor,
    amount,
    date,
    note: elements.manualDebtNote.value,
    status: elements.manualDebtStatus.value,
  });
  if (!entry) {
    showManualDebtError("Thông tin khoản nợ chưa hợp lệ. Hãy kiểm tra rồi thử lại.");
    return;
  }

  try {
    debtEntries = upsertDebtEntries(localStorage, entry.billId, [entry]);
  } catch {
    showManualDebtError("Trình duyệt chưa thể lưu dữ liệu. Hãy kiểm tra quyền lưu trữ rồi thử lại.");
    return;
  }
  debtPersonFilter = normalizeName(entry.debtor);
  debtYearFilter = entry.date.slice(0, 4);
  debtPage = 1;
  selectedDebtIds.clear();
  closeManualDebtDialog();
  renderDebtLedger();
}

function renderDebtSummaryCard(summary) {
  const isActive = normalizeName(summary.name) === debtPersonFilter;
  return `
    <button
      class="debt-summary-card${isActive ? " is-active" : ""}"
      type="button"
      data-debt-person="${escapeHtml(summary.name)}"
      aria-pressed="${isActive}"
    >
      <span class="debt-summary-name">${escapeHtml(summary.name)}</span>
      <span class="debt-summary-amounts">
        <span class="debt-summary-amount debt-summary-unpaid">
          <small>Còn nợ</small>
          <strong>${formatMoney(summary.unpaidAmount)}</strong>
        </span>
        <span class="debt-summary-amount debt-summary-paid">
          <small>Đã trả</small>
          <strong>${formatMoney(summary.paidAmount)}</strong>
        </span>
      </span>
      <small class="debt-summary-meta">${summary.unpaidCount} khoản chưa trả · ${summary.billCount} lần ghi nhận</small>
    </button>
  `;
}

function renderDebtRow(entry, index) {
  const isPaid = entry.status === "paid";
  const isSelected = selectedDebtIds.has(entry.id);
  return `
    <tr class="${isSelected ? "is-selected" : ""}">
      <td class="debt-select-cell" data-label="Chọn">
        <input
          class="debt-row-checkbox"
          type="checkbox"
          data-select-debt-id="${escapeHtml(entry.id)}"
          aria-label="Chọn khoản của ${escapeHtml(entry.debtor)}, ${escapeHtml(formatMoney(entry.amount))}"
          ${isSelected ? "checked" : ""}
        />
      </td>
      <td data-label="STT">${index + 1}</td>
      <td data-label="Chủ nợ">${escapeHtml(entry.creditor)}</td>
      <td data-label="Con nợ"><strong>${escapeHtml(entry.debtor)}</strong></td>
      <td class="debt-money-cell" data-label="Tiền">${formatMoney(entry.amount)}</td>
      <td data-label="Ngày"><time datetime="${escapeHtml(entry.date)}">${escapeHtml(formatDebtDate(entry.date))}</time></td>
      <td data-label="Ghi chú">${entry.note ? escapeHtml(entry.note) : '<span class="debt-empty-note">Không có</span>'}</td>
      <td data-label="Trạng thái">
        <div class="debt-row-actions">
          <button
            class="debt-status-button ${isPaid ? "is-paid" : "is-unpaid"}"
            type="button"
            data-toggle-debt-status="${escapeHtml(entry.id)}"
            aria-label="Đổi trạng thái khoản của ${escapeHtml(entry.debtor)}"
          >${isPaid ? "Đã trả" : "Chưa trả"}</button>
          <button
            class="debt-delete-button"
            type="button"
            data-delete-debt-id="${escapeHtml(entry.id)}"
            aria-label="Xóa khoản của ${escapeHtml(entry.debtor)}"
          >Xóa</button>
        </div>
      </td>
    </tr>
  `;
}

function renderDebtSelection() {
  const selectedCount = selectedDebtIds.size;
  const selectedVisibleCount = visibleDebtEntryIds.filter((id) => selectedDebtIds.has(id)).length;
  elements.debtBulkActions.hidden = selectedCount === 0;
  elements.debtSelectionCount.textContent = `${selectedCount} khoản đã chọn`;
  elements.debtSelectPage.disabled = visibleDebtEntryIds.length === 0;
  elements.debtSelectPage.checked = visibleDebtEntryIds.length > 0
    && selectedVisibleCount === visibleDebtEntryIds.length;
  elements.debtSelectPage.indeterminate = selectedVisibleCount > 0
    && selectedVisibleCount < visibleDebtEntryIds.length;
}

function focusDebtLedgerAfterBulkAction() {
  window.setTimeout(() => {
    const target = elements.debtList.querySelector(".debt-row-checkbox")
      || elements.openManualDebtEmpty;
    target.focus();
  }, 0);
}

function renderDebtFilter(summary) {
  const currentFilterStillExists = summary.some(
    ({ name }) => normalizeName(name) === debtPersonFilter,
  );
  if (!currentFilterStillExists) debtPersonFilter = "";
  elements.debtFilter.innerHTML = `
    <option value="">Tất cả mọi người</option>
    ${summary.map(({ name }) => `
      <option value="${escapeHtml(normalizeName(name))}" ${normalizeName(name) === debtPersonFilter ? "selected" : ""}>
        ${escapeHtml(name)}
      </option>
    `).join("")}
  `;
  elements.debtFilter.disabled = summary.length === 0;
}

function renderDebtYearFilter() {
  const years = getDebtYears(debtEntries);
  if (!years.includes(debtYearFilter)) debtYearFilter = "";
  elements.debtYearFilter.innerHTML = `
    <option value="">Tất cả năm</option>
    ${years.map((year) => `
      <option value="${year}" ${year === debtYearFilter ? "selected" : ""}>${year}</option>
    `).join("")}
  `;
  elements.debtYearFilter.disabled = years.length === 0;
}

function renderDebtLedger() {
  const currentDebtIds = new Set(debtEntries.map(({ id }) => id));
  selectedDebtIds.forEach((id) => {
    if (!currentDebtIds.has(id)) selectedDebtIds.delete(id);
  });
  renderDebtYearFilter();
  const yearEntries = filterDebtEntriesByYear(debtEntries, debtYearFilter);
  const summary = getDebtSummary(yearEntries);
  renderDebtFilter(summary);
  const filteredEntries = debtPersonFilter
    ? yearEntries.filter(({ debtor }) => normalizeName(debtor) === debtPersonFilter)
    : yearEntries;
  const pagination = paginateDebtEntries(filteredEntries, debtPage, DEBT_PAGE_SIZE);
  debtPage = pagination.page;
  visibleDebtEntryIds = pagination.items.map(({ id }) => id);
  const overview = getDebtOverview(yearEntries);

  elements.debtTotalUnpaid.textContent = formatMoney(overview.unpaidAmount);
  elements.debtTotalPaid.textContent = formatMoney(overview.paidAmount);
  elements.debtUnpaidCount.textContent = String(overview.unpaidCount);
  elements.debtPersonCount.textContent = String(overview.peopleCount);
  elements.debtSummaryList.innerHTML = summary.map(renderDebtSummaryCard).join("");
  elements.debtList.innerHTML = pagination.items
    .map((entry, index) => renderDebtRow(entry, pagination.start - 1 + index))
    .join("");
  elements.debtPagination.hidden = pagination.total <= DEBT_PAGE_SIZE;
  elements.debtPagePrev.disabled = pagination.page <= 1;
  elements.debtPageNext.disabled = pagination.page >= pagination.pageCount;
  elements.debtPageStatus.textContent = pagination.total
    ? `Trang ${pagination.page} / ${pagination.pageCount} · ${pagination.start}–${pagination.end} trên ${pagination.total} khoản`
    : "Trang 1 / 1";
  elements.debtClearButton.hidden = debtEntries.length === 0;
  elements.debtExportButton.disabled = filteredEntries.length === 0;
  elements.debtReportButton.disabled = !debtPersonFilter || filteredEntries.length === 0;
  elements.debtEmpty.hidden = debtEntries.length > 0;
  elements.debtTableWrap.hidden = filteredEntries.length === 0;
  elements.debtFilterEmpty.hidden = debtEntries.length === 0 || filteredEntries.length > 0;
  renderDebtSelection();
}

function clearDebtBulkFeedback() {
  elements.debtBulkFeedback.hidden = true;
  elements.debtBulkFeedback.textContent = "";
  delete elements.debtBulkFeedback.dataset.state;
  elements.debtBulkFeedback.setAttribute("role", "status");
  elements.debtBulkFeedback.setAttribute("aria-live", "polite");
}

function showDebtBulkFeedback(feedback) {
  elements.debtBulkFeedback.dataset.state = feedback.state;
  elements.debtBulkFeedback.setAttribute("role", feedback.state === "error" ? "alert" : "status");
  elements.debtBulkFeedback.setAttribute("aria-live", feedback.state === "error" ? "assertive" : "polite");
  elements.debtBulkFeedback.textContent = feedback.message;
  elements.debtBulkFeedback.hidden = false;
}

function closeDebtStatusDialog() {
  if (typeof elements.debtStatusDialog.close === "function") {
    elements.debtStatusDialog.close();
  } else {
    elements.debtStatusDialog.removeAttribute("open");
  }
}

function openDebtStatusDialog(status) {
  const ids = [...selectedDebtIds];
  if (!ids.length) return;
  pendingDebtStatusUpdate = { ids, status };
  const copy = createDebtStatusConfirmation(ids.length, status);
  elements.debtStatusTitle.textContent = copy.title;
  elements.debtStatusDescription.textContent = copy.description;
  elements.confirmDebtStatusUpdate.textContent = copy.button;

  if (typeof elements.debtStatusDialog.showModal === "function") {
    elements.debtStatusDialog.showModal();
  } else {
    elements.debtStatusDialog.setAttribute("open", "");
  }
}

function updateSelectedDebtStatus() {
  if (!pendingDebtStatusUpdate) return;
  const { ids, status } = pendingDebtStatusUpdate;
  pendingDebtStatusUpdate = null;
  try {
    debtEntries = updateDebtStatuses(localStorage, ids, status);
  } catch {
    closeDebtStatusDialog();
    showDebtBulkFeedback(createDebtStatusUpdateFeedback(ids.length, status, false));
    return;
  }
  selectedDebtIds.clear();
  closeDebtStatusDialog();
  renderDebtLedger();
  showDebtBulkFeedback(createDebtStatusUpdateFeedback(ids.length, status, true));
  focusDebtLedgerAfterBulkAction();
}

function exportDebtWorkbook() {
  const entries = getDebtExportEntries(debtEntries, debtPersonFilter, debtYearFilter);
  if (!entries.length) return;

  const originalLabel = elements.debtExportButton.textContent.trim();
  elements.debtExportButton.disabled = true;
  elements.debtExportButton.textContent = "Đang xuất…";
  elements.debtExportStatus.textContent = "Đang tạo file Excel.";
  try {
    const bytes = createDebtWorkbook(entries);
    const blob = new Blob([bytes], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = createDebtWorkbookFilename();
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    elements.debtExportButton.textContent = "Đã xuất ✓";
    elements.debtExportStatus.textContent = `Đã xuất ${entries.length} khoản sang Excel.`;
  } catch {
    elements.debtExportButton.textContent = "Không thể xuất";
    elements.debtExportStatus.textContent = "Không thể tạo file Excel. Hãy thử lại.";
  }

  window.setTimeout(() => {
    elements.debtExportButton.textContent = originalLabel;
    elements.debtExportButton.disabled = getDebtExportEntries(
      debtEntries,
      debtPersonFilter,
      debtYearFilter,
    ).length === 0;
  }, 1800);
}

function drawRoundedRect(context, x, y, width, height, radius, fill) {
  const corner = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + corner, y);
  context.arcTo(x + width, y, x + width, y + height, corner);
  context.arcTo(x + width, y + height, x, y + height, corner);
  context.arcTo(x, y + height, x, y, corner);
  context.arcTo(x, y, x + width, y, corner);
  context.closePath();
  context.fillStyle = fill;
  context.fill();
}

function fitCanvasText(context, value, maxWidth) {
  const text = String(value || "");
  if (context.measureText(text).width <= maxWidth) return text;
  let fitted = text;
  while (fitted.length > 1 && context.measureText(`${fitted}…`).width > maxWidth) {
    fitted = fitted.slice(0, -1);
  }
  return `${fitted}…`;
}

function getReportCreditorRows(creditors, maxRows = 6) {
  if (creditors.length <= maxRows) return creditors;
  const visible = creditors.slice(0, maxRows - 1);
  const remaining = creditors.slice(maxRows - 1);
  return [
    ...visible,
    {
      name: `${remaining.length} chủ nợ khác`,
      amount: remaining.reduce((total, { amount }) => total + amount, 0),
      unpaidCount: remaining.reduce((total, { unpaidCount }) => total + unpaidCount, 0),
    },
  ];
}

function drawPersonDebtReport(report) {
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1350;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is unavailable");

  context.fillStyle = "#fffaf3";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#557f8e";
  context.fillRect(0, 0, canvas.width, 24);

  context.fillStyle = "#557f8e";
  context.font = "800 30px system-ui, sans-serif";
  context.fillText("AI ĂN NẤY TRẢ", 100, 105);
  context.fillStyle = "#7b706d";
  context.font = "700 24px system-ui, sans-serif";
  context.textAlign = "right";
  context.fillText("BÁO CÁO TIỀN NỢ", 980, 105);
  context.textAlign = "left";

  context.fillStyle = "#2f3e46";
  context.font = "800 58px system-ui, sans-serif";
  context.fillText(fitCanvasText(context, report.personName, 880), 100, 200);
  context.fillStyle = "#7b706d";
  context.font = "500 26px system-ui, sans-serif";
  context.fillText(getDebtReportPeriodLabel(report.year), 100, 248);

  drawRoundedRect(context, 100, 300, 880, 300, 36, report.totalUnpaid ? "#fae5e2" : "#deeee7");
  context.fillStyle = report.totalUnpaid ? "#a54e54" : "#3f7168";
  context.font = "800 25px system-ui, sans-serif";
  context.fillText(report.totalUnpaid ? "TỔNG CÒN PHẢI TRẢ" : "ĐÃ TRẢ HẾT", 150, 370);
  context.font = "900 78px system-ui, sans-serif";
  context.fillText(formatMoney(report.totalUnpaid), 150, 475);

  context.fillStyle = "rgba(255, 255, 255, 0.72)";
  drawRoundedRect(context, 150, 510, 325, 58, 18, "rgba(255, 255, 255, 0.72)");
  drawRoundedRect(context, 495, 510, 435, 58, 18, "rgba(255, 255, 255, 0.72)");
  context.fillStyle = "#5f5754";
  context.font = "700 22px system-ui, sans-serif";
  context.fillText(`${report.unpaidCount} khoản chưa trả`, 176, 548);
  context.fillText(`Đã ghi nhận trả ${formatMoney(report.totalPaid)}`, 521, 548);

  context.fillStyle = "#2f3e46";
  context.font = "800 32px system-ui, sans-serif";
  context.fillText("Chi tiết theo chủ nợ", 100, 680);

  if (!report.creditors.length) {
    drawRoundedRect(context, 100, 720, 880, 180, 28, "#edf6f1");
    context.fillStyle = "#3f7168";
    context.font = "800 32px system-ui, sans-serif";
    context.fillText("Không còn khoản nào cần trả", 150, 795);
    context.fillStyle = "#687773";
    context.font = "500 24px system-ui, sans-serif";
    context.fillText("Mọi khoản đã ghi nhận đều có trạng thái đã trả.", 150, 845);
  } else {
    getReportCreditorRows(report.creditors).forEach((creditor, index) => {
      const y = 720 + index * 90;
      if (index % 2 === 0) drawRoundedRect(context, 100, y - 40, 880, 78, 18, "#f6f0e8");
      context.fillStyle = "#2f3e46";
      context.font = "700 27px system-ui, sans-serif";
      context.fillText(fitCanvasText(context, creditor.name, 440), 135, y + 9);
      context.fillStyle = "#847976";
      context.font = "500 20px system-ui, sans-serif";
      context.fillText(`${creditor.unpaidCount} khoản`, 590, y + 8);
      context.fillStyle = "#a54e54";
      context.font = "800 27px system-ui, sans-serif";
      context.textAlign = "right";
      context.fillText(formatMoney(creditor.amount), 945, y + 9);
      context.textAlign = "left";
    });
  }

  context.strokeStyle = "#d8d0c8";
  context.setLineDash([10, 10]);
  context.beginPath();
  context.moveTo(100, 1245);
  context.lineTo(980, 1245);
  context.stroke();
  context.setLineDash([]);
  context.fillStyle = "#7b706d";
  context.font = "500 21px system-ui, sans-serif";
  context.fillText(`Xuất ngày ${report.generatedDate}`, 100, 1302);
  context.textAlign = "right";
  context.fillText("Lưu từ sổ tiền chia", 980, 1302);
  context.textAlign = "left";
  return canvas;
}

function canvasToPngBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("PNG export failed"));
    }, "image/png");
  });
}

async function exportPersonDebtReportImage() {
  const report = createPersonDebtReport(debtEntries, debtPersonFilter, debtYearFilter);
  if (!report) return;

  const originalLabel = elements.debtReportButton.textContent.trim();
  elements.debtReportButton.disabled = true;
  elements.debtReportButton.textContent = "Đang tạo ảnh…";
  elements.debtExportStatus.textContent = `Đang tạo báo cáo của ${report.personName}.`;
  try {
    const canvas = drawPersonDebtReport(report);
    const blob = await canvasToPngBlob(canvas);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = createPersonDebtReportFilename(report.personName, report.year);
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    elements.debtReportButton.textContent = "Đã xuất ảnh ✓";
    elements.debtExportStatus.textContent = `Đã xuất báo cáo của ${report.personName}: còn nợ ${formatMoney(report.totalUnpaid)}.`;
  } catch {
    elements.debtReportButton.textContent = "Không thể xuất";
    elements.debtExportStatus.textContent = "Không thể tạo ảnh báo cáo. Hãy thử lại.";
  }

  window.setTimeout(() => {
    elements.debtReportButton.textContent = originalLabel;
    elements.debtReportButton.disabled = !createPersonDebtReport(
      debtEntries,
      debtPersonFilter,
      debtYearFilter,
    );
  }, 1800);
}

function renderPersonResult(person) {
  const lineItems = person.lineItems.length
    ? person.lineItems
        .map(
          (item) => `
            <li>
              <span>${item.shared ? "Chung · " : ""}${item.quantity > 1 ? `${item.quantity}× ` : ""}${escapeHtml(item.name)}</span>
              <strong>${formatMoney(item.amount)}</strong>
            </li>
          `,
        )
        .join("")
    : `<li class="history-no-items"><span>Không có món riêng</span></li>`;

  return `
    <article class="history-person-result">
      <div>
        <strong>${escapeHtml(person.name)}</strong>
        <b>${formatMoney(person.payable)}</b>
      </div>
      <ul>${lineItems}</ul>
    </article>
  `;
}

function renderHistoryCard(record) {
  return `
    <article class="history-card">
      <div class="history-card-heading">
        <div>
          <span class="history-platform">${escapeHtml(record.platform)}</span>
          <h3>${escapeHtml(record.billName)}</h3>
          <p>
            ${record.orderDate ? `Ngày đặt: ${escapeHtml(record.orderDate)} · ` : ""}
            Đã xác nhận ${escapeHtml(confirmedTime.format(new Date(record.confirmedAt)))}
          </p>
        </div>
        <button
          class="history-delete-button"
          type="button"
          data-delete-history-id="${escapeHtml(record.id)}"
          aria-label="Xóa ${escapeHtml(record.billName)} khỏi lịch sử"
        >
          Xóa
        </button>
      </div>

      <div class="history-card-stats">
        <div><span>Người tham gia</span><strong>${record.people.length}</strong></div>
        <div><span>Số món</span><strong>${record.itemCount}</strong></div>
        <div class="history-total-stat"><span>Tổng thanh toán</span><strong>${formatMoney(record.total)}</strong></div>
      </div>

      <div class="history-card-summary">
        <span>${escapeHtml(getSplitModeLabel(record.splitMode))}</span>
        <span>Tiền món ${formatMoney(record.subtotal)}</span>
        <span>Ship ${formatMoney(record.shippingFee)}</span>
        <span>Phụ thu ${formatMoney(record.surcharge)}</span>
        <span>Giảm ${formatMoney(record.discount)}</span>
      </div>

      <details class="history-details">
        <summary>Xem chi tiết từng người</summary>
        <div class="history-person-list">
          ${record.people.map(renderPersonResult).join("")}
        </div>
      </details>
    </article>
  `;
}

function renderHistory() {
  const isDateRangeValid = isHistoryDateRangeValid(historyDateFrom, historyDateTo);
  const filteredRecords = isDateRangeValid
    ? filterHistoryByDateRange(records, historyDateFrom, historyDateTo)
    : [];
  const pagination = paginateHistoryRecords(filteredRecords, historyPage, HISTORY_PAGE_SIZE);
  const hasDateFilter = Boolean(historyDateFrom || historyDateTo);
  historyPage = pagination.page;

  elements.count.textContent = String(records.length);
  elements.empty.hidden = records.length > 0;
  elements.clearButton.hidden = records.length === 0;
  elements.list.innerHTML = pagination.items.map(renderHistoryCard).join("");
  elements.historyDateFrom.disabled = records.length === 0;
  elements.historyDateTo.disabled = records.length === 0;
  elements.historyDateFrom.max = historyDateTo;
  elements.historyDateTo.min = historyDateFrom;
  elements.historyDateFrom.setAttribute("aria-invalid", String(!isDateRangeValid));
  elements.historyDateTo.setAttribute("aria-invalid", String(!isDateRangeValid));
  elements.historyDateError.hidden = isDateRangeValid;
  elements.historyDateClear.hidden = !hasDateFilter;
  elements.historyFilterEmpty.hidden = records.length === 0 || pagination.total > 0 || !isDateRangeValid;
  elements.historyPagination.hidden = pagination.total <= HISTORY_PAGE_SIZE || !isDateRangeValid;
  elements.historyPagePrev.disabled = pagination.page <= 1;
  elements.historyPageNext.disabled = pagination.page >= pagination.pageCount;
  elements.historyPageStatus.textContent = pagination.total
    ? `Trang ${pagination.page} / ${pagination.pageCount} · ${pagination.start}–${pagination.end} trên ${pagination.total} bill`
    : "Trang 1 / 1";
  renderDebtLedger();
}

function clearHistoryDateFilter() {
  historyDateFrom = "";
  historyDateTo = "";
  historyPage = 1;
  elements.historyDateFrom.value = "";
  elements.historyDateTo.value = "";
  renderHistory();
}

function scrollToHistoryList() {
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  document.querySelector("#history-heading")?.scrollIntoView({
    behavior: reduceMotion ? "auto" : "smooth",
    block: "start",
  });
}

function openDeleteDialog(deleteRequest) {
  pendingDelete = deleteRequest;
  const copy = {
    all: {
      title: "Xóa toàn bộ lịch sử bill?",
      description: `${records.length} bill đã lưu sẽ bị xóa và không thể khôi phục trên thiết bị này.`,
      button: "Xóa toàn bộ bill",
    },
    record: {
      title: `Xóa “${deleteRequest.billName}”?`,
      description: "Bill này sẽ bị xóa khỏi lịch sử và không thể khôi phục trên thiết bị này.",
      button: "Xóa khỏi lịch sử",
    },
    "debt-all": {
      title: "Xóa toàn bộ sổ tiền chia?",
      description: `${debtEntries.length} khoản đã lưu sẽ bị xóa. Lịch sử bill vẫn được giữ lại.`,
      button: "Xóa sổ tiền chia",
    },
    "debt-entry": {
      title: `Xóa khoản của “${deleteRequest.debtor}”?`,
      description: `${formatMoney(deleteRequest.amount)} sẽ bị xóa khỏi sổ tiền chia và không thể khôi phục.`,
      button: "Xóa khoản này",
    },
    "debt-bulk": {
      title: `Xóa ${deleteRequest.ids.length} khoản đã chọn?`,
      description: `${formatMoney(deleteRequest.amount)} trong các khoản đã chọn sẽ bị xóa và không thể khôi phục.`,
      button: `Xóa ${deleteRequest.ids.length} khoản`,
    },
  }[deleteRequest.type];
  elements.deleteTitle.textContent = copy.title;
  elements.deleteDescription.textContent = copy.description;
  elements.confirmDelete.textContent = copy.button;

  if (typeof elements.deleteDialog.showModal === "function") {
    elements.deleteDialog.showModal();
  } else {
    elements.deleteDialog.setAttribute("open", "");
  }
}

function closeDeleteDialog() {
  if (typeof elements.deleteDialog.close === "function") {
    elements.deleteDialog.close();
  } else {
    elements.deleteDialog.removeAttribute("open");
  }
}

elements.list.addEventListener("click", (event) => {
  const button = event.target.closest("[data-delete-history-id]");
  if (!button) return;
  const record = records.find(({ id }) => id === button.dataset.deleteHistoryId);
  if (!record) return;
  openDeleteDialog({ type: "record", id: record.id, billName: record.billName });
});

elements.clearButton.addEventListener("click", () => {
  openDeleteDialog({ type: "all" });
});

elements.historyDateFrom.addEventListener("change", (event) => {
  historyDateFrom = event.target.value;
  historyPage = 1;
  renderHistory();
});

elements.historyDateTo.addEventListener("change", (event) => {
  historyDateTo = event.target.value;
  historyPage = 1;
  renderHistory();
});

elements.historyDateClear.addEventListener("click", clearHistoryDateFilter);
elements.historyFilterEmptyClear.addEventListener("click", clearHistoryDateFilter);

elements.historyPagePrev.addEventListener("click", () => {
  historyPage -= 1;
  renderHistory();
  scrollToHistoryList();
});

elements.historyPageNext.addEventListener("click", () => {
  historyPage += 1;
  renderHistory();
  scrollToHistoryList();
});

elements.debtFilter.addEventListener("change", (event) => {
  debtPersonFilter = event.target.value;
  debtPage = 1;
  selectedDebtIds.clear();
  renderDebtLedger();
});

elements.debtExportButton.addEventListener("click", exportDebtWorkbook);
elements.debtReportButton.addEventListener("click", exportPersonDebtReportImage);

elements.openManualDebt.addEventListener("click", openManualDebtDialog);
elements.openManualDebtEmpty.addEventListener("click", openManualDebtDialog);
elements.cancelManualDebt.addEventListener("click", closeManualDebtDialog);
elements.manualDebtForm.addEventListener("submit", saveManualDebt);
[
  elements.manualDebtCreditor,
  elements.manualDebtDebtor,
  elements.manualDebtDate,
].forEach((input) => input.addEventListener("input", clearManualDebtErrors));
elements.manualDebtAmount.addEventListener("input", formatManualDebtAmount);

elements.debtYearFilter.addEventListener("change", (event) => {
  debtYearFilter = event.target.value;
  debtPage = 1;
  selectedDebtIds.clear();
  renderDebtLedger();
});

elements.debtSummaryList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-debt-person]");
  if (!button) return;
  const selectedName = normalizeName(button.dataset.debtPerson);
  debtPersonFilter = debtPersonFilter === selectedName ? "" : selectedName;
  debtPage = 1;
  selectedDebtIds.clear();
  renderDebtLedger();
});

elements.debtPagePrev.addEventListener("click", () => {
  debtPage -= 1;
  renderDebtLedger();
});

elements.debtPageNext.addEventListener("click", () => {
  debtPage += 1;
  renderDebtLedger();
});

elements.debtSelectPage.addEventListener("change", (event) => {
  visibleDebtEntryIds.forEach((id) => {
    if (event.target.checked) selectedDebtIds.add(id);
    else selectedDebtIds.delete(id);
  });
  clearDebtBulkFeedback();
  renderDebtLedger();
});

elements.debtList.addEventListener("change", (event) => {
  const checkbox = event.target.closest("[data-select-debt-id]");
  if (!checkbox) return;
  if (checkbox.checked) selectedDebtIds.add(checkbox.dataset.selectDebtId);
  else selectedDebtIds.delete(checkbox.dataset.selectDebtId);
  checkbox.closest("tr")?.classList.toggle("is-selected", checkbox.checked);
  clearDebtBulkFeedback();
  renderDebtSelection();
});

elements.debtBulkMarkPaid.addEventListener("click", () => openDebtStatusDialog("paid"));
elements.debtBulkMarkUnpaid.addEventListener("click", () => openDebtStatusDialog("unpaid"));
elements.confirmDebtStatusUpdate.addEventListener("click", updateSelectedDebtStatus);
elements.debtStatusDialog.addEventListener("close", () => {
  pendingDebtStatusUpdate = null;
});
elements.debtBulkDelete.addEventListener("click", () => {
  const selectedEntries = debtEntries.filter(({ id }) => selectedDebtIds.has(id));
  if (!selectedEntries.length) return;
  openDeleteDialog({
    type: "debt-bulk",
    ids: selectedEntries.map(({ id }) => id),
    amount: selectedEntries.reduce((total, { amount }) => total + amount, 0),
  });
});

elements.debtList.addEventListener("click", (event) => {
  const statusButton = event.target.closest("[data-toggle-debt-status]");
  if (statusButton) {
    const entry = debtEntries.find(({ id }) => id === statusButton.dataset.toggleDebtStatus);
    if (!entry) return;
    try {
      debtEntries = updateDebtStatus(
        localStorage,
        entry.id,
        entry.status === "paid" ? "unpaid" : "paid",
      );
      renderDebtLedger();
    } catch {
      return;
    }
    return;
  }

  const deleteButton = event.target.closest("[data-delete-debt-id]");
  if (!deleteButton) return;
  const entry = debtEntries.find(({ id }) => id === deleteButton.dataset.deleteDebtId);
  if (!entry) return;
  openDeleteDialog({ type: "debt-entry", id: entry.id, debtor: entry.debtor, amount: entry.amount });
});

elements.debtClearButton.addEventListener("click", () => {
  openDeleteDialog({ type: "debt-all" });
});

elements.confirmDelete.addEventListener("click", () => {
  if (!pendingDelete) return;
  const restoreDebtFocus = pendingDelete.type === "debt-bulk";
  try {
    if (pendingDelete.type === "all") {
      records = clearStoredHistory(localStorage);
      historyDateFrom = "";
      historyDateTo = "";
      historyPage = 1;
      elements.historyDateFrom.value = "";
      elements.historyDateTo.value = "";
    } else if (pendingDelete.type === "record") {
      records = removeHistoryRecord(localStorage, pendingDelete.id);
    } else if (pendingDelete.type === "debt-all") {
      debtEntries = clearStoredDebtEntries(localStorage);
    } else if (pendingDelete.type === "debt-entry") {
      debtEntries = removeDebtEntry(localStorage, pendingDelete.id);
    } else if (pendingDelete.type === "debt-bulk") {
      debtEntries = removeDebtEntries(localStorage, pendingDelete.ids);
      selectedDebtIds.clear();
      elements.debtBulkFeedback.textContent = `Đã xóa ${pendingDelete.ids.length} khoản đã chọn.`;
    }
  } catch {
    closeDeleteDialog();
    pendingDelete = null;
    return;
  }
  closeDeleteDialog();
  pendingDelete = null;
  renderHistory();
  if (restoreDebtFocus) focusDebtLedgerAfterBulkAction();
});

window.addEventListener("storage", (event) => {
  if (event.key === HISTORY_STORAGE_KEY) records = readHistory();
  else if (event.key === DEBT_STORAGE_KEY) debtEntries = readDebtEntries();
  else return;
  renderHistory();
});

renderHistory();
