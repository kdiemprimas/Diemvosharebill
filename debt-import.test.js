import test from "node:test";
import assert from "node:assert/strict";
import { strToU8, zipSync } from "fflate";
import { createDebtWorkbook } from "./debt-export.js";
import { DEBT_STORAGE_KEY, upsertImportedDebtEntries } from "./debt-ledger.js";
import {
  createDebtImportDuplicateReview,
  createDebtImportPreview,
  hasDebtImportDuplicateReviewChanged,
  parseDebtWorkbook,
  selectDebtImportEntries,
} from "./debt-import.js";

const SAVED_AT = "2026-08-25T10:00:00.000Z";

function excelSerial(dateKey) {
  return Date.parse(`${dateKey}T00:00:00.000Z`) / 86400000 + 25569;
}

function patchZipOriginalSize(bytes, originalSize) {
  const patched = bytes.slice();
  const view = new DataView(patched.buffer, patched.byteOffset, patched.byteLength);
  for (let offset = 0; offset <= patched.length - 28; offset += 1) {
    const signature = view.getUint32(offset, true);
    if (signature === 0x04034b50) view.setUint32(offset + 22, originalSize, true);
    if (signature === 0x02014b50) view.setUint32(offset + 24, originalSize, true);
  }
  return patched;
}

function createStorage(initialEntries = []) {
  const values = new Map([[DEBT_STORAGE_KEY, JSON.stringify(initialEntries)]]);
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

test("đọc đúng format Excel mẫu và chuẩn hóa dữ liệu để review", () => {
  const preview = createDebtImportPreview([
    ["STT", "Chủ Nợ", "Con Nợ", "Tiền", "NGÀY", "GHI CHÚ", "STATUS"],
    [1, "Diem Vo", "Son Vo", 38000, excelSerial("2024-05-09"), "cơm gà", ""],
    [2, "Diem Vo", "Tin Nguyen", "16,000", "11/13/2024", "trà sữa", "Đã Trả"],
  ], { sourceKey: "file-abc", savedAt: SAVED_AT });

  assert.equal(preview.fatalErrors.length, 0);
  assert.equal(preview.totalCount, 2);
  assert.equal(preview.validCount, 2);
  assert.equal(preview.errorCount, 0);
  assert.match(preview.entries[0].id, /^import:[a-f0-9]{16}:1$/);
  assert.equal(preview.entries[0].billId, preview.entries[0].id);
  assert.equal(preview.entries[1].billId, preview.entries[1].id);
  assert.deepEqual(preview.entries.map(({ id, billId, ...entry }) => entry), [
    {
      creditor: "Diem Vo",
      debtor: "Son Vo",
      amount: 38000,
      date: "2024-05-09",
      note: "cơm gà",
      status: "unpaid",
      savedAt: SAVED_AT,
    },
    {
      creditor: "Diem Vo",
      debtor: "Tin Nguyen",
      amount: 16000,
      date: "2024-11-13",
      note: "trà sữa",
      status: "paid",
      savedAt: SAVED_AT,
    },
  ]);
});

test("chấp nhận tên cột Trạng thái do ứng dụng xuất ra", () => {
  const preview = createDebtImportPreview([
    ["STT", "Chủ nợ", "Con nợ", "Tiền", "Ngày", "Ghi chú", "Trạng thái"],
    [1, "Diem", "Tin", 25000, "2026-08-20", "Cà phê", "Chưa trả"],
  ], { sourceKey: "exported", savedAt: SAVED_AT });

  assert.equal(preview.validCount, 1);
  assert.equal(preview.entries[0].status, "unpaid");
});

test("giữ đúng ngày khi ô Excel có kèm phần giờ", () => {
  const preview = createDebtImportPreview([
    ["Chủ nợ", "Con nợ", "Tiền", "Ngày"],
    ["Diem", "Tin", 25000, excelSerial("2026-08-20") + 0.75],
  ], { sourceKey: "date-time", savedAt: SAVED_AT });

  assert.equal(preview.entries[0].date, "2026-08-20");
});

test("tạo mã ổn định theo nội dung dù file được Excel lưu lại", () => {
  const rows = [
    ["Chủ nợ", "Con nợ", "Tiền", "Ngày", "Ghi chú", "STATUS"],
    ["Diem", "Tin", 25000, "2026-08-20", "Bữa trưa", "Chưa trả"],
  ];
  const first = createDebtImportPreview(rows, { sourceKey: "zip-a", savedAt: SAVED_AT });
  const resaved = createDebtImportPreview(rows, { sourceKey: "zip-b", savedAt: SAVED_AT });

  assert.equal(first.entries[0].id, resaved.entries[0].id);
});

test("đánh dấu dữ liệu trùng chính xác với khoản đã có trong sổ", () => {
  const preview = createDebtImportPreview([
    ["Chủ nợ", "Con nợ", "Tiền", "Ngày", "Ghi chú", "Trạng thái"],
    [" Diem Vo ", "Tin Nguyen", 25000, "2026-08-20", "Bữa trưa", "Đã trả"],
    ["Diem Vo", "Son Vo", 18000, "2026-08-21", "Cà phê", "Chưa trả"],
  ], { savedAt: SAVED_AT });
  const review = createDebtImportDuplicateReview(preview, [{
    id: "manual-existing",
    billId: "manual-existing",
    creditor: "diem vo",
    debtor: "tin nguyen",
    amount: 25000,
    date: "2026-08-20",
    note: "Bữa trưa",
    status: "paid",
    savedAt: "2026-08-20T08:00:00.000Z",
  }]);

  assert.equal(review.duplicateCount, 1);
  assert.equal(review.newCount, 1);
  assert.equal(review.rows[0].isDuplicate, true);
  assert.equal(review.rows[1].isDuplicate, false);
});

test("trạng thái khác thì không xem là dữ liệu trùng hoàn toàn", () => {
  const preview = createDebtImportPreview([
    ["Chủ nợ", "Con nợ", "Tiền", "Ngày", "Ghi chú", "Trạng thái"],
    ["Diem", "Tin", 25000, "2026-08-20", "Bữa trưa", "Đã trả"],
  ], { savedAt: SAVED_AT });
  const review = createDebtImportDuplicateReview(preview, [{
    ...preview.entries[0],
    id: "existing-unpaid",
    billId: "existing-unpaid",
    status: "unpaid",
  }]);

  assert.equal(review.duplicateCount, 0);
  assert.equal(review.newCount, 1);
});

test("đối chiếu dòng trùng theo số lượng bản ghi đã có", () => {
  const preview = createDebtImportPreview([
    ["Chủ nợ", "Con nợ", "Tiền", "Ngày"],
    ["Diem", "Tin", 25000, "2026-08-20"],
    ["Diem", "Tin", 25000, "2026-08-20"],
  ], { savedAt: SAVED_AT });
  const review = createDebtImportDuplicateReview(preview, [{
    ...preview.entries[0],
    id: "existing-copy",
    billId: "existing-copy",
  }]);

  assert.equal(review.duplicateCount, 1);
  assert.equal(review.newCount, 1);
  assert.deepEqual(review.rows.map(({ isDuplicate }) => isDuplicate), [true, false]);
});

test("cho phép bỏ qua dòng trùng hoặc nhập thêm thành bản ghi mới", () => {
  const preview = createDebtImportPreview([
    ["Chủ nợ", "Con nợ", "Tiền", "Ngày"],
    ["Diem", "Tin", 25000, "2026-08-20"],
    ["Diem", "Son", 18000, "2026-08-21"],
  ], { savedAt: SAVED_AT });
  const review = createDebtImportDuplicateReview(preview, [{
    ...preview.entries[0],
    id: "existing-copy",
    billId: "existing-copy",
  }]);

  const skipped = selectDebtImportEntries(review, "skip");
  const added = selectDebtImportEntries(review, "add", () => "fixed-token");

  assert.deepEqual(skipped.map(({ debtor }) => debtor), ["Son"]);
  assert.equal(added.length, 2);
  assert.equal(added[0].id, "import-copy:fixed-token:1");
  assert.equal(added[0].billId, added[0].id);
  assert.notEqual(added[0], preview.entries[0]);
  assert.equal(preview.entries[0].id.startsWith("import:"), true);
});

test("không ghi đè khoản cùng mã khi trạng thái trong file đã thay đổi", () => {
  const preview = createDebtImportPreview([
    ["Chủ nợ", "Con nợ", "Tiền", "Ngày", "Trạng thái"],
    ["Diem", "Tin", 25000, "2026-08-20", "Đã trả"],
  ], { savedAt: SAVED_AT });
  const existing = { ...preview.entries[0], status: "unpaid", savedAt: "2026-08-20T08:00:00.000Z" };
  const review = createDebtImportDuplicateReview(preview, [existing]);

  const selected = selectDebtImportEntries(review, "skip", () => "status-copy");
  const stored = upsertImportedDebtEntries(createStorage([existing]), selected);

  assert.equal(review.duplicateCount, 0);
  assert.notEqual(selected[0].id, existing.id);
  assert.equal(stored.length, 2);
  assert.deepEqual(new Set(stored.map(({ status }) => status)), new Set(["paid", "unpaid"]));
});

test("giữ đúng số bản khi mã occurrence trong sổ bị khuyết", () => {
  const preview = createDebtImportPreview([
    ["Chủ nợ", "Con nợ", "Tiền", "Ngày"],
    ["Diem", "Tin", 25000, "2026-08-20"],
    ["Diem", "Tin", 25000, "2026-08-20"],
  ], { savedAt: SAVED_AT });
  const existing = preview.entries[1];
  const review = createDebtImportDuplicateReview(preview, [existing]);

  const selected = selectDebtImportEntries(review, "skip", () => "gap-copy");
  const stored = upsertImportedDebtEntries(createStorage([existing]), selected);

  assert.equal(review.duplicateCount, 1);
  assert.equal(selected.length, 1);
  assert.notEqual(selected[0].id, existing.id);
  assert.equal(stored.length, 2);
});

test("phát hiện khi trạng thái dòng trùng thay đổi trong lúc đang review", () => {
  const preview = createDebtImportPreview([
    ["Chủ nợ", "Con nợ", "Tiền", "Ngày"],
    ["Diem", "Tin", 25000, "2026-08-20"],
    ["Diem", "Son", 18000, "2026-08-21"],
  ], { savedAt: SAVED_AT });
  const before = createDebtImportDuplicateReview(preview, []);
  const unchanged = createDebtImportDuplicateReview(preview, []);
  const after = createDebtImportDuplicateReview(preview, [preview.entries[1]]);

  assert.equal(hasDebtImportDuplicateReviewChanged(before, unchanged), false);
  assert.equal(hasDebtImportDuplicateReviewChanged(before, after), true);
});

test("hỗ trợ các tên cột tương đương và kiểu ngày phổ biến", () => {
  const preview = createDebtImportPreview([
    ["Số thứ tự", "Người ứng", "Người nợ", "Số tiền", "Date", "Nội dung", "Trạng thái"],
    [1, "Diem", "Tin", "25.000 ₫", new Date(2026, 7, 20), "Bữa trưa", "Đã thanh toán"],
    [2, "Diem", "Son", "18,000", "20/08/2026", "Cà phê", "unpaid"],
  ], { sourceKey: "aliases", savedAt: SAVED_AT });

  assert.equal(preview.validCount, 2);
  assert.deepEqual(preview.entries.map(({ date, amount, status }) => ({ date, amount, status })), [
    { date: "2026-08-20", amount: 25000, status: "paid" },
    { date: "2026-08-20", amount: 18000, status: "unpaid" },
  ]);
});

test("chấp nhận số tiền âm từ ô số và chuỗi có dấu trừ", () => {
  const preview = createDebtImportPreview([
    ["Chủ nợ", "Con nợ", "Tiền", "Ngày"],
    ["Diem", "Tin", -124000, "2026-08-20"],
    ["Diem", "Son", "- 38.000 ₫", "2026-08-21"],
  ], { sourceKey: "negative-amounts", savedAt: SAVED_AT });

  assert.equal(preview.validCount, 2);
  assert.equal(preview.errorCount, 0);
  assert.deepEqual(preview.entries.map(({ amount }) => amount), [-124000, -38000]);
});

test("từ chối số tiền quá lớn có thể làm tổng mất chính xác", () => {
  const preview = createDebtImportPreview([
    ["Chủ nợ", "Con nợ", "Tiền", "Ngày"],
    ["Diem", "Tin", Number.MAX_SAFE_INTEGER, "2026-08-20"],
    ["Diem", "Son", -Number.MAX_SAFE_INTEGER, "2026-08-21"],
  ], { sourceKey: "unsafe-totals", savedAt: SAVED_AT });

  assert.equal(preview.validCount, 0);
  assert.equal(preview.errorCount, 2);
  assert.match(preview.rows[0].errors.join(" "), /vượt quá/i);
  assert.match(preview.rows[1].errors.join(" "), /vượt quá/i);
});

test("báo lỗi cho file rỗng và file vượt giới hạn 5000 dòng", () => {
  const empty = createDebtImportPreview([], { sourceKey: "empty", savedAt: SAVED_AT });
  assert.match(empty.fatalErrors.join(" "), /không có dữ liệu/i);

  const oversized = createDebtImportPreview([
    ["Chủ nợ", "Con nợ", "Tiền", "Ngày"],
    ...Array.from({ length: 5001 }, () => ["Diem", "Tin", 10000, "2026-08-20"]),
  ], { sourceKey: "large", savedAt: SAVED_AT });
  assert.equal(oversized.totalCount, 5001);
  assert.match(oversized.fatalErrors.join(" "), /tối đa 5000/i);
});

test("báo lỗi rõ từng dòng và không đưa dòng lỗi vào danh sách sẽ nhập", () => {
  const preview = createDebtImportPreview([
    ["STT", "Chủ Nợ", "Con Nợ", "Tiền", "NGÀY", "GHI CHÚ", "STATUS"],
    [1, "Diem", "Diem", 38000, "2024-05-09", "trùng người", ""],
    [2, "Diem", "Tin", 0, "2024-05-09", "không có tiền", ""],
    [3, "Diem", "Tin", 12000, "không phải ngày", "sai ngày", ""],
    [4, "Diem", "Tin", 12000, "2024-05-09", "sai trạng thái", "đang chờ"],
    [],
  ], { sourceKey: "invalid", savedAt: SAVED_AT });

  assert.equal(preview.totalCount, 4);
  assert.equal(preview.validCount, 0);
  assert.equal(preview.errorCount, 4);
  assert.equal(preview.entries.length, 0);
  assert.match(preview.rows[0].errors.join(" "), /khác nhau/i);
  assert.match(preview.rows[1].errors.join(" "), /khác 0/i);
  assert.match(preview.rows[2].errors.join(" "), /ngày/i);
  assert.match(preview.rows[3].errors.join(" "), /trạng thái/i);
});

test("dừng review khi file thiếu cột bắt buộc", () => {
  const preview = createDebtImportPreview([
    ["STT", "Con Nợ", "Tiền", "NGÀY"],
    [1, "Tin", 12000, "2026-08-20"],
  ], { sourceKey: "missing", savedAt: SAVED_AT });

  assert.equal(preview.totalCount, 0);
  assert.equal(preview.validCount, 0);
  assert.match(preview.fatalErrors.join(" "), /Chủ nợ/);
});

test("dừng review khi có hai cột cùng ý nghĩa", () => {
  const preview = createDebtImportPreview([
    ["Chủ nợ", "Con nợ", "Tiền", "Số tiền", "Ngày"],
    ["Diem", "Tin", 12000, 13000, "2026-08-20"],
  ], { sourceKey: "duplicate-header", savedAt: SAVED_AT });

  assert.equal(preview.validCount, 0);
  assert.match(preview.fatalErrors.join(" "), /cột.*lặp.*Tiền|trùng/i);
});

test("đọc lại được chính file xlsx mà ứng dụng xuất", () => {
  const workbook = createDebtWorkbook([
    {
      id: "entry-1",
      billId: "bill-1",
      creditor: "Diem Vo",
      debtor: "Tin Nguyen",
      amount: 35000,
      date: "2025-07-28",
      note: "cơm gà",
      status: "paid",
      savedAt: SAVED_AT,
    },
    {
      id: "entry-2",
      billId: "bill-2",
      creditor: "Diem Vo",
      debtor: "Son Vo",
      amount: -12000,
      date: "2025-07-29",
      note: "hoàn tiền",
      status: "unpaid",
      savedAt: SAVED_AT,
    },
  ]);

  const rows = parseDebtWorkbook(workbook);
  const preview = createDebtImportPreview(rows, {
    sourceKey: "round-trip",
    savedAt: SAVED_AT,
  });

  assert.equal(preview.validCount, 2);
  assert.deepEqual(
    preview.entries.map(({ creditor, debtor, amount, date, note, status }) => ({
      creditor, debtor, amount, date, note, status,
    })),
    [
      {
        creditor: "Diem Vo",
        debtor: "Tin Nguyen",
        amount: 35000,
        date: "2025-07-28",
        note: "cơm gà",
        status: "paid",
      },
      {
        creditor: "Diem Vo",
        debtor: "Son Vo",
        amount: -12000,
        date: "2025-07-29",
        note: "hoàn tiền",
        status: "unpaid",
      },
    ],
  );
});

test("đọc workbook dùng shared strings như file Excel thông thường", () => {
  const sharedStrings = ["Chủ Nợ", "Con Nợ", "Tiền", "NGÀY", "STATUS", "Diem", "Tin", "Đã Trả"];
  const sharedXml = `<?xml version="1.0"?><sst>${sharedStrings.map((value) => `<si><t>${value}</t></si>`).join("")}</sst>`;
  const sheetXml = `<?xml version="1.0"?><worksheet><sheetData>
    <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c><c r="E1" t="s"><v>4</v></c></row>
    <row r="2"><c r="A2" t="s"><v>5</v></c><c r="B2" t="s"><v>6</v></c><c r="C2"><v>32000</v></c><c r="D2"><v>${excelSerial("2026-08-20")}</v></c><c r="E2" t="s"><v>7</v></c></row>
  </sheetData></worksheet>`;
  const workbook = zipSync({
    "xl/worksheets/sheet1.xml": strToU8(sheetXml),
    "xl/sharedStrings.xml": strToU8(sharedXml),
  });

  const preview = createDebtImportPreview(parseDebtWorkbook(workbook), {
    sourceKey: "shared",
    savedAt: SAVED_AT,
  });

  assert.equal(preview.validCount, 1);
  assert.equal(preview.entries[0].status, "paid");
  assert.equal(preview.entries[0].amount, 32000);
});

test("bỏ qua hàng triệu ô trống có style thay vì coi workbook là quá lớn", () => {
  const styledBlankRows = Array.from({ length: 12000 }, (_, index) => (
    `<row r="${index + 3}" customFormat="${"x".repeat(700)}"><c r="B${index + 3}" s="25"/><c r="C${index + 3}" s="25"/></row>`
  )).join("");
  const workbook = zipSync({
    "xl/worksheets/sheet1.xml": strToU8(`<?xml version="1.0"?><worksheet><sheetData>
      <row r="1"><c r="A1" t="inlineStr"><is><t>Chủ nợ</t></is></c><c r="B1" t="inlineStr"><is><t>Con nợ</t></is></c><c r="C1" t="inlineStr"><is><t>Tiền</t></is></c><c r="D1" t="inlineStr"><is><t>Ngày</t></is></c></row>
      <row r="2"><c r="A2" t="inlineStr"><is><t>Diem</t></is></c><c r="B2" t="inlineStr"><is><t>Tin</t></is></c><c r="C2"><v>32000</v></c><c r="D2" t="inlineStr"><is><t>2026-08-20</t></is></c></row>
      ${styledBlankRows}
    </sheetData></worksheet>`),
  }, { level: 9 });

  const preview = createDebtImportPreview(parseDebtWorkbook(workbook), {
    sourceKey: "styled-blanks",
    savedAt: SAVED_AT,
  });

  assert.equal(preview.validCount, 1);
  assert.equal(preview.entries[0].amount, 32000);
});

test("cho phép 5000 dòng dữ liệu nằm thưa trong giới hạn dòng của Excel", () => {
  const dataRows = Array.from({ length: 5000 }, (_, index) => {
    const rowNumber = (index + 1) * 3;
    return `<row r="${rowNumber}"><c r="A${rowNumber}" t="inlineStr"><is><t>Diem</t></is></c><c r="B${rowNumber}" t="inlineStr"><is><t>Tin</t></is></c><c r="C${rowNumber}"><v>10000</v></c><c r="D${rowNumber}" t="inlineStr"><is><t>2026-08-20</t></is></c></row>`;
  }).join("");
  const workbook = zipSync({
    "xl/worksheets/sheet1.xml": strToU8(`<?xml version="1.0"?><worksheet><sheetData>
      <row r="1"><c r="A1" t="inlineStr"><is><t>Chủ nợ</t></is></c><c r="B1" t="inlineStr"><is><t>Con nợ</t></is></c><c r="C1" t="inlineStr"><is><t>Tiền</t></is></c><c r="D1" t="inlineStr"><is><t>Ngày</t></is></c></row>
      ${dataRows}
    </sheetData></worksheet>`),
  }, { level: 9 });

  const preview = createDebtImportPreview(parseDebtWorkbook(workbook), {
    sourceKey: "sparse-rows",
    savedAt: SAVED_AT,
  });

  assert.equal(preview.totalCount, 5000);
  assert.equal(preview.validCount, 5000);
  assert.equal(preview.rows.at(-1).rowNumber, 15000);
});

test("đọc đúng ngày từ workbook dùng hệ ngày 1904", () => {
  const date1904Serial = Date.parse("2026-08-20T00:00:00.000Z") / 86400000 + 24107;
  const workbook = zipSync({
    "xl/workbook.xml": strToU8('<?xml version="1.0"?><workbook><workbookPr date1904="1"/><sheets><sheet r:id="rId1"/></sheets></workbook>'),
    "xl/_rels/workbook.xml.rels": strToU8('<?xml version="1.0"?><Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
    "xl/worksheets/sheet1.xml": strToU8(`<?xml version="1.0"?><worksheet><sheetData>
      <row r="1"><c r="A1" t="inlineStr"><is><t>Chủ nợ</t></is></c><c r="B1" t="inlineStr"><is><t>Con nợ</t></is></c><c r="C1" t="inlineStr"><is><t>Tiền</t></is></c><c r="D1" t="inlineStr"><is><t>Ngày</t></is></c></row>
      <row r="2"><c r="A2" t="inlineStr"><is><t>Diem</t></is></c><c r="B2" t="inlineStr"><is><t>Tin</t></is></c><c r="C2"><v>32000</v></c><c r="D2"><v>${date1904Serial}</v></c></row>
    </sheetData></worksheet>`),
  });

  const rows = parseDebtWorkbook(workbook);
  const preview = createDebtImportPreview(rows, { sourceKey: "mac", savedAt: SAVED_AT });

  assert.equal(preview.entries[0].date, "2026-08-20");
});

test("từ chối worksheet khai báo số dòng cực lớn", () => {
  const workbook = zipSync({
    "xl/worksheets/sheet1.xml": strToU8('<?xml version="1.0"?><worksheet><sheetData><row r="1000000000"><c r="A1000000000" t="inlineStr"><is><t>x</t></is></c></row></sheetData></worksheet>'),
  });

  assert.throws(() => parseDebtWorkbook(workbook), /Excel|xlsx/i);
});

test("bỏ qua dòng tự đóng và từ chối dòng XML chưa đóng", () => {
  const validWorkbook = zipSync({
    "xl/worksheets/sheet1.xml": strToU8(`<?xml version="1.0"?><worksheet><sheetData>
      <row r="1"><c r="A1" t="inlineStr"><is><t>Chủ nợ</t></is></c></row>
      <row r="2"/>
    </sheetData></worksheet>`),
  });
  assert.deepEqual(parseDebtWorkbook(validWorkbook), [["Chủ nợ"]]);

  const malformedWorkbook = zipSync({
    "xl/worksheets/sheet1.xml": strToU8('<?xml version="1.0"?><worksheet><sheetData><row r="1"><c r="A1"><v>1</v></c></sheetData></worksheet>'),
  });
  assert.throws(() => parseDebtWorkbook(malformedWorkbook), /Excel|xlsx/i);
});

test("từ chối worksheet bị thiếu thẻ đóng dù các dòng dữ liệu đã đủ", () => {
  const workbook = zipSync({
    "xl/worksheets/sheet1.xml": strToU8('<?xml version="1.0"?><worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Chủ nợ</t></is></c></row>'),
  });

  assert.throws(() => parseDebtWorkbook(workbook), /Excel|xlsx/i);
});

test("từ chối archive không chứa worksheet mặc định", () => {
  const workbook = zipSync({
    "xl/worksheets/other.xml": strToU8('<?xml version="1.0"?><worksheet><sheetData/></worksheet>'),
  });

  assert.throws(() => parseDebtWorkbook(workbook), /Excel|xlsx/i);
});

test("từ chối nội dung không phải workbook xlsx", () => {
  assert.throws(
    () => parseDebtWorkbook(new TextEncoder().encode("not an xlsx file")),
    /Excel|xlsx/i,
  );
});

test("từ chối workbook có nội dung giải nén vượt giới hạn an toàn", () => {
  const oversizedWorkbook = patchZipOriginalSize(zipSync({
    "xl/worksheets/sheet1.xml": strToU8(`<worksheet><sheetData><row r="1"><c r="A1"><v>${"1".repeat(8 * 1024 * 1024 + 1)}</v></c></row></sheetData></worksheet>`),
  }, { level: 9 }), 1);

  assert.throws(() => parseDebtWorkbook(oversizedWorkbook), /Excel|xlsx/i);
});

test("từ chối shared strings quá lớn dù metadata ZIP khai báo sai", () => {
  const workbook = patchZipOriginalSize(zipSync({
    "xl/sharedStrings.xml": strToU8(`<sst><si><t>${"x".repeat(8 * 1024 * 1024 + 1)}</t></si></sst>`),
    "xl/worksheets/sheet1.xml": strToU8('<?xml version="1.0"?><worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Chủ nợ</t></is></c></row></sheetData></worksheet>'),
  }, { level: 9 }), 1);

  assert.throws(() => parseDebtWorkbook(workbook), /Excel|xlsx/i);
});
