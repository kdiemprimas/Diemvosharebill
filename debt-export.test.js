import test from "node:test";
import assert from "node:assert/strict";
import { strFromU8, unzipSync } from "fflate";
import {
  createPersonDebtReport,
  createPersonDebtReportFilename,
  createDebtWorkbook,
  createDebtWorkbookFilename,
  getDebtExportEntries,
} from "./debt-export.js";

test("tạo báo cáo còn nợ của đúng một người và cộng theo từng chủ nợ", () => {
  const entries = [
    { id: "1", creditor: "Diem", debtor: "Tin Nguyen", amount: 16000, date: "2026-08-18", note: "Trà sữa", status: "unpaid" },
    { id: "2", creditor: "Diem", debtor: "tin nguyen", amount: 35000, date: "2026-08-19", note: "Cơm", status: "paid" },
    { id: "3", creditor: "Son", debtor: "Tin Nguyen", amount: 38000, date: "2026-08-20", note: "Vé phim", status: "unpaid" },
    { id: "4", creditor: "Diem", debtor: "Tin Nguyen", amount: 12000, date: "2025-08-20", note: "Cà phê", status: "unpaid" },
    { id: "5", creditor: "Diem", debtor: "An", amount: 50000, date: "2026-08-20", status: "unpaid" },
  ];

  assert.deepEqual(
    createPersonDebtReport(entries, "tin nguyen", "2026", new Date("2026-08-20T10:15:00+07:00")),
    {
      personName: "Tin Nguyen",
      year: "2026",
      generatedDate: "20/08/2026",
      totalUnpaid: 54000,
      totalPaid: 35000,
      unpaidCount: 2,
      entryCount: 3,
      creditors: [
        { name: "Son", amount: 38000, unpaidCount: 1 },
        { name: "Diem", amount: 16000, unpaidCount: 1 },
      ],
    },
  );
});

test("báo cáo cho biết đã trả hết và không được tạo khi chưa chọn người", () => {
  const entries = [
    { creditor: "Diem", debtor: "Tiên Lê", amount: 24250, date: "2026-07-20", status: "paid" },
  ];

  const report = createPersonDebtReport(entries, "TIÊN LÊ", "", new Date("2026-08-20"));
  assert.equal(report.personName, "Tiên Lê");
  assert.equal(report.totalUnpaid, 0);
  assert.equal(report.totalPaid, 24250);
  assert.equal(report.unpaidCount, 0);
  assert.deepEqual(report.creditors, []);
  assert.equal(createPersonDebtReport(entries, "", "", new Date()), null);
  assert.equal(createPersonDebtReport(entries, "không có", "", new Date()), null);
});

test("đặt tên ảnh báo cáo an toàn theo người, phạm vi năm và ngày xuất", () => {
  assert.equal(
    createPersonDebtReportFilename("Tiên Lê Đỗ", "2026", new Date("2026-08-20T10:15:00+07:00")),
    "bao-cao-no-tien-le-do-2026-2026-08-20.png",
  );
  assert.equal(
    createPersonDebtReportFilename("  ", "", new Date("2026-08-20")),
    "bao-cao-no-nguoi-no-tat-ca-2026-08-20.png",
  );
});

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
