import {
  HISTORY_STORAGE_KEY,
  clearHistory as clearStoredHistory,
  readHistory,
  removeHistoryRecord,
} from "./bill-history.js";

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
};

let records = readHistory();
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
  elements.count.textContent = String(records.length);
  elements.empty.hidden = records.length > 0;
  elements.clearButton.hidden = records.length === 0;
  elements.list.innerHTML = records.map(renderHistoryCard).join("");
}

function openDeleteDialog(deleteRequest) {
  pendingDelete = deleteRequest;
  const isClearAll = deleteRequest.type === "all";
  elements.deleteTitle.textContent = isClearAll
    ? "Xóa toàn bộ lịch sử?"
    : `Xóa “${deleteRequest.billName}”?`;
  elements.deleteDescription.textContent = isClearAll
    ? `${records.length} bill đã lưu sẽ bị xóa và không thể khôi phục trên thiết bị này.`
    : "Bill này sẽ bị xóa khỏi lịch sử và không thể khôi phục trên thiết bị này.";
  elements.confirmDelete.textContent = isClearAll ? "Xóa toàn bộ" : "Xóa khỏi lịch sử";

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

elements.confirmDelete.addEventListener("click", () => {
  if (!pendingDelete) return;
  try {
    records = pendingDelete.type === "all"
      ? clearStoredHistory(localStorage)
      : removeHistoryRecord(localStorage, pendingDelete.id);
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
  if (event.key !== HISTORY_STORAGE_KEY) return;
  records = readHistory();
  renderHistory();
});

renderHistory();
