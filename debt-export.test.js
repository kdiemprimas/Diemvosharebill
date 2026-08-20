import test from "node:test";
import assert from "node:assert/strict";
import { strFromU8, unzipSync } from "fflate";
import {
  createDebtWorkbook,
  createDebtWorkbookFilename,
  getDebtExportEntries,
} from "./debt-export.js";

test("xuất toàn bộ khoản khớp bộ lọc thay vì chỉ trang đang xem", () => {
  const entries = [
    { id: "1", creditor: "Diem", debtor: "Tin", amount: 16000, date: "2026-08-18", status: "unpaid" },
    { id: "2", creditor: "Diem", debtor: "Tin", amount: 35000, date: "2025-08-19", status: "paid" },
    { id: "3", creditor: "Diem", debtor: "Son", amount: 38000, date: "2026-08-20", status: "unpaid" },
  ];

  assert.deepEqual(
    getDebtExportEntries(entries, "tin", "2026").map(({ id }) => id),
    ["1"],
  );
  assert.equal(getDebtExportEntries(entries, "", "").length, 3);
});

test("tạo workbook Excel hợp lệ với tiền là số, ngày là ngày và đủ cột", () => {
  const bytes = createDebtWorkbook([
    { creditor: "Bạn & Tôi", debtor: "Lê Tiến", amount: 200000, date: "2026-08-20", note: "Tiền mặt <đã ghi>", status: "unpaid" },
    { creditor: "Diem", debtor: "Tiên Lê", amount: 24250, date: "2026-07-20", note: "Trà thứ Sáu", status: "paid" },
  ]);
  const files = unzipSync(bytes);
  const sheet = strFromU8(files["xl/worksheets/sheet1.xml"]);
  const workbook = strFromU8(files["xl/workbook.xml"]);

  assert.ok(files["[Content_Types].xml"]);
  assert.match(workbook, /name="Sổ tiền chia"/);
  assert.match(sheet, /ref="A1:G3"/);
  assert.match(sheet, /autoFilter ref="A1:G3"/);
  assert.match(sheet, /<c r="D2" s="2"><v>200000<\/v><\/c>/);
  assert.match(sheet, /<c r="E2" s="3"><v>46254<\/v><\/c>/);
  assert.match(sheet, /Bạn &amp; Tôi/);
  assert.match(sheet, /Tiền mặt &lt;đã ghi&gt;/);
  assert.match(sheet, /Chưa trả/);
  assert.match(sheet, /Đã trả/);
});

test("đặt tên file Excel an toàn theo ngày xuất", () => {
  assert.equal(
    createDebtWorkbookFilename(new Date("2026-08-20T10:15:00+07:00")),
    "so-tien-chia-2026-08-20.xlsx",
  );
});

test("workbook vẫn an toàn khi dữ liệu rỗng hoặc có giá trị ngày tiền không hợp lệ", () => {
  const emptyFiles = unzipSync(createDebtWorkbook(null));
  const emptySheet = strFromU8(emptyFiles["xl/worksheets/sheet1.xml"]);
  assert.match(emptySheet, /ref="A1:G1"/);

  const files = unzipSync(createDebtWorkbook([
    { creditor: "A\u0000", debtor: "B", amount: -500, date: "không rõ", note: null, status: "unpaid" },
    { creditor: "C", debtor: "D", amount: "12500", date: "2026-02-30", note: "", status: "paid" },
  ]));
  const sheet = strFromU8(files["xl/worksheets/sheet1.xml"]);
  assert.doesNotMatch(sheet, /\u0000/);
  assert.match(sheet, /<c r="D2" s="2"><v>0<\/v><\/c>/);
  assert.match(sheet, /<c r="E2" s="0" t="inlineStr"/);
  assert.match(sheet, /<c r="E3" s="0" t="inlineStr"/);
  assert.deepEqual(getDebtExportEntries(null, "", ""), []);
  assert.equal(createDebtWorkbookFilename(new Date("không hợp lệ")).endsWith(".xlsx"), true);
});
