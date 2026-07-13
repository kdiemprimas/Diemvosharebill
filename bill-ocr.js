const SUMMARY_KEYWORDS = [
  "tổng tạm tính",
  "tổng cộng",
  "tổng thanh toán",
  "tổng tiền phải trả",
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
];

function fold(value) {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .toLowerCase();
}

function normalizeLine(value) {
  return String(value)
    .replace(/[|•●]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

function removeAmount(value) {
  return normalizeLine(
    String(value)
      .replace(/-?\s*\d+(?:[.,]\d+)?\s*k\b/gi, "")
      .replace(/-?\s*\d[\d\s.,]{2,}\s*(?:₫|đ|vnd|d)?\s*$/gi, "")
      .replace(/[–—-]\s*$/, ""),
  );
}

function extractQuantity(value) {
  const match = String(value).match(/^\s*(\d+)\s*[x×]\s*/i);
  return match ? Math.max(1, Number(match[1])) : 1;
}

function removeQuantity(value) {
  return normalizeLine(String(value).replace(/^\s*\d+\s*[x×]\s*/i, ""));
}

function includesAny(value, keywords) {
  const normalized = fold(value);
  return keywords.some((keyword) => normalized.includes(fold(keyword)));
}

function isSummaryLine(value) {
  return includesAny(value, SUMMARY_KEYWORDS);
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
    const owner = normalizeLine(line.slice(0, leaderMatch[1].length)).replace(/[()]+$/g, "").trim();
    return /^(?:ban|truong nhom|leader)$/i.test(fold(owner)) ? "Bạn" : owner;
  }

  const match = line.match(/^(.+?)(?:\s*\([^)]*\))?\s*:?\s*(?:\d+|[|Il])\s*m[oó]n\b/i);
  if (!match) return "";
  const owner = normalizeLine(match[1]).replace(/[()]+$/g, "").trim();
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
  let explicitDiscountTotal = 0;

  lines.forEach((line, index) => {
    if (parseOrderDate([line])) return;

    const amount = parseAmount(line);
    const currentLabel = fold(removeAmount(line));
    const previousLabel = fold(lines[index - 1] || "");
    const metadataLabel = currentLabel || previousLabel;
    const namedOwner = groupOwner(line) || explicitOwner(line);
    if (namedOwner && !amount) {
      currentOwner = namedOwner;
      return;
    }

    if (amount && /(tong (?:ma )?giam gia|tong khuyen mai|tong uu dai|total discount)/i.test(metadataLabel)) {
      explicitDiscountTotal = amount;
      return;
    }
    if (amount && /(tong tien phai tra|tong thanh toan|tong cong|tong bill|can thanh toan|ban tra|thanh tien|total payable|grand total)/i.test(metadataLabel)) {
      detectedTotal = amount;
      return;
    }
    if (amount && /(tong tam tinh|tam tinh|subtotal)/i.test(metadataLabel)) {
      detectedSubtotal = amount;
      return;
    }
    if (amount && /(giam|khuyen mai|uu dai|voucher|promotion|promo|benefit)/i.test(metadataLabel)) {
      discountLinesTotal += amount;
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

    let itemLineIndex = index;
    let itemText = removeAmount(line);
    if (!itemText || /^[-+]?\s*(?:₫|đ|vnd)?$/i.test(itemText)) {
      itemLineIndex = index - 1;
      itemText = lines[itemLineIndex] || "";
    }

    itemText = removeAmount(itemText);
    const quantity = extractQuantity(itemText);
    itemText = removeQuantity(itemText);
    const split = splitOwnerAndItem(itemText);
    const ownerName = split.ownerName || findOwner(lines, itemLineIndex, currentOwner);
    const itemName = normalizeLine(split.itemName);
    if (!itemName || isSummaryLine(itemName)) return;

    result.items.push({
      ownerName,
      name: itemName,
      quantity,
      lineTotal: amount,
      price: Math.round(amount / quantity),
    });
  });

  result.people = [...new Set(result.items.map((item) => item.ownerName))];
  result.subtotal = detectedSubtotal || result.items.reduce((sum, item) => sum + item.lineTotal, 0);
  result.discount = explicitDiscountTotal || discountLinesTotal;
  result.totalPayable = detectedTotal || Math.max(
    0,
    result.subtotal + result.shippingFee + result.surcharge - result.discount,
  );
  return result;
}
