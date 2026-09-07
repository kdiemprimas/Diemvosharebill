import test from "node:test";
import assert from "node:assert/strict";
import { strFromU8, unzipSync } from "fflate";
import {
  createPersonDebtReport,
  createPersonDebtReportFilename,
  createDebtWorkbook,
  createDebtWorkbookFilename,
  getDebtExportEntries,
  getDebtReportRows,
  getDebtReportGridLayout,
  getDebtReportPaymentDetails,
  getDebtReportPaymentQrUrl,
  getDebtReportPeriodLabel,
} from "./debt-export.js";

test("QR nhận đúng tổng chưa trả theo người và năm đang xuất", () => {
  const entries = [
    { debtor: "An", amount: 16000, date: "2026-08-18", status: "unpaid" },
    { debtor: "An", amount: 38000, date: "2026-08-19", status: "unpaid" },
    { debtor: "An", amount: 35000, date: "2026-08-19", status: "paid" },
    { debtor: "An", amount: 12000, date: "2025-08-19", status: "unpaid" },
    { debtor: "Bình", amount: 50000, date: "2026-08-19", status: "unpaid" },
  ];
  const report = createPersonDebtReport(entries, "An", "2026");
  const url = new URL(getDebtReportPaymentQrUrl(report));
  assert.equal(url.origin, "https://img.vietqr.io");
  assert.equal(url.pathname, "/image/BIDV-7101574886-qr_only.png");
  assert.equal(url.searchParams.get("amount"), "54000");
  assert.equal(new URL(getDebtReportPaymentQrUrl(createPersonDebtReport(entries, "An"))).searchParams.get("amount"), "66000");
  entries[0].status = "paid";
  assert.equal(new URL(getDebtReportPaymentQrUrl(createPersonDebtReport(entries, "An", "2026"))).searchParams.get("amount"), "38000");
});

test("QR dùng toàn bộ tổng nợ kể cả các dòng đã gộp trên ảnh", () => {
  const report = createPersonDebtReport(Array.from({ length: 35 }, () => ({
    debtor: "An", amount: 1000, date: "2026-08-19", status: "unpaid",
  })), "An");
  assert.equal(new URL(getDebtReportPaymentQrUrl(report)).searchParams.get("amount"), "35000");
});

test("không tạo QR chuyển tiền khi tổng bằng không hoặc âm", () => {
  assert.equal(getDebtReportPaymentQrUrl({ totalUnpaid: 0 }), null);
  assert.equal(getDebtReportPaymentQrUrl({ totalUnpaid: -1000 }), null);
});

test("QR ghi tên con nợ, chủ nợ và ngày xuất ảnh thay vì ngày khoản nợ", () => {
  const report = createPersonDebtReport([
    { debtor: "Đặng An", creditor: "Diễm", amount: 54000, date: "2025-01-01", status: "unpaid" },
    { debtor: "Đặng An", creditor: "Sơn", amount: 10000, date: "2025-01-01", status: "paid" },
  ], "Đặng An", "2025", new Date(2026, 8, 7));
  const url = new URL(getDebtReportPaymentQrUrl(report));
  assert.equal(url.searchParams.get("addInfo"), "Dang An tra no cho Diem ngay 07 09 2026");
  assert.equal(url.searchParams.get("amount"), "54000");
  report.generatedDate = "08/09/2026";
  assert.equal(new URL(getDebtReportPaymentQrUrl(report)).searchParams.get("addInfo"), "Dang An tra no cho Diem ngay 08 09 2026");
});

test("QR ghi các chủ nợ còn phải trả, không gán toàn bộ nợ cho chủ đầu tiên", () => {
  const report = { personName: "An", totalUnpaid: 10000, generatedDate: "07/09/2026",
    creditors: [{ name: "Diễm", amount: 7000 }, { name: "Sơn", amount: 3000 }, { name: "Bình", amount: 0 }] };
  assert.equal(new URL(getDebtReportPaymentQrUrl(report)).searchParams.get("addInfo"), "An tra no cho Diem va Son ngay 07 09 2026");
});

test("nội dung dài được viết gọn nhưng giữ câu trả nợ và ngày xuất", () => {
  const report = { personName: "Nguyễn Thị Hoàng Minh Anh", totalUnpaid: 10000, generatedDate: "07/09/2026",
    creditors: [{ name: "Võ Thị Kiều Diễm", amount: 10000 }] };
  const info = new URL(getDebtReportPaymentQrUrl(report)).searchParams.get("addInfo");
  assert.equal(info, "N T H M Anh tra no cho V T K Diem ngay 07 09 2026");
  assert.ok(info.length <= 50);
  report.creditors = Array.from({ length: 10 }, (_, i) => ({ name: `Chủ nợ ${i}`, amount: 1000 }));
  const many = new URL(getDebtReportPaymentQrUrl(report)).searchParams.get("addInfo");
  assert.ok(many.length <= 50);
  assert.match(many, /tra no cho cac chu no ngay 07 09 2026$/);
});

test("nội dung QR loại ký tự đặc biệt và không để tên dài làm mất ngày", () => {
  const report = { personName: "Đặng & An 💸", totalUnpaid: 10000, generatedDate: "07/09/2026",
    creditors: [{ name: "Diễm / Võ", amount: 10000 }] };
  const info = new URL(getDebtReportPaymentQrUrl(report)).searchParams.get("addInfo");
  assert.equal(info, "Dang An tra no cho Diem Vo ngay 07 09 2026");
  report.personName = "A".repeat(80);
  report.creditors[0].name = "B".repeat(80);
  const long = new URL(getDebtReportPaymentQrUrl(report)).searchParams.get("addInfo");
  assert.equal(long.length, 50);
  assert.match(long, / ngay 07 09 2026$/);
});

test("từ chối số tiền QR không hợp lệ hoặc vượt giới hạn VietQR", () => {
  for (const amount of [NaN, Infinity, 1.5, "54000", undefined, 10000000000000]) {
    assert.throws(() => getDebtReportPaymentQrUrl({ totalUnpaid: amount }), /Số tiền/);
  }
  for (const amount of [1, 9999999999999]) {
    assert.equal(new URL(getDebtReportPaymentQrUrl({ totalUnpaid: amount })).searchParams.get("amount"), String(amount));
  }
});

test("rút gọn ảnh báo cáo bằng hai cột khi có nhiều khoản nợ", () => {
  assert.deepEqual(getDebtReportGridLayout(0), { columns: 1, rows: 0 });
  assert.deepEqual(getDebtReportGridLayout(4), { columns: 1, rows: 4 });
  assert.deepEqual(getDebtReportGridLayout(5), { columns: 2, rows: 3 });
  assert.deepEqual(getDebtReportGridLayout(16), { columns: 2, rows: 8 });
});

test("hiển thị đủ 30 khoản trước khi gộp các khoản còn lại", () => {
  const entries = Array.from({ length: 31 }, (_, index) => ({
    creditor: `Người ${index + 1}`,
    amount: (index + 1) * 1000,
    note: `Khoản ${index + 1}`,
  }));

  assert.equal(getDebtReportRows(entries.slice(0, 30)).length, 30);
  const rows = getDebtReportRows(entries);
  assert.equal(rows.length, 31);
  assert.deepEqual(rows.slice(0, 30), entries.slice(0, 30));
  assert.deepEqual(rows[30], {
    creditor: "Xem trong sổ tiền chia",
    amount: 31000,
    date: "",
    note: "Còn 1 khoản khác",
    isRemainder: true,
  });
});

test("cung cấp đúng thông tin nhận tiền cho ảnh báo cáo", () => {
  assert.deepEqual(getDebtReportPaymentDetails(), {
    bankName: "BIDV",
    accountName: "VÕ THỊ KIỀU DIỄM",
    accountNumber: "7101574886",
    momoNumber: "0974853723",
  });
});

test("dùng câu nhắc vui khi báo cáo không lọc theo năm", () => {
  assert.equal(getDebtReportPeriodLabel(""), "Một là trả tiền, Hai là đi tò");
  assert.equal(getDebtReportPeriodLabel("2026"), "Các khoản trong năm 2026");
});

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
      unpaidEntries: [
        { creditor: "Son", amount: 38000, date: "2026-08-20", note: "Vé phim" },
        { creditor: "Diem", amount: 16000, date: "2026-08-18", note: "Trà sữa" },
      ],
      creditors: [
        { name: "Son", amount: 38000, unpaidCount: 1 },
        { name: "Diem", amount: 16000, unpaidCount: 1 },
      ],
    },
  );
});

test("báo cáo cộng các khoản âm theo đúng dấu", () => {
  const report = createPersonDebtReport([
    { creditor: "Diem", debtor: "Tin", amount: 50000, date: "2026-08-20", status: "unpaid" },
    { creditor: "Diem", debtor: "Tin", amount: -12000, date: "2026-08-21", status: "unpaid" },
    { creditor: "Diem", debtor: "Tin", amount: -5000, date: "2026-08-22", status: "paid" },
  ], "Tin", "2026", new Date("2026-08-25"));

  assert.equal(report.totalUnpaid, 38000);
  assert.equal(report.totalPaid, -5000);
  assert.deepEqual(report.creditors, [
    { name: "Diem", amount: 38000, unpaidCount: 2 },
  ]);
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
  assert.deepEqual(report.unpaidEntries, []);
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
  assert.match(sheet, /<c r="D2" s="2"><v>-500<\/v><\/c>/);
  assert.match(sheet, /<c r="E2" s="0" t="inlineStr"/);
  assert.match(sheet, /<c r="E3" s="0" t="inlineStr"/);
  assert.deepEqual(getDebtExportEntries(null, "", ""), []);
  assert.equal(createDebtWorkbookFilename(new Date("không hợp lệ")).endsWith(".xlsx"), true);
});
