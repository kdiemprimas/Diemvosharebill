import { strToU8, zipSync } from "fflate";

const HEADERS = ["STT", "Chủ nợ", "Con nợ", "Tiền", "Ngày", "Ghi chú", "Trạng thái"];
const EXCEL_EPOCH_OFFSET = 25569;
const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;

function normalizeName(value) {
  return String(value || "").trim().toLocaleLowerCase("vi-VN");
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function columnName(index) {
  let result = "";
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) {
    result = String.fromCharCode(65 + ((value - 1) % 26)) + result;
  }
  return result;
}

function inlineStringCell(reference, value, style = 0) {
  return `<c r="${reference}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

function numberCell(reference, value, style = 0) {
  const number = Number.isFinite(Number(value)) ? Number(value) : 0;
  return `<c r="${reference}" s="${style}"><v>${number}</v></c>`;
}

function excelDateSerial(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, year, month, day] = match.map(Number);
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) return null;
  return timestamp / DAY_IN_MILLISECONDS + EXCEL_EPOCH_OFFSET;
}

function dateCell(reference, value) {
  const serial = excelDateSerial(value);
  return serial === null
    ? inlineStringCell(reference, value)
    : numberCell(reference, serial, 3);
}

function createSheetXml(entries) {
  const lastRow = Math.max(1, entries.length + 1);
  const headerCells = HEADERS
    .map((header, index) => inlineStringCell(`${columnName(index)}1`, header, 1))
    .join("");
  const rows = entries.map((entry, index) => {
    const row = index + 2;
    const isPaid = entry.status === "paid";
    return `<row r="${row}" ht="21" customHeight="1">${[
      numberCell(`A${row}`, index + 1),
      inlineStringCell(`B${row}`, entry.creditor),
      inlineStringCell(`C${row}`, entry.debtor),
      numberCell(`D${row}`, Math.max(0, Math.round(Number(entry.amount) || 0)), 2),
      dateCell(`E${row}`, entry.date),
      inlineStringCell(`F${row}`, entry.note || ""),
      inlineStringCell(`G${row}`, isPaid ? "Đã trả" : "Chưa trả", isPaid ? 5 : 4),
    ].join("")}</row>`;
  }).join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:G${lastRow}"/>
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="20"/>
  <cols>
    <col min="1" max="1" width="7" customWidth="1"/>
    <col min="2" max="3" width="22" customWidth="1"/>
    <col min="4" max="4" width="16" customWidth="1"/>
    <col min="5" max="5" width="14" customWidth="1"/>
    <col min="6" max="6" width="32" customWidth="1"/>
    <col min="7" max="7" width="16" customWidth="1"/>
  </cols>
  <sheetData><row r="1" ht="25" customHeight="1">${headerCells}</row>${rows}</sheetData>
  <autoFilter ref="A1:G${lastRow}"/>
  <pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>
  <pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>
</worksheet>`;
}

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

const ROOT_RELATIONSHIPS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

const WORKBOOK_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <bookViews><workbookView xWindow="0" yWindow="0" windowWidth="16000" windowHeight="9000"/></bookViews>
  <sheets><sheet name="Sổ tiền chia" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;

const WORKBOOK_RELATIONSHIPS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="2">
    <numFmt numFmtId="164" formatCode="#\,##0 &quot;₫&quot;"/>
    <numFmt numFmtId="165" formatCode="dd/mm/yyyy"/>
  </numFmts>
  <fonts count="4">
    <font><sz val="11"/><name val="Aptos"/><family val="2"/></font>
    <font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Aptos"/><family val="2"/></font>
    <font><color rgb="FFA54E54"/><sz val="11"/><name val="Aptos"/><family val="2"/></font>
    <font><color rgb="FF3F7168"/><sz val="11"/><name val="Aptos"/><family val="2"/></font>
  </fonts>
  <fills count="5">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF557F8E"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFAE5E2"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFDEEEE7"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left style="thin"><color rgb="FFE3E0DC"/></left><right style="thin"><color rgb="FFE3E0DC"/></right><top style="thin"><color rgb="FFE3E0DC"/></top><bottom style="thin"><color rgb="FFE3E0DC"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="6">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment horizontal="center" vertical="center"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

export function getDebtExportEntries(entries = [], personFilter = "", yearFilter = "") {
  const normalizedPerson = normalizeName(personFilter);
  const year = String(yearFilter || "").trim();
  return (Array.isArray(entries) ? entries : []).filter((entry) => {
    const matchesPerson = !normalizedPerson || normalizeName(entry?.debtor) === normalizedPerson;
    const matchesYear = !year || String(entry?.date || "").startsWith(`${year}-`);
    return matchesPerson && matchesYear;
  });
}

export function createDebtWorkbook(entries = []) {
  const files = {
    "[Content_Types].xml": strToU8(CONTENT_TYPES_XML),
    "_rels/.rels": strToU8(ROOT_RELATIONSHIPS_XML),
    "xl/workbook.xml": strToU8(WORKBOOK_XML),
    "xl/_rels/workbook.xml.rels": strToU8(WORKBOOK_RELATIONSHIPS_XML),
    "xl/styles.xml": strToU8(STYLES_XML),
    "xl/worksheets/sheet1.xml": strToU8(createSheetXml(Array.isArray(entries) ? entries : [])),
  };
  return zipSync(files, { level: 6 });
}

export function createDebtWorkbookFilename(date = new Date()) {
  const value = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `so-tien-chia-${year}-${month}-${day}.xlsx`;
}
