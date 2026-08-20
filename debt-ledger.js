export const DEBT_STORAGE_KEY = "chia-bill-debt-ledger-v1";

const MAX_DEBT_ENTRIES = 1000;
const MAX_BILL_PEOPLE = 100;

const cleanText = (value, maxLength = 120) =>
  String(value ?? "").trim().replace(/\s+/g, " ").slice(0, maxLength);

const cleanMoney = (value) => {
  const number = typeof value === "number"
    ? value
    : Number(String(value ?? "").replace(/\D/g, ""));
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : 0;
};

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
  const normalizedEntries = newEntries.map(normalizeDebtEntry).filter(Boolean);
  const records = [
    ...normalizedEntries,
    ...readDebtEntries(storage).filter((entry) => entry.billId !== cleanBillId),
  ].sort(sortDebtEntries).slice(0, MAX_DEBT_ENTRIES);
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

export function removeDebtEntry(storage = localStorage, entryId) {
  const id = cleanText(entryId, 180);
  const records = readDebtEntries(storage).filter((entry) => entry.id !== id);
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
