export const HISTORY_STORAGE_KEY = "chia-bill-history-v1";
const MAX_HISTORY_RECORDS = 50;
const MAX_PEOPLE = 100;
const MAX_LINE_ITEMS = 200;

const cleanText = (value, maxLength = 120) =>
  String(value ?? "").trim().slice(0, maxLength);

const cleanMoney = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : 0;
};

function normalizeLineItem(value) {
  if (!value || typeof value !== "object") return null;
  return {
    name: cleanText(value.name, 180) || "Món chưa đặt tên",
    quantity: Math.max(1, Math.min(999, Math.round(Number(value.quantity) || 1))),
    amount: cleanMoney(value.amount),
    shared: Boolean(value.shared),
  };
}

function normalizePerson(value) {
  if (!value || typeof value !== "object") return null;
  return {
    name: cleanText(value.name, 60) || "Chưa đặt tên",
    payable: cleanMoney(value.payable),
    lineItems: Array.isArray(value.lineItems)
      ? value.lineItems
          .slice(0, MAX_LINE_ITEMS)
          .map(normalizeLineItem)
          .filter(Boolean)
      : [],
  };
}

function normalizeRecord(value) {
  if (!value || typeof value !== "object") return null;
  const id = cleanText(value.id, 100);
  const confirmedAt = cleanText(value.confirmedAt, 40);
  if (!id || !confirmedAt || Number.isNaN(Date.parse(confirmedAt))) return null;

  return {
    id,
    confirmedAt: new Date(confirmedAt).toISOString(),
    billName: cleanText(value.billName, 100) || "Bill chưa đặt tên",
    platform: cleanText(value.platform, 40) || "Khác",
    orderDate: cleanText(value.orderDate, 80),
    splitMode: value.splitMode === "equal" ? "equal" : "byItems",
    itemCount: Math.max(0, Math.min(999, Math.round(Number(value.itemCount) || 0))),
    subtotal: cleanMoney(value.subtotal),
    shippingFee: cleanMoney(value.shippingFee),
    surcharge: cleanMoney(value.surcharge),
    discount: cleanMoney(value.discount),
    total: cleanMoney(value.total),
    people: Array.isArray(value.people)
      ? value.people.slice(0, MAX_PEOPLE).map(normalizePerson).filter(Boolean)
      : [],
  };
}

export function createHistoryRecord({ id, confirmedAt, state, bill }) {
  return normalizeRecord({
    id,
    confirmedAt,
    billName: state?.billName,
    platform: state?.platform,
    orderDate: state?.orderDate,
    splitMode: state?.splitMode,
    itemCount: Array.isArray(state?.items) ? state.items.length : 0,
    subtotal: bill?.subtotal,
    shippingFee: bill?.shippingFee,
    surcharge: bill?.surcharge,
    discount: bill?.discount,
    total: bill?.total,
    people: bill?.results,
  });
}

export function parseHistory(rawValue) {
  try {
    const parsed = JSON.parse(rawValue || "[]");
    if (!Array.isArray(parsed)) return [];
    const seenIds = new Set();
    return parsed
      .map(normalizeRecord)
      .filter(Boolean)
      .sort((left, right) => Date.parse(right.confirmedAt) - Date.parse(left.confirmedAt))
      .filter((record) => {
        if (seenIds.has(record.id)) return false;
        seenIds.add(record.id);
        return true;
      })
      .slice(0, MAX_HISTORY_RECORDS);
  } catch {
    return [];
  }
}

export function readHistory(storage = localStorage) {
  try {
    return parseHistory(storage.getItem(HISTORY_STORAGE_KEY));
  } catch {
    return [];
  }
}

export function upsertHistoryRecord(storage = localStorage, record) {
  const normalized = normalizeRecord(record);
  if (!normalized) return readHistory(storage);
  const records = [
    normalized,
    ...readHistory(storage).filter(({ id }) => id !== normalized.id),
  ].slice(0, MAX_HISTORY_RECORDS);
  storage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(records));
  return records;
}

export function removeHistoryRecord(storage = localStorage, recordId) {
  const id = cleanText(recordId, 100);
  const records = readHistory(storage).filter((record) => record.id !== id);
  storage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(records));
  return records;
}

export function clearHistory(storage = localStorage) {
  storage.removeItem(HISTORY_STORAGE_KEY);
  return [];
}

function isValidDateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

export function isHistoryDateRangeValid(fromDate = "", toDate = "") {
  const from = isValidDateKey(fromDate) ? fromDate : "";
  const to = isValidDateKey(toDate) ? toDate : "";
  return !from || !to || from <= to;
}

function getHistoryDateKey(record) {
  const orderDate = cleanText(record?.orderDate, 80);
  const match = orderDate.match(/(?:^|\D)(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})(?:\D|$)/);
  if (match) {
    const dateKey = `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
    if (isValidDateKey(dateKey)) return dateKey;
  }

  const confirmedDate = cleanText(record?.confirmedAt, 40).slice(0, 10);
  return isValidDateKey(confirmedDate) ? confirmedDate : "";
}

export function filterHistoryByDateRange(records = [], fromDate = "", toDate = "") {
  const items = Array.isArray(records) ? records : [];
  const from = isValidDateKey(fromDate) ? fromDate : "";
  const to = isValidDateKey(toDate) ? toDate : "";
  if (!isHistoryDateRangeValid(from, to)) return [];

  return items.filter((record) => {
    const dateKey = getHistoryDateKey(record);
    if (!dateKey) return !from && !to;
    return (!from || dateKey >= from) && (!to || dateKey <= to);
  });
}

export function paginateHistoryRecords(records = [], requestedPage = 1, requestedPageSize = 5) {
  const items = Array.isArray(records) ? records : [];
  const pageSize = Number.isInteger(requestedPageSize) && requestedPageSize > 0
    ? Math.min(requestedPageSize, 50)
    : 5;
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const numericPage = Number.isFinite(Number(requestedPage)) ? Math.trunc(Number(requestedPage)) : 1;
  const page = Math.min(pageCount, Math.max(1, numericPage));
  const startIndex = (page - 1) * pageSize;
  const pageItems = items.slice(startIndex, startIndex + pageSize);

  return {
    items: pageItems,
    page,
    pageCount,
    pageSize,
    start: pageItems.length ? startIndex + 1 : 0,
    end: startIndex + pageItems.length,
    total: items.length,
  };
}
