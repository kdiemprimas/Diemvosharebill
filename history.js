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
  filterDebtEntriesByYear,
  getDebtOverview,
  getDebtSummary,
  getDebtYears,
  paginateDebtEntries,
  readDebtEntries,
  removeDebtEntry,
  updateDebtStatus,
} from "./debt-ledger.js";

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
  debtTotalUnpaid: document.querySelector("#debt-total-unpaid"),
  debtTotalPaid: document.querySelector("#debt-total-paid"),
  debtUnpaidCount: document.querySelector("#debt-unpaid-count"),
  debtPersonCount: document.querySelector("#debt-person-count"),
  debtPagination: document.querySelector("#debt-pagination"),
  debtPagePrev: document.querySelector("#debt-page-prev"),
  debtPageStatus: document.querySelector("#debt-page-status"),
  debtPageNext: document.querySelector("#debt-page-next"),
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
let historyDateFrom = "";
let historyDateTo = "";
let historyPage = 1;
let pendingDelete = null;

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
      <small class="debt-summary-meta">${summary.unpaidCount} khoản chưa trả · ${summary.billCount} bill</small>
    </button>
  `;
}

function renderDebtRow(entry, index) {
  const isPaid = entry.status === "paid";
  return `
    <tr>
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
  renderDebtYearFilter();
  const yearEntries = filterDebtEntriesByYear(debtEntries, debtYearFilter);
  const summary = getDebtSummary(yearEntries);
  renderDebtFilter(summary);
  const filteredEntries = debtPersonFilter
    ? yearEntries.filter(({ debtor }) => normalizeName(debtor) === debtPersonFilter)
    : yearEntries;
  const pagination = paginateDebtEntries(filteredEntries, debtPage, DEBT_PAGE_SIZE);
  debtPage = pagination.page;
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
  elements.debtEmpty.hidden = debtEntries.length > 0;
  elements.debtTableWrap.hidden = filteredEntries.length === 0;
  elements.debtFilterEmpty.hidden = debtEntries.length === 0 || filteredEntries.length > 0;
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
  renderDebtLedger();
});

elements.debtYearFilter.addEventListener("change", (event) => {
  debtYearFilter = event.target.value;
  debtPage = 1;
  renderDebtLedger();
});

elements.debtSummaryList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-debt-person]");
  if (!button) return;
  const selectedName = normalizeName(button.dataset.debtPerson);
  debtPersonFilter = debtPersonFilter === selectedName ? "" : selectedName;
  debtPage = 1;
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
    }
  } catch {
    closeDeleteDialog();
    pendingDelete = null;
    return;
  }
  closeDeleteDialog();
  pendingDelete = null;
  renderHistory();
});

window.addEventListener("storage", (event) => {
  if (event.key === HISTORY_STORAGE_KEY) records = readHistory();
  else if (event.key === DEBT_STORAGE_KEY) debtEntries = readDebtEntries();
  else return;
  renderHistory();
});

renderHistory();
