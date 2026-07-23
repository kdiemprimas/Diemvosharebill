const SUMMARY_KEYWORDS = [
  "tổng tạm tính",
  "tổng cộng",
  "tổng thanh toán",
  "tổng tiền phải trả",
  "tiền món",
  "thành tiền",
  "subtotal",
  "total",
  "phí giao",
  "phí ship",
  "vận chuyển",
  "phụ thu",
  "phí áp dụng",
  "phí dịch vụ",
  "khuyến mãi",
  "ưu đãi",
  "giảm giá",
  "mã giảm giá",
  "voucher",
  "benefit",
];

const NON_NAME_KEYWORDS = [
  ...SUMMARY_KEYWORDS,
  "grabfood",
  "befood",
  "shopeefood",
  "đơn hàng",
  "chi tiết",
  "nhà hàng",
  "số lượng",
  "đơn giá",
  "món ăn",
  "cảm ơn",
  "combo",
];

function fold(value) {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase();
}

function normalizeLine(value) {
  return String(value)
    .replace(/[|•●]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function mergeOcrPageTexts(pageTexts) {
  const mergedLines = [];

  for (const pageText of pageTexts || []) {
    const pageLines = String(pageText || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (!pageLines.length) continue;

    let overlap = 0;
    const maxOverlap = Math.min(50, mergedLines.length, pageLines.length);
    for (let size = maxOverlap; size > 0; size -= 1) {
      const previousTail = mergedLines.slice(-size).map(normalizeLine);
      const nextHead = pageLines.slice(0, size).map(normalizeLine);
      if (previousTail.every((line, index) => line === nextHead[index])) {
        overlap = size;
        break;
      }
    }
    mergedLines.push(...pageLines.slice(overlap));
  }

  return mergedLines.join("\n");
}

export function parseAmount(value) {
  const text = String(value).toLowerCase();
  const matches = [
    ...text.matchAll(/-?\s*(\d+(?:[.,]\d+)?\s*k|\d[\d\s.,]{2,})\s*(?:₫|đ|vnd|d)?/gi),
  ];
  if (!matches.length) return 0;

  const raw = matches[matches.length - 1][1].trim();
  if (/k$/i.test(raw)) return Math.round(Number(raw.replace(/k/i, "").replace(",", ".")) * 1000);

  const amount = Number(raw.replace(/\D/g, "")) || 0;
  const hasMoneySignal = /[.,\s]/.test(raw) || /(?:₫|đ|vnd|\d\s*k)\b/i.test(text) || amount >= 1000;
  return hasMoneySignal ? amount : 0;
}

function hasNegativeAmount(value) {
  return /[−–—-]\s*(?:\d+(?:[.,]\d+)?\s*k\b|\d[\d\s.,]{2,})/i.test(String(value));
}

function removeAmount(value) {
  return normalizeLine(
    String(value)
      .replace(/-?\s*\d+(?:[.,]\d+)?\s*k\b/gi, "")
      .replace(/-?\s*\d[\d\s.,]{2,}\s*(?:₫|đ|vnd|d)?\s*[\^~ˆ]*\s*$/gi, "")
      .replace(/[–—-]\s*$/, ""),
  );
}

function extractQuantity(value) {
  const match = String(value).match(/^\s*(?:(\d+)\s*[x×]|[x×]\s*(\d+))\s*/i);
  return match ? Math.max(1, Number(match[1] || match[2])) : 1;
}

function removeQuantity(value) {
  return normalizeLine(String(value).replace(/^\s*(?:\d+\s*[x×]|[x×]\s*\d+)\s*/i, ""));
}

function includesAny(value, keywords) {
  const normalized = fold(value);
  return keywords.some((keyword) => normalized.includes(fold(keyword)));
}

function isSummaryLine(value) {
  return includesAny(value, SUMMARY_KEYWORDS);
}

function cleanOwnerName(value) {
  return normalizeLine(value)
    .replace(/[\^~ˆ]+\s*$/g, "")
    .replace(/\s*=\s*$/g, "")
    .replace(/\s+[x×]\s*$/i, "")
    .replace(/:$/, "")
    .trim();
}

function isCalculatedShareMarker(value) {
  const label = fold(removeAmount(value))
    .replace(/[()@:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return /^(?:\d+\s*)?phan$/i.test(label) || /^(?:don|don hang)$/i.test(label);
}

function isNonItemContent(value) {
  const label = fold(value);
  return /xem\s*lo\s*trinh|apple\s*pay|^option\s*\d+|^chon\s*size|^chi\s*tiet\s*thanh\s*toan|\b\d+(?:[.,]\d+)?\s*km\b|\b\d{1,2}:\d{2}\b/i.test(label);
}

function isStandaloneAmountLine(value) {
  return Boolean(parseAmount(value)) && !removeAmount(value).replace(/[\^~ˆ]/g, "").trim();
}

function explicitOwner(value) {
  const match = normalizeLine(value).match(
    /^(?:đơn\s*(?:của)?|order\s*(?:của)?|người\s*đặt|khách\s*hàng|thành\s*viên)\s*[:–—-]?\s*(.+)$/i,
  );
  return match ? normalizeLine(match[1]) : "";
}

function groupOwner(value) {
  const line = normalizeLine(value);
  const foldedLine = fold(line);
  const leaderMatch = foldedLine.match(
    /^(.+?)\s*\(\s*(?:truong nhom|leader)\s*\)?(?:\s*[:–—-]?\s*(?:\d+|[|il])?\s*mon\b)?\s*$/i,
  );
  if (leaderMatch) {
    const owner = cleanOwnerName(line.slice(0, leaderMatch[1].length)).replace(/[()]+$/g, "").trim();
    return /^(?:ban|truong nhom|leader)$/i.test(fold(owner)) ? "Bạn" : owner;
  }

  const match = line.match(/^(.+?)(?:\s*\([^)]*\))?\s*:?\s*(?:\d+|[|Il])\s*m[oó]n\b/i);
  if (!match) return "";
  const owner = cleanOwnerName(match[1]).replace(/[()]+$/g, "").trim();
  return /^(?:ban|truong nhom|leader)$/i.test(fold(owner)) ? "Bạn" : owner;
}

function looksLikeName(value) {
  const line = normalizeLine(value).replace(/:$/, "");
  if (!line || line.length > 35 || /\d/.test(line)) return false;
  if (line.split(" ").length > 5) return false;
  return !includesAny(line, NON_NAME_KEYWORDS);
}

function splitOwnerAndItem(value) {
  const line = normalizeLine(value);
  const parenthesized = line.match(/^(.+?)\s*\(([^()]{1,35})\)\s*$/);
  if (parenthesized && looksLikeName(parenthesized[2])) {
    return { ownerName: normalizeLine(parenthesized[2]), itemName: normalizeLine(parenthesized[1]) };
  }

  const separated = line.match(/^([^:–—-]{1,35})\s*[:–—-]\s*(.+)$/);
  if (separated && looksLikeName(separated[1]) && separated[2].length > 2) {
    return { ownerName: normalizeLine(separated[1]), itemName: normalizeLine(separated[2]) };
  }
  return { ownerName: "", itemName: line };
}

function findOwner(lines, itemLineIndex, currentOwner) {
  if (currentOwner) return currentOwner;
  for (let index = itemLineIndex - 1; index >= Math.max(0, itemLineIndex - 3); index -= 1) {
    const owner = explicitOwner(lines[index]) || groupOwner(lines[index]);
    if (owner) return owner;
    if (looksLikeName(lines[index]) && !parseAmount(lines[index])) return normalizeLine(lines[index]).replace(/:$/, "");
  }
  return "Chưa xác định";
}

function parseOrderDate(lines) {
  for (const line of lines) {
    const normalized = fold(line).replace(/(?<=\d)o|o(?=\d)/gi, "0");
    const verbose = normalized.match(/(?:(\d{1,2}:\d{2})\s*)?ngay\s*(\d{1,2})\s*th\w*\s*(\d{1,2})[.,\s]+(\d{4})/i);
    if (verbose) {
      const [, time, day, month, year] = verbose;
      const date = `${day.padStart(2, "0")}/${month.padStart(2, "0")}/${year}`;
      return time ? `${time} · ${date}` : date;
    }

    const numeric = line.match(/(?:(\d{1,2}:\d{2})\s+)?(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
    if (numeric) {
      const [, time, day, month, year] = numeric;
      const date = `${day.padStart(2, "0")}/${month.padStart(2, "0")}/${year}`;
      return time ? `${time} · ${date}` : date;
    }
  }
  return "";
}

function flattenOcrLines(blocks) {
  return (Array.isArray(blocks) ? blocks : [])
    .flatMap((block) => {
      const paragraphLines = block?.paragraphs?.flatMap((paragraph) => paragraph.lines || []) || [];
      return paragraphLines.length ? paragraphLines : [block];
    })
    .map((line) => ({
      text: normalizeLine(line?.text || ""),
      bbox: line?.bbox || {},
    }))
    .filter(({ text, bbox }) => text && Number.isFinite(bbox.x0) && Number.isFinite(bbox.y0));
}

export function findTemporaryTotalRows(blocks, imageWidth) {
  const lines = flattenOcrLines(blocks);
  return lines
    .filter((line) => {
      if (!parseAmount(line.text) || line.bbox.x0 < imageWidth * 0.55) return false;
      if (/[\^~ˆ]/.test(line.text)) return true;
      const height = Math.max(1, (line.bbox.y1 || line.bbox.y0) - line.bbox.y0);
      return lines.some((candidate) => (
        candidate.bbox.x0 < imageWidth * 0.55
        && candidate.bbox.y0 >= line.bbox.y0
        && candidate.bbox.y0 <= (line.bbox.y1 || line.bbox.y0) + height * 2
        && isCalculatedShareMarker(candidate.text)
      ));
    })
    .sort((left, right) => left.bbox.y0 - right.bbox.y0);
}

function cleanOcrHeader(value) {
  return cleanOwnerName(value)
    .replace(/^[^A-Za-zÀ-ỹĐđ]+/u, "")
    .replace(/[^A-Za-zÀ-ỹĐđ.'\-\s]+$/u, "")
    .trim();
}

export function buildStructuredOcrText(blocks, recognizedHeaders = [], imageWidth = 0) {
  const lines = flattenOcrLines(blocks);
  const temporaryRows = findTemporaryTotalRows(blocks, imageWidth);

  temporaryRows.forEach((row, index) => {
    const height = Math.max(1, (row.bbox.y1 || row.bbox.y0) - row.bbox.y0);
    const hasHeader = lines.some((candidate) => (
      candidate.bbox.x0 < imageWidth * 0.55
      && candidate.bbox.y0 < row.bbox.y0 + height * 0.35
      && (candidate.bbox.y1 || candidate.bbox.y0) >= row.bbox.y0 - height * 3
      && looksLikeName(cleanOcrHeader(candidate.text))
      && !isCalculatedShareMarker(candidate.text)
    ));
    const header = cleanOcrHeader(recognizedHeaders[index] || "");
    if (!hasHeader && header && looksLikeName(header)) {
      lines.push({
        text: header,
        bbox: { x0: 0, y0: row.bbox.y0 - height * 2.5, x1: imageWidth * 0.5, y1: row.bbox.y0 - height },
      });
    }
  });

  return lines
    .sort((left, right) => left.bbox.y0 - right.bbox.y0 || left.bbox.x0 - right.bbox.x0)
    .map((line) => line.text)
    .join("\n");
}

export function parseBillText(rawText) {
  const lines = String(rawText)
    .split(/\r?\n/)
    .map(normalizeLine)
    .filter(Boolean);

  const result = {
    platform: /grab/i.test(rawText)
      ? "GrabFood"
      : /\bbe\s*food\b|befood/i.test(rawText)
        ? "beFood"
        : /shopee/i.test(rawText)
          ? "ShopeeFood"
          : "Khác",
    orderDate: parseOrderDate(lines),
    people: [],
    items: [],
    subtotal: 0,
    shippingFee: 0,
    surcharge: 0,
    discount: 0,
    totalPayable: 0,
  };

  let currentOwner = "";
  let detectedSubtotal = 0;
  let detectedTotal = 0;
  let discountLinesTotal = 0;
  let discountLineCount = 0;
  let explicitDiscountTotal = 0;
  let lastItemPriceLineIndex = -2;
  let hasGroupOwnerHeaders = false;
  const detectedPeople = new Set();

  lines.forEach((line, index) => {
    if (parseOrderDate([line])) return;

    const amount = parseAmount(line);
    const lineWithoutAmount = removeAmount(line);
    const nextLine = lines[index + 1] || "";
    const lineAfterNext = lines[index + 2] || "";
    const currentLabel = fold(removeAmount(line));
    const previousLabel = fold(lines[index - 1] || "");
    const metadataLabel = currentLabel || previousLabel;
    const ownerCandidate = cleanOwnerName(amount ? lineWithoutAmount : line);
    const groupedOwner = groupOwner(ownerCandidate);
    const namedOwner = groupedOwner || explicitOwner(ownerCandidate);
    const ownerHasCalculatedShare = isCalculatedShareMarker(nextLine)
      || (parseAmount(nextLine) && isCalculatedShareMarker(lineAfterNext));
    if (namedOwner && (!amount || ownerHasCalculatedShare)) {
      if (groupedOwner) hasGroupOwnerHeaders = true;
      currentOwner = namedOwner;
      detectedPeople.add(namedOwner);
      return;
    }

    const standaloneOwner = ownerCandidate;
    const ownerBeforeCalculatedShare = looksLikeName(standaloneOwner)
      && ownerHasCalculatedShare;
    if (ownerBeforeCalculatedShare) {
      currentOwner = standaloneOwner;
      detectedPeople.add(standaloneOwner);
      return;
    }
    if (amount && currentOwner && isCalculatedShareMarker(nextLine)) return;
    if (amount && isCalculatedShareMarker(line)) return;

    if (amount && hasNegativeAmount(line) && /(tong (?:ma )?giam gia|tong khuyen mai|tong uu dai|total discount)/i.test(metadataLabel)) {
      explicitDiscountTotal = amount;
      return;
    }
    if (amount && /(tong tien phai tra|tong thanh toan|tong cong|tong bill|can thanh toan|ban tra|thanh tien|total payable|grand total)/i.test(metadataLabel)) {
      detectedTotal = amount;
      return;
    }
    if (amount && /(apple pay|google pay|momo|zalo\s*pay|shopee\s*pay|tien mat|cash payment)/i.test(metadataLabel)) {
      detectedTotal = amount;
      return;
    }
    if (amount && /(tong tam tinh|tam tinh|(?:tong )?tien mon|subtotal)/i.test(metadataLabel)) {
      detectedSubtotal = amount;
      return;
    }
    if (amount && /(giam|khuyen mai|uu dai|voucher|promotion|promo|benefit)/i.test(metadataLabel)) {
      if (hasNegativeAmount(line)) {
        discountLinesTotal += amount;
        discountLineCount += 1;
      }
      return;
    }
    if (amount && /(phi giao|phi ship|van chuyen|delivery fee)/i.test(metadataLabel)) {
      result.shippingFee += amount;
      return;
    }
    if (amount && /(phu thu|phi ap dung|phi dich vu|service fee|small order fee)/i.test(metadataLabel)) {
      result.surcharge += amount;
      return;
    }
    if (!amount || isSummaryLine(line)) return;
    if (amount < 1000) return;

    if (/\d+\s*k\b/i.test(line) && lineWithoutAmount && isStandaloneAmountLine(nextLine)) return;

    let itemLineIndex = index;
    let itemText = removeAmount(line);
    if (!itemText || /^[-+]?\s*(?:₫|đ|vnd)?$/i.test(itemText)) {
      if (lastItemPriceLineIndex === index - 1) return;
      itemLineIndex = index - 1;
      itemText = lines[itemLineIndex] || "";
    }

    const itemNameContainsProductPrice = itemLineIndex !== index
      && /\d+\s*k\b/i.test(itemText)
      && isStandaloneAmountLine(line);
    if (!itemNameContainsProductPrice) itemText = removeAmount(itemText);
    const quantity = extractQuantity(itemText);
    itemText = removeQuantity(itemText);
    const split = currentOwner ? { ownerName: "", itemName: itemText } : splitOwnerAndItem(itemText);
    const ownerName = split.ownerName || findOwner(lines, itemLineIndex, currentOwner);
    const itemName = normalizeLine(split.itemName);
    if (!itemName || isSummaryLine(itemName) || isNonItemContent(itemName)) return;

    result.items.push({
      ownerName,
      name: itemName,
      quantity,
      lineTotal: amount,
      price: Math.round(amount / quantity),
    });
    lastItemPriceLineIndex = index;
  });

  const inferredLeader = hasGroupOwnerHeaders
    && result.items.some((item) => item.ownerName === "Chưa xác định");
  if (inferredLeader) {
    result.items.forEach((item) => {
      if (item.ownerName === "Chưa xác định") item.ownerName = "Bạn";
    });
  }
  result.people = [...new Set([
    ...(inferredLeader ? ["Bạn"] : []),
    ...detectedPeople,
    ...result.items.map((item) => item.ownerName),
  ])];
  result.subtotal = detectedSubtotal || result.items.reduce((sum, item) => sum + item.lineTotal, 0);
  const listedDiscount = explicitDiscountTotal || discountLinesTotal;
  const grossTotal = result.subtotal + result.shippingFee + result.surcharge;
  result.discount = listedDiscount;
  const calculatedTotal = Math.max(0, grossTotal - result.discount);
  result.totalPayable = (explicitDiscountTotal || discountLineCount)
    ? calculatedTotal
    : detectedTotal || calculatedTotal;
  return result;
}
