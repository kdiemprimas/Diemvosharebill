export const DEBT_STORAGE_KEY = "chia-bill-debt-ledger-v1";

const MAX_DEBT_ENTRIES = 5000;
const MAX_ABSOLUTE_DEBT_AMOUNT = Math.floor(Number.MAX_SAFE_INTEGER / MAX_DEBT_ENTRIES);
const MAX_BILL_PEOPLE = 100;

const cleanText = (value, maxLength = 120) =>
  String(value ?? "").trim().replace(/\s+/g, " ").slice(0, maxLength);

const cleanMoney = (value) => {
  const text = String(value ?? "").trim();
  const number = typeof value === "number"
    ? value
    : (/^[\-−]/.test(text) ? -1 : 1) * Number(text.replace(/\D/g, ""));
  const rounded = Math.round(number);
  return Number.isSafeInteger(rounded) && Math.abs(rounded) <= MAX_ABSOLUTE_DEBT_AMOUNT
    ? rounded
    : 0;
};

export function formatDebtAmountInput(value) {
  const digits = String(value ?? "")
    .replace(/\D/g, "")
    .replace(/^0+(?=\d)/, "")
    .slice(0, 15);
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

export function parseDebtAmountInput(value) {
  return cleanMoney(value);
}

const normalizeNameKey = (value) => cleanText(value, 80).toLocaleLowerCase("vi-VN");

function cleanDate(value) {
  const date = cleanText(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "";
  const parsed = new Date(`${date}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? "" : date;
}

function normalizeDebtEntry(value) {
  if (!value || typeof value !== "object") return null;
  const id = cleanText(value.id, 180);
  const billId = cleanText(value.billId, 100);
  const debtor = cleanText(value.debtor, 80);
  const amount = cleanMoney(value.amount);
  const date = cleanDate(value.date);
  const savedAt = cleanText(value.savedAt, 40);
  if (
    !id || !billId || !debtor || !amount || !date ||
    !savedAt || Number.isNaN(Date.parse(savedAt))
  ) return null;

  return {
    id,
    billId,
    creditor: cleanText(value.creditor, 80) || "Chưa xác định",
    debtor,
    amount,
    date,
    note: cleanText(value.note, 160),
    status: value.status === "paid" ? "paid" : "unpaid",
    savedAt: new Date(savedAt).toISOString(),
  };
}

function sortDebtEntries(left, right) {
  return right.date.localeCompare(left.date) || Date.parse(right.savedAt) - Date.parse(left.savedAt);
}

export function createDebtEntries({
  billId,
  savedAt,
  creditor,
  date,
  note,
  status = "unpaid",
  bill,
}) {
  const cleanBillId = cleanText(billId, 100);
  const cleanCreditor = cleanText(creditor, 80);
  const creditorKey = normalizeNameKey(cleanCreditor);
  if (!cleanBillId || !cleanCreditor || !Array.isArray(bill?.results)) return [];

  return bill.results
    .slice(0, MAX_BILL_PEOPLE)
    .map((person, index) => normalizeDebtEntry({
      id: `${cleanBillId}:${index}`,
      billId: cleanBillId,
      creditor: cleanCreditor,
      debtor: person?.name,
      amount: person?.payable,
      date,
      note,
      status,
      savedAt,
    }))
    .filter((entry) => entry && normalizeNameKey(entry.debtor) !== creditorKey);
}

export function createManualDebtEntry({
  id,
  savedAt,
  creditor,
  debtor,
  amount,
  date,
  note,
  status = "unpaid",
}) {
  const manualId = cleanText(id, 80);
  const cleanCreditor = cleanText(creditor, 80);
  const cleanDebtor = cleanText(debtor, 80);
  if (
    !manualId || !cleanCreditor || !cleanDebtor ||
    normalizeNameKey(cleanCreditor) === normalizeNameKey(cleanDebtor)
  ) return null;

  const entryId = `manual:${manualId}`;
  return normalizeDebtEntry({
    id: entryId,
    billId: entryId,
    creditor: cleanCreditor,
    debtor: cleanDebtor,
    amount,
    date,
    note,
    status,
    savedAt,
  });
}

export function parseDebtEntries(rawValue) {
  try {
    const parsed = JSON.parse(rawValue || "[]");
    if (!Array.isArray(parsed)) return [];
    const seenIds = new Set();
    return parsed
      .map(normalizeDebtEntry)
      .filter(Boolean)
      .sort(sortDebtEntries)
      .filter((entry) => {
        if (seenIds.has(entry.id)) return false;
        seenIds.add(entry.id);
        return true;
      })
      .slice(0, MAX_DEBT_ENTRIES);
  } catch {
    return [];
  }
}

export function readDebtEntries(storage = localStorage) {
  try {
    return parseDebtEntries(storage.getItem(DEBT_STORAGE_KEY));
  } catch {
    return [];
  }
}

export function upsertDebtEntries(storage = localStorage, billId, newEntries = []) {
  const cleanBillId = cleanText(billId, 100);
  if (!cleanBillId) return readDebtEntries(storage);
  const seenIds = new Set();
  const normalizedEntries = newEntries
    .map(normalizeDebtEntry)
    .filter((entry) => {
      if (!entry || seenIds.has(entry.id)) return false;
      seenIds.add(entry.id);
      return true;
    });
  const records = [
    ...normalizedEntries,
    ...readDebtEntries(storage).filter((entry) => entry.billId !== cleanBillId),
  ];
  if (records.length > MAX_DEBT_ENTRIES) throw createDebtCapacityError();
  records.sort(sortDebtEntries);
  storage.setItem(DEBT_STORAGE_KEY, JSON.stringify(records));
  return records;
}

function createDebtCapacityError() {
  const error = new RangeError(`Sổ tiền chia lưu tối đa 5.000 khoản. Hãy xóa bớt dữ liệu trước khi thêm khoản mới.`);
  error.code = "DEBT_LEDGER_CAPACITY_EXCEEDED";
  return error;
}

export function upsertImportedDebtEntries(storage = localStorage, newEntries = []) {
  const seenImportedIds = new Set();
  const normalizedEntries = (Array.isArray(newEntries) ? newEntries : [])
    .map(normalizeDebtEntry)
    .filter((entry) => {
      if (!entry || seenImportedIds.has(entry.id)) return false;
      seenImportedIds.add(entry.id);
      return true;
    });
  if (!normalizedEntries.length) return readDebtEntries(storage);
  const importedIds = new Set(normalizedEntries.map(({ id }) => id));
  const combined = [
    ...normalizedEntries,
    ...readDebtEntries(storage).filter(({ id }) => !importedIds.has(id)),
  ];
  if (combined.length > MAX_DEBT_ENTRIES) throw createDebtCapacityError();
  const records = combined.sort(sortDebtEntries);
  storage.setItem(DEBT_STORAGE_KEY, JSON.stringify(records));
  return records;
}

export function preserveDebtStatuses(newEntries = [], existingEntries = []) {
  const savedStatuses = new Map(
    existingEntries
      .map(normalizeDebtEntry)
      .filter(Boolean)
      .map((entry) => [normalizeNameKey(entry.debtor), entry.status]),
  );
  return newEntries
    .map(normalizeDebtEntry)
    .filter(Boolean)
    .map((entry) => ({
      ...entry,
      status: savedStatuses.get(normalizeNameKey(entry.debtor)) || entry.status,
    }));
}

export function updateDebtStatus(storage = localStorage, entryId, status) {
  const id = cleanText(entryId, 180);
  const nextStatus = status === "paid" ? "paid" : "unpaid";
  const records = readDebtEntries(storage).map((entry) =>
    entry.id === id ? { ...entry, status: nextStatus } : entry,
  );
  storage.setItem(DEBT_STORAGE_KEY, JSON.stringify(records));
  return records;
}

export function updateDebtStatuses(storage = localStorage, entryIds = [], status) {
  const ids = new Set(
    (Array.isArray(entryIds) ? entryIds : [])
      .map((entryId) => cleanText(entryId, 180))
      .filter(Boolean),
  );
  const nextStatus = status === "paid" ? "paid" : "unpaid";
  const records = readDebtEntries(storage).map((entry) =>
    ids.has(entry.id) ? { ...entry, status: nextStatus } : entry,
  );
  storage.setItem(DEBT_STORAGE_KEY, JSON.stringify(records));
  return records;
}

export function removeDebtEntry(storage = localStorage, entryId) {
  const id = cleanText(entryId, 180);
  const records = readDebtEntries(storage).filter((entry) => entry.id !== id);
  storage.setItem(DEBT_STORAGE_KEY, JSON.stringify(records));
  return records;
}

export function removeDebtEntries(storage = localStorage, entryIds = []) {
  const ids = new Set(
    (Array.isArray(entryIds) ? entryIds : [])
      .map((entryId) => cleanText(entryId, 180))
      .filter(Boolean),
  );
  const records = readDebtEntries(storage).filter((entry) => !ids.has(entry.id));
  storage.setItem(DEBT_STORAGE_KEY, JSON.stringify(records));
  return records;
}

export function clearDebtEntries(storage = localStorage) {
  storage.removeItem(DEBT_STORAGE_KEY);
  return [];
}

export function getDebtSummary(entries = []) {
  const people = new Map();
  entries.map(normalizeDebtEntry).filter(Boolean).forEach((entry) => {
    const key = normalizeNameKey(entry.debtor);
    if (!people.has(key)) {
      people.set(key, {
        name: entry.debtor,
        unpaidAmount: 0,
        paidAmount: 0,
        totalAmount: 0,
        unpaidCount: 0,
        billIds: new Set(),
      });
    }
    const summary = people.get(key);
    summary.totalAmount += entry.amount;
    summary.billIds.add(entry.billId);
    if (entry.status === "paid") {
      summary.paidAmount += entry.amount;
    } else {
      summary.unpaidAmount += entry.amount;
      summary.unpaidCount += 1;
    }
  });

  return [...people.values()]
    .map(({ billIds, ...summary }) => ({ ...summary, billCount: billIds.size }))
    .sort((left, right) =>
      right.unpaidAmount - left.unpaidAmount || left.name.localeCompare(right.name, "vi"),
    );
}

export function getDebtOverview(entries = []) {
  const normalizedEntries = entries.map(normalizeDebtEntry).filter(Boolean);
  const overview = normalizedEntries.reduce(
    (overview, entry) => {
      overview.people.add(normalizeNameKey(entry.debtor));
      if (entry.status === "paid") {
        overview.paidAmount += entry.amount;
      } else {
        overview.unpaidAmount += entry.amount;
        overview.unpaidCount += 1;
      }
      return overview;
    },
    { unpaidAmount: 0, paidAmount: 0, unpaidCount: 0, people: new Set() },
  );
  return {
    unpaidAmount: overview.unpaidAmount,
    paidAmount: overview.paidAmount,
    unpaidCount: overview.unpaidCount,
    peopleCount: overview.people.size,
  };
}

export function paginateDebtEntries(entries = [], requestedPage = 1, requestedPageSize = 10) {
  const items = Array.isArray(entries) ? entries : [];
  const pageSize = Number.isInteger(requestedPageSize) && requestedPageSize > 0
    ? Math.min(requestedPageSize, 100)
    : 10;
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

export function getDebtYears(entries = []) {
  const years = new Set(
    (Array.isArray(entries) ? entries : [])
      .map(({ date }) => /^\d{4}-\d{2}-\d{2}$/.test(String(date || "")) ? String(date).slice(0, 4) : "")
      .filter(Boolean),
  );
  return [...years].sort((left, right) => right.localeCompare(left));
}

export function filterDebtEntriesByYear(entries = [], year = "") {
  const items = Array.isArray(entries) ? entries : [];
  const selectedYear = String(year || "").trim();
  if (!selectedYear) return items;
  if (!/^\d{4}$/.test(selectedYear)) return [];
  return items.filter(({ date }) => String(date || "").startsWith(`${selectedYear}-`));
}
