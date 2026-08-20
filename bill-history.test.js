import test from "node:test";
import assert from "node:assert/strict";
import {
  createHistoryRecord,
  filterHistoryByDateRange,
  isHistoryDateRangeValid,
  paginateHistoryRecords,
  parseHistory,
  removeHistoryRecord,
  upsertHistoryRecord,
} from "./bill-history.js";

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

const state = {
  billName: "Trưa thứ Sáu",
  platform: "GrabFood",
  orderDate: "14:03 · 10/07/2026",
  splitMode: "byItems",
  items: [
    { id: "item-1", name: "Cơm gà", quantity: 1, price: 45000, ownerId: "person-1" },
  ],
};

const bill = {
  subtotal: 45000,
  shippingFee: 15000,
  surcharge: 0,
  discount: 20000,
  total: 40000,
  results: [
    {
      name: "Minh",
      payable: 30000,
      lineItems: [{ name: "Cơm gà", quantity: 1, amount: 45000, shared: false }],
    },
    {
      name: "An",
      payable: 10000,
      lineItems: [],
    },
  ],
};

test("tạo bản ghi lịch sử gọn, đủ tổng tiền và kết quả từng người", () => {
  const record = createHistoryRecord({
    id: "history-1",
    confirmedAt: "2026-07-23T10:00:00.000Z",
    state,
    bill,
  });

  assert.deepEqual(record, {
    id: "history-1",
    confirmedAt: "2026-07-23T10:00:00.000Z",
    billName: "Trưa thứ Sáu",
    platform: "GrabFood",
    orderDate: "14:03 · 10/07/2026",
    splitMode: "byItems",
    itemCount: 1,
    subtotal: 45000,
    shippingFee: 15000,
    surcharge: 0,
    discount: 20000,
    total: 40000,
    people: [
      {
        name: "Minh",
        payable: 30000,
        lineItems: [{ name: "Cơm gà", quantity: 1, amount: 45000, shared: false }],
      },
      { name: "An", payable: 10000, lineItems: [] },
    ],
  });
});

test("xác nhận lại cùng bill sẽ cập nhật một bản ghi thay vì tạo trùng", () => {
  const storage = createMemoryStorage();
  const first = createHistoryRecord({
    id: "history-1",
    confirmedAt: "2026-07-23T10:00:00.000Z",
    state,
    bill,
  });
  const updated = { ...first, confirmedAt: "2026-07-23T11:00:00.000Z", total: 42000 };

  upsertHistoryRecord(storage, first);
  const records = upsertHistoryRecord(storage, updated);

  assert.equal(records.length, 1);
  assert.equal(records[0].total, 42000);
  assert.equal(records[0].confirmedAt, "2026-07-23T11:00:00.000Z");
});

test("bỏ dữ liệu lịch sử bị hỏng và giới hạn tối đa 50 bill mới nhất", () => {
  const records = Array.from({ length: 55 }, (_, index) => ({
    ...createHistoryRecord({
      id: `history-${index}`,
      confirmedAt: new Date(Date.UTC(2026, 6, 23, 0, index)).toISOString(),
      state,
      bill,
    }),
  }));
  const parsed = parseHistory(JSON.stringify([...records, { id: "", total: "sai" }]));

  assert.equal(parsed.length, 50);
  assert.equal(parsed[0].id, "history-54");
  assert.equal(parsed.at(-1).id, "history-5");
});

test("xóa đúng bill được chọn khỏi lịch sử", () => {
  const storage = createMemoryStorage();
  const first = createHistoryRecord({
    id: "history-1",
    confirmedAt: "2026-07-23T10:00:00.000Z",
    state,
    bill,
  });
  const second = { ...first, id: "history-2" };
  upsertHistoryRecord(storage, first);
  upsertHistoryRecord(storage, second);

  const records = removeHistoryRecord(storage, "history-2");

  assert.deepEqual(records.map(({ id }) => id), ["history-1"]);
});

test("lọc bill theo khoảng ngày đặt và tính cả hai ngày biên", () => {
  const records = [
    { id: "history-1", orderDate: "14:03 · 10/07/2026", confirmedAt: "2026-08-20T10:00:00.000Z" },
    { id: "history-2", orderDate: "15/07/2026", confirmedAt: "2026-08-20T10:00:00.000Z" },
    { id: "history-3", orderDate: "20/07/2026", confirmedAt: "2026-08-20T10:00:00.000Z" },
    { id: "history-4", orderDate: "21/07/2026", confirmedAt: "2026-08-20T10:00:00.000Z" },
  ];

  const result = filterHistoryByDateRange(records, "2026-07-10", "2026-07-20");

  assert.deepEqual(result.map(({ id }) => id), ["history-1", "history-2", "history-3"]);
});

test("bill thiếu ngày đặt sẽ được lọc theo ngày đã lưu", () => {
  const records = [
    { id: "history-1", orderDate: "", confirmedAt: "2026-08-20T10:00:00.000Z" },
    { id: "history-2", orderDate: "không rõ", confirmedAt: "2026-08-19T10:00:00.000Z" },
  ];

  const result = filterHistoryByDateRange(records, "2026-08-20", "2026-08-20");

  assert.deepEqual(result.map(({ id }) => id), ["history-1"]);
});

test("phát hiện khoảng ngày có ngày bắt đầu sau ngày kết thúc", () => {
  assert.equal(isHistoryDateRangeValid("2026-08-30", "2026-08-07"), false);
  assert.equal(isHistoryDateRangeValid("2026-08-07", "2026-08-07"), true);
  assert.equal(isHistoryDateRangeValid("2026-08-07", ""), true);
});

test("phân trang lịch sử theo 5 bill mỗi trang", () => {
  const records = Array.from({ length: 12 }, (_, index) => ({ id: `history-${index + 1}` }));

  const result = paginateHistoryRecords(records, 3, 5);

  assert.deepEqual(result.items.map(({ id }) => id), ["history-11", "history-12"]);
  assert.deepEqual(
    { page: result.page, pageCount: result.pageCount, start: result.start, end: result.end, total: result.total },
    { page: 3, pageCount: 3, start: 11, end: 12, total: 12 },
  );
});
