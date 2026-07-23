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
