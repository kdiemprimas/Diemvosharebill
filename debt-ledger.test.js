import test from "node:test";
import assert from "node:assert/strict";
import {
  DEBT_STORAGE_KEY,
  createDebtEntries,
  getDebtOverview,
  getDebtSummary,
  parseDebtEntries,
  preserveDebtStatuses,
  removeDebtEntry,
  updateDebtStatus,
  upsertDebtEntries,
} from "./debt-ledger.js";

function createMemoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

const bill = {
  results: [
    { name: "Diem Vo", payable: 38000 },
    { name: "Tin Nguyen", payable: 16000 },
    { name: "Son Vo", payable: 35000 },
  ],
};

test("tạo từng khoản nợ từ kết quả chia và bỏ người đã trả bill", () => {
  const entries = createDebtEntries({
    billId: "bill-1",
    savedAt: "2026-08-20T10:00:00.000Z",
    creditor: "Diem Vo",
    date: "2026-08-20",
    note: "Cơm gà trưa",
    status: "unpaid",
    bill,
  });

  assert.deepEqual(entries, [
    {
      id: "bill-1:1",
      billId: "bill-1",
      creditor: "Diem Vo",
      debtor: "Tin Nguyen",
      amount: 16000,
      date: "2026-08-20",
      note: "Cơm gà trưa",
      status: "unpaid",
      savedAt: "2026-08-20T10:00:00.000Z",
    },
    {
      id: "bill-1:2",
      billId: "bill-1",
      creditor: "Diem Vo",
      debtor: "Son Vo",
      amount: 35000,
      date: "2026-08-20",
      note: "Cơm gà trưa",
      status: "unpaid",
      savedAt: "2026-08-20T10:00:00.000Z",
    },
  ]);
});

test("lưu lại cùng bill sẽ cập nhật thay vì nhân đôi các khoản", () => {
  const storage = createMemoryStorage();
  const first = createDebtEntries({
    billId: "bill-1",
    savedAt: "2026-08-20T10:00:00.000Z",
    creditor: "Diem Vo",
    date: "2026-08-20",
    note: "Bill đầu",
    status: "unpaid",
    bill,
  });
  const updated = createDebtEntries({
    billId: "bill-1",
    savedAt: "2026-08-20T11:00:00.000Z",
    creditor: "Diem Vo",
    date: "2026-08-21",
    note: "Bill đã sửa",
    status: "paid",
    bill: { results: bill.results.slice(0, 2) },
  });

  upsertDebtEntries(storage, "bill-1", first);
  const records = upsertDebtEntries(storage, "bill-1", updated);

  assert.equal(records.length, 1);
  assert.equal(records[0].note, "Bill đã sửa");
  assert.equal(records[0].status, "paid");
  assert.equal(JSON.parse(storage.getItem(DEBT_STORAGE_KEY)).length, 1);
});

test("cập nhật bill vẫn giữ trạng thái đã trả của từng người", () => {
  const existing = parseDebtEntries(JSON.stringify([
    { id: "old-1", billId: "bill-1", creditor: "Diem", debtor: "Tin", amount: 16000, date: "2026-08-20", status: "paid", savedAt: "2026-08-20T10:00:00Z" },
  ]));
  const updated = parseDebtEntries(JSON.stringify([
    { id: "new-1", billId: "bill-1", creditor: "Diem", debtor: "Tin", amount: 18000, date: "2026-08-21", status: "unpaid", savedAt: "2026-08-21T10:00:00Z" },
    { id: "new-2", billId: "bill-1", creditor: "Diem", debtor: "Son", amount: 20000, date: "2026-08-21", status: "unpaid", savedAt: "2026-08-21T10:00:00Z" },
  ]));

  const merged = preserveDebtStatuses(updated, existing);

  assert.equal(merged.find(({ debtor }) => debtor === "Tin").status, "paid");
  assert.equal(merged.find(({ debtor }) => debtor === "Son").status, "unpaid");
});

test("tổng hợp số tiền chưa trả và đã trả theo từng người qua nhiều bill", () => {
  const entries = parseDebtEntries(JSON.stringify([
    { id: "1", billId: "a", creditor: "Diem", debtor: "Tin", amount: 16000, date: "2026-08-18", note: "Trà sữa", status: "unpaid", savedAt: "2026-08-18T10:00:00Z" },
    { id: "2", billId: "b", creditor: "Diem", debtor: "Tin", amount: 35000, date: "2026-08-19", note: "Cơm", status: "paid", savedAt: "2026-08-19T10:00:00Z" },
    { id: "3", billId: "c", creditor: "Diem", debtor: "Son", amount: 38000, date: "2026-08-20", note: "Cà phê", status: "unpaid", savedAt: "2026-08-20T10:00:00Z" },
  ]));

  assert.deepEqual(getDebtSummary(entries), [
    { name: "Son", unpaidAmount: 38000, paidAmount: 0, totalAmount: 38000, unpaidCount: 1, billCount: 1 },
    { name: "Tin", unpaidAmount: 16000, paidAmount: 35000, totalAmount: 51000, unpaidCount: 1, billCount: 2 },
  ]);
});

test("tính riêng tổng tiền đã trả và chưa trả cho phần tổng quan", () => {
  const entries = parseDebtEntries(JSON.stringify([
    { id: "1", billId: "a", creditor: "Diem", debtor: "Tin", amount: 16000, date: "2026-08-18", status: "unpaid", savedAt: "2026-08-18T10:00:00Z" },
    { id: "2", billId: "b", creditor: "Diem", debtor: "Tin", amount: 35000, date: "2026-08-19", status: "paid", savedAt: "2026-08-19T10:00:00Z" },
    { id: "3", billId: "c", creditor: "Diem", debtor: "Son", amount: 38000, date: "2026-08-20", status: "paid", savedAt: "2026-08-20T10:00:00Z" },
  ]));

  assert.deepEqual(getDebtOverview(entries), {
    unpaidAmount: 16000,
    paidAmount: 73000,
    unpaidCount: 1,
    peopleCount: 2,
  });
});

test("đổi trạng thái và xóa đúng một khoản đã lưu", () => {
  const storage = createMemoryStorage();
  const entries = createDebtEntries({
    billId: "bill-1",
    savedAt: "2026-08-20T10:00:00.000Z",
    creditor: "Diem Vo",
    date: "2026-08-20",
    note: "Cơm gà",
    status: "unpaid",
    bill,
  });
  upsertDebtEntries(storage, "bill-1", entries);

  const updated = updateDebtStatus(storage, "bill-1:1", "paid");
  assert.equal(updated.find(({ id }) => id === "bill-1:1").status, "paid");

  const remaining = removeDebtEntry(storage, "bill-1:2");
  assert.deepEqual(remaining.map(({ id }) => id), ["bill-1:1"]);
});

test("lọc dữ liệu hỏng, tiền bằng 0 và chuẩn hóa trạng thái", () => {
  const parsed = parseDebtEntries(JSON.stringify([
    { id: "ok", billId: "bill", creditor: " Diem ", debtor: " Tin ", amount: "12.400", date: "2026-08-20", status: "strange", savedAt: "2026-08-20T10:00:00Z" },
    { id: "zero", billId: "bill", creditor: "Diem", debtor: "Son", amount: 0, date: "2026-08-20", savedAt: "2026-08-20T10:00:00Z" },
    { id: "", amount: 10000 },
  ]));

  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].creditor, "Diem");
  assert.equal(parsed[0].debtor, "Tin");
  assert.equal(parsed[0].amount, 12400);
  assert.equal(parsed[0].status, "unpaid");
});
