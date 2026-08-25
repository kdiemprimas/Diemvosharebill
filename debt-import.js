import { strFromU8, unzipSync } from "fflate";

const REQUIRED_COLUMNS = ["creditor", "debtor", "amount", "date"];
const COLUMN_LABELS = {
  creditor: "Chủ nợ",
  debtor: "Con nợ",
  amount: "Tiền",
  date: "Ngày",
};
const MAX_IMPORT_ROWS = 1000;
const MAX_COMPRESSED_WORKBOOK_BYTES = 10 * 1024 * 1024;
const MAX_UNCOMPRESSED_WORKBOOK_BYTES = 8 * 1024 * 1024;
const MAX_WORKSHEET_ROW_NUMBER = 10000;
const MAX_WORKSHEET_COLUMN_INDEX = 255;
const EXCEL_EPOCH_OFFSET = 25569;
const EXCEL_1904_EPOCH_OFFSET = 24107;
const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;

function cleanText(value, maxLength = 160) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function normalizeKey(value) {
  return cleanText(value, 80)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLocaleLowerCase("vi-VN")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function getColumnName(value) {
  const key = normalizeKey(value).replace(/\s+/g, "");
  if (key === "stt" || key === "sothutu") return "index";
  if (["chuno", "creditor", "nguoiung"].includes(key)) return "creditor";
  if (["conno", "nguoino", "debtor"].includes(key)) return "debtor";
  if (["tien", "sotien", "amount"].includes(key)) return "amount";
  if (["ngay", "date"].includes(key)) return "date";
  if (["ghichu", "note", "noidung"].includes(key)) return "note";
  if (["status", "trangthai"].includes(key)) return "status";
  return "";
}

function parseAmount(value) {
  if (typeof value === "number") return Number.isFinite(value) ? Math.round(value) : 0;
  const text = cleanText(value, 40);
  if (!text || /^-/.test(text)) return 0;
  const digits = text.replace(/\D/g, "");
  return digits ? Number(digits) : 0;
}

function isValidDateParts(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function formatDateParts(year, month, day) {
  if (!isValidDateParts(year, month, day)) return "";
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseDate(value, date1904 = false) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return formatDateParts(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const epochOffset = date1904 ? EXCEL_1904_EPOCH_OFFSET : EXCEL_EPOCH_OFFSET;
    const timestamp = Math.floor(value - epochOffset) * DAY_IN_MILLISECONDS;
    const date = new Date(timestamp);
    return formatDateParts(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  }

  const text = cleanText(value, 40);
  const isoMatch = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (isoMatch) return formatDateParts(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));

  const localMatch = text.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/);
  if (!localMatch) return "";
  const first = Number(localMatch[1]);
  const second = Number(localMatch[2]);
  const year = Number(localMatch[3]);
  // File mẫu hiển thị theo tháng/ngày/năm. Khi số đầu > 12, tự hiểu là ngày/tháng/năm.
  const month = first > 12 ? second : first;
  const day = first > 12 ? first : second;
  return formatDateParts(year, month, day);
}

function parseStatus(value) {
  const key = normalizeKey(value).replace(/\s+/g, "");
  if (!key || ["chuatra", "unpaid", "no", "chuathanhtoan"].includes(key)) return "unpaid";
  if (["datra", "paid", "dathanhtoan"].includes(key)) return "paid";
  return "";
}

function isBlankRow(row) {
  return !Array.isArray(row) || row.every((cell) => cleanText(cell) === "");
}

function createColumnMap(headers) {
  const columns = {};
  const duplicates = new Set();
  headers.forEach((header, index) => {
    const name = getColumnName(header);
    if (!name) return;
    if (columns[name] === undefined) columns[name] = index;
    else duplicates.add(name);
  });
  return { columns, duplicates: [...duplicates] };
}

function getCell(row, columns, name) {
  return columns[name] === undefined ? "" : row[columns[name]];
}

export function createDebtImportPreview(rows = [], options = {}) {
  const workbookRows = Array.isArray(rows) ? rows : [];
  const headerIndex = workbookRows.findIndex((row) => !isBlankRow(row));
  if (headerIndex < 0) {
    return { rows: [], entries: [], totalCount: 0, validCount: 0, errorCount: 0, fatalErrors: ["File Excel không có dữ liệu."] };
  }

  const { columns, duplicates } = createColumnMap(workbookRows[headerIndex]);
  if (duplicates.length) {
    return {
      rows: [],
      entries: [],
      totalCount: 0,
      validCount: 0,
      errorCount: 0,
      fatalErrors: [`Các cột sau đang bị lặp: ${duplicates.map((name) => COLUMN_LABELS[name] || name).join(", ")}.`],
    };
  }
  const missing = REQUIRED_COLUMNS.filter((name) => columns[name] === undefined);
  if (missing.length) {
    return {
      rows: [],
      entries: [],
      totalCount: 0,
      validCount: 0,
      errorCount: 0,
      fatalErrors: [`Thiếu cột bắt buộc: ${missing.map((name) => COLUMN_LABELS[name]).join(", ")}.`],
    };
  }

  const dataRows = workbookRows
    .map((row, index) => ({ row, rowNumber: index + 1 }))
    .slice(headerIndex + 1)
    .filter(({ row }) => !isBlankRow(row));
  if (dataRows.length > MAX_IMPORT_ROWS) {
    return {
      rows: [],
      entries: [],
      totalCount: dataRows.length,
      validCount: 0,
      errorCount: dataRows.length,
      fatalErrors: [`File có ${dataRows.length} dòng. Mỗi lần chỉ nhập tối đa ${MAX_IMPORT_ROWS} dòng.`],
    };
  }

  const savedAt = !Number.isNaN(Date.parse(options.savedAt))
    ? new Date(options.savedAt).toISOString()
    : new Date().toISOString();
  const date1904 = workbookRows.date1904 === true;
  const identityCounts = new Map();
  const previewRows = dataRows.map(({ row, rowNumber }) => {
    const creditor = cleanText(getCell(row, columns, "creditor"), 80);
    const debtor = cleanText(getCell(row, columns, "debtor"), 80);
    const amount = parseAmount(getCell(row, columns, "amount"));
    const date = parseDate(getCell(row, columns, "date"), date1904);
    const note = cleanText(getCell(row, columns, "note"), 160);
    const rawStatus = getCell(row, columns, "status");
    const status = parseStatus(rawStatus);
    const errors = [];

    if (!creditor) errors.push("Thiếu chủ nợ.");
    if (!debtor) errors.push("Thiếu con nợ.");
    if (creditor && debtor && normalizeKey(creditor) === normalizeKey(debtor)) {
      errors.push("Chủ nợ và con nợ cần là hai người khác nhau.");
    }
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      errors.push("Số tiền cần là số nguyên an toàn và lớn hơn 0 ₫.");
    }
    if (!date) errors.push("Ngày chưa đúng định dạng Excel hoặc mm/dd/yyyy.");
    if (!status) errors.push("Trạng thái chỉ nhận Đã trả, Chưa trả hoặc để trống.");

    const identity = stableRowHash(JSON.stringify([
      normalizeKey(creditor),
      normalizeKey(debtor),
      amount,
      date,
      note.toLocaleLowerCase("vi-VN"),
    ]));
    const occurrence = (identityCounts.get(identity) || 0) + 1;
    identityCounts.set(identity, occurrence);
    const id = `import:${identity}:${occurrence}`;
    return {
      rowNumber,
      creditor,
      debtor,
      amount,
      date,
      note,
      status: status || "unpaid",
      errors,
      entry: errors.length ? null : {
        id,
        billId: id,
        creditor,
        debtor,
        amount,
        date,
        note,
        status,
        savedAt,
      },
    };
  });
  const entries = previewRows.map(({ entry }) => entry).filter(Boolean);
  const errorCount = previewRows.length - entries.length;
  return {
    rows: previewRows,
    entries,
    totalCount: previewRows.length,
    validCount: entries.length,
    errorCount,
    fatalErrors: [],
  };
}

function stableRowHash(value) {
  let hash = 14695981039346656037n;
  for (const character of String(value)) {
    hash ^= BigInt(character.codePointAt(0));
    hash = BigInt.asUintN(64, hash * 1099511628211n);
  }
  return hash.toString(16).padStart(16, "0");
}

function decodeXml(value) {
  return String(value ?? "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, number) => String.fromCodePoint(Number(number)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function getXmlAttribute(attributes, name) {
  const match = String(attributes).match(new RegExp(`(?:^|\\s)${name}=["']([^"']*)["']`, "i"));
  return match ? decodeXml(match[1]) : "";
}

function getTextNodes(xml) {
  return [...String(xml).matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)]
    .map((match) => decodeXml(match[1]))
    .join("");
}

function getSharedStrings(files) {
  const bytes = files["xl/sharedStrings.xml"];
  if (!bytes) return [];
  const xml = strFromU8(bytes);
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gi)]
    .map((match) => getTextNodes(match[1]));
}

function columnIndex(reference) {
  const letters = String(reference).match(/^[A-Z]+/i)?.[0] || "";
  return [...letters.toUpperCase()].reduce((index, letter) => index * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function parseWorksheet(xml, sharedStrings) {
  const rows = [];
  for (const rowMatch of String(xml).matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/gi)) {
    const rowNumber = Math.max(1, Number(getXmlAttribute(rowMatch[1], "r")) || rows.length + 1);
    if (rowNumber > MAX_WORKSHEET_ROW_NUMBER) throw new Error("Số dòng trong worksheet vượt giới hạn.");
    const row = [];
    let fallbackColumn = 0;
    for (const cellMatch of rowMatch[2].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/gi)) {
      const attributes = cellMatch[1];
      const content = cellMatch[2];
      const reference = getXmlAttribute(attributes, "r");
      const index = Math.max(0, columnIndex(reference) >= 0 ? columnIndex(reference) : fallbackColumn);
      if (index > MAX_WORKSHEET_COLUMN_INDEX) throw new Error("Số cột trong worksheet vượt giới hạn.");
      const type = getXmlAttribute(attributes, "t");
      const rawValue = content.match(/<v\b[^>]*>([\s\S]*?)<\/v>/i)?.[1] ?? "";
      let value;
      if (type === "inlineStr") value = getTextNodes(content);
      else if (type === "s") value = sharedStrings[Number(rawValue)] ?? "";
      else if (type === "str" || type === "e") value = decodeXml(rawValue);
      else if (type === "b") value = rawValue === "1";
      else value = rawValue === "" ? "" : Number(rawValue);
      row[index] = Number.isNaN(value) ? decodeXml(rawValue) : value;
      fallbackColumn = index + 1;
    }
    rows[rowNumber - 1] = row;
  }
  return rows.map((row) => row || []);
}

function uses1904DateSystem(files) {
  const workbookBytes = files["xl/workbook.xml"];
  if (!workbookBytes) return false;
  const workbookXml = strFromU8(workbookBytes);
  const attributes = workbookXml.match(/<workbookPr\b([^>]*)\/?\s*>/i)?.[1] || "";
  const value = getXmlAttribute(attributes, "date1904").toLocaleLowerCase();
  return value === "1" || value === "true";
}

function isRequiredWorkbookPart(name) {
  return name === "xl/workbook.xml"
    || name === "xl/_rels/workbook.xml.rels"
    || name === "xl/sharedStrings.xml"
    || /^xl\/worksheets\/[^/]+\.xml$/i.test(name);
}

function unzipWorkbook(bytes) {
  let uncompressedBytes = 0;
  return unzipSync(bytes, {
    filter(file) {
      if (!isRequiredWorkbookPart(file.name)) return false;
      const size = Number(file.originalSize) || 0;
      if (size > MAX_UNCOMPRESSED_WORKBOOK_BYTES
        || uncompressedBytes + size > MAX_UNCOMPRESSED_WORKBOOK_BYTES) {
        throw new Error("Nội dung giải nén của workbook vượt giới hạn.");
      }
      uncompressedBytes += size;
      return true;
    },
  });
}

function resolveWorksheetPath(files) {
  const workbookBytes = files["xl/workbook.xml"];
  const relationshipsBytes = files["xl/_rels/workbook.xml.rels"];
  if (!workbookBytes || !relationshipsBytes) return "xl/worksheets/sheet1.xml";
  const workbookXml = strFromU8(workbookBytes);
  const relationshipId = workbookXml.match(/<sheet\b[^>]*\br:id=["']([^"']+)["'][^>]*>/i)?.[1];
  if (!relationshipId) return "xl/worksheets/sheet1.xml";
  const relationshipsXml = strFromU8(relationshipsBytes);
  for (const match of relationshipsXml.matchAll(/<Relationship\b([^>]*)\/?\s*>/gi)) {
    if (getXmlAttribute(match[1], "Id") !== relationshipId) continue;
    const target = getXmlAttribute(match[1], "Target").replace(/\\/g, "/");
    if (!target || target.includes("..")) break;
    return target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^xl\//, "")}`;
  }
  return "xl/worksheets/sheet1.xml";
}

export function parseDebtWorkbook(input) {
  try {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (bytes.length > MAX_COMPRESSED_WORKBOOK_BYTES) throw new Error("Workbook vượt giới hạn 10 MB.");
    const files = unzipWorkbook(bytes);
    const worksheetPath = resolveWorksheetPath(files);
    const worksheet = files[worksheetPath];
    if (!worksheet) throw new Error("Không tìm thấy sheet dữ liệu.");
    const rows = parseWorksheet(strFromU8(worksheet), getSharedStrings(files));
    Object.defineProperty(rows, "date1904", {
      value: uses1904DateSystem(files),
      enumerable: false,
    });
    return rows;
  } catch (error) {
    throw new Error("File Excel .xlsx không hợp lệ hoặc không thể đọc.", { cause: error });
  }
}
