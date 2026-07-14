import test from "node:test";
import assert from "node:assert/strict";
import {
  buildStructuredOcrText,
  findTemporaryTotalRows,
  parseAmount,
  parseBillText,
} from "./bill-ocr.js";

test("đọc các kiểu định dạng tiền Việt Nam phổ biến", () => {
  assert.equal(parseAmount("45.000đ"), 45000);
  assert.equal(parseAmount("50,000 VND"), 50000);
  assert.equal(parseAmount("32k"), 32000);
});

test("chỉ giữ thông tin chính từ bill đặt theo nhóm", () => {
  const parsed = parseBillText(`
    GrabFood
    14:03 ngày 10 thg 7, 2026
    Bạn (Trưởng nhóm): 1 món
    1x Matcha Cloudy L
    53.000
    Không ngọt
    Đá chung
    Thoa: 1 món
    1x Matcha Cloudy M 43.000
    Ngọt ít
    DiemVtk: 1 món
    1x Cà Phê Đen S 25.000
    Không ngọt
    Không đá
    Tổng tạm tính 121.000
    Phí áp dụng 26.000
    (GrabUnlimited) Giảm 12K phí ship -10.000
    GrabVIP Benefit -10.000
    Giảm đến 10% khi Đặt đơn nhóm -4.840
    Giảm 26K, thêm ưu đãi bên dưới -26.000
    Giảm 9K, thêm ưu đãi bên dưới -9.000
    Giảm 8.000 VND -8.000
    Tổng tiền phải trả 79.160
  `);

  assert.equal(parsed.platform, "GrabFood");
  assert.equal(parsed.orderDate, "14:03 · 10/07/2026");
  assert.equal(parsed.subtotal, 121000);
  assert.equal(parsed.shippingFee, 0);
  assert.equal(parsed.surcharge, 26000);
  assert.equal(parsed.discount, 67840);
  assert.equal(parsed.totalPayable, 79160);
  assert.deepEqual(parsed.people, ["Bạn", "Thoa", "DiemVtk"]);
  assert.deepEqual(parsed.items, [
    { ownerName: "Bạn", name: "Matcha Cloudy L", quantity: 1, lineTotal: 53000, price: 53000 },
    { ownerName: "Thoa", name: "Matcha Cloudy M", quantity: 1, lineTotal: 43000, price: 43000 },
    { ownerName: "DiemVtk", name: "Cà Phê Đen S", quantity: 1, lineTotal: 25000, price: 25000 },
  ]);
  assert.equal(parsed.items.some((item) => /ngọt|đá/i.test(item.name)), false);
});

test("ưu tiên tổng giảm giá đã công bố để không cộng trùng voucher", () => {
  const parsed = parseBillText(`
    Đơn của Mai
    Bánh mì 25.000đ
    Phí giao hàng 12.000đ
    Giảm giá món -5.000đ
    Voucher freeship -7.000đ
    Tổng mã giảm giá -12.000đ
    Tổng cộng 25.000đ
  `);

  assert.equal(parsed.shippingFee, 12000);
  assert.equal(parsed.discount, 12000);
  assert.equal(parsed.totalPayable, 25000);
  assert.deepEqual(parsed.people, ["Mai"]);
});

test("không dùng tổng thanh toán sai để thổi phồng các ưu đãi đã đọc được", () => {
  const parsed = parseBillText(`
    GrabFood
    Đơn của Mai
    Bánh mì 121.000đ
    Phí áp dụng 26.000đ
    GrabVIP Benefit -10.000đ
    Giảm đơn nhóm -4.840đ
    Tổng tiền phải trả 79.160đ
  `);

  assert.equal(parsed.subtotal, 121000);
  assert.equal(parsed.surcharge, 26000);
  assert.equal(parsed.discount, 14840);
  assert.equal(parsed.totalPayable, 132160);
});

test("bỏ mảnh ngày giờ giả, khôi phục trưởng nhóm và không suy ngược giảm giá từ tổng sai", () => {
  const parsed = parseBillText(`
    GrabFood
    14:03 ngày 10 thg 7, 2026
    14: 279đ
    1x Matcha Cloudy L 53.000đ
    Thoa: 1 món
    1x Matcha Cloudy M 43.000đ
    DiemVtk: 1 món
    1x Cà Phê Đen S 25.000đ
    Tổng tạm tính 121.000đ
    Phí áp dụng 26.000đ
    (GrabUnlimited) Giảm 12K phí ship -10.000đ
    GrabVIP Benefit -10.000đ
    Giảm đến 10% khi Đặt đơn nhóm -4.840đ
    Giảm 26K, thêm ưu đãi bên dưới -26.000đ
    Giảm 9K, thêm ưu đãi bên dưới -9.000đ
    Giảm 8.000 VND -8.000đ
    Tổng tiền phải trả 22.160đ
  `);

  assert.deepEqual(parsed.people, ["Bạn", "Thoa", "DiemVtk"]);
  assert.deepEqual(parsed.items, [
    { ownerName: "Bạn", name: "Matcha Cloudy L", quantity: 1, lineTotal: 53000, price: 53000 },
    { ownerName: "Thoa", name: "Matcha Cloudy M", quantity: 1, lineTotal: 43000, price: 43000 },
    { ownerName: "DiemVtk", name: "Cà Phê Đen S", quantity: 1, lineTotal: 25000, price: 25000 },
  ]);
  assert.equal(parsed.discount, 67840);
  assert.equal(parsed.totalPayable, 79160);
});

test("tự tính tổng phải trả khi bill không có dòng tổng cuối", () => {
  const parsed = parseBillText(`
    beFood
    Đơn của Bình
    2x Trà đào 30.000đ
    Phí ship 10.000đ
    Phụ thu 5.000đ
    Ưu đãi -8.000đ
  `);

  assert.equal(parsed.platform, "beFood");
  assert.equal(parsed.subtotal, 30000);
  assert.equal(parsed.shippingFee, 10000);
  assert.equal(parsed.surcharge, 5000);
  assert.equal(parsed.discount, 8000);
  assert.equal(parsed.totalPayable, 37000);
});

test("chịu được lỗi OCR phổ biến ở ngày và nhãn trưởng nhóm", () => {
  const parsed = parseBillText(`
    14:03 ngày 1O thọ 7. 2026
    Trưởng nhóm): 1 món
    1x Matcha Cloudy L 53.000
  `);

  assert.equal(parsed.orderDate, "14:03 · 10/07/2026");
  assert.deepEqual(parsed.people, ["Bạn"]);
});

test("nhận Bạn là trưởng nhóm khi OCR làm mất dấu hai chấm hoặc đọc sai số lượng", () => {
  for (const ownerLine of [
    "Bạn (Trưởng nhóm) 1 món",
    "Bạn (Trưởng nhóm): | món",
    "Bạn (Trưởng nhóm)",
  ]) {
    const parsed = parseBillText(`
      ${ownerLine}
      1x Matcha Cloudy L 53.000
    `);

    assert.deepEqual(parsed.people, ["Bạn"], ownerLine);
    assert.equal(parsed.items[0].ownerName, "Bạn", ownerLine);
  }
});

test("bỏ qua giá gốc bị gạch khi giá sau giảm nằm cùng dòng món", () => {
  const parsed = parseBillText(`
    Mai Ngân: 1 món
    1x Cơm chiên ba rọi sốt BƠ TỎI 47.700
    62.009
    nhiều nước mắm
  `);

  assert.deepEqual(parsed.items, [
    {
      ownerName: "Mai Ngân",
      name: "Cơm chiên ba rọi sốt BƠ TỎI",
      quantity: 1,
      lineTotal: 47700,
      price: 47700,
    },
  ]);
  assert.equal(parsed.subtotal, 47700);
});

test("chọn giá sau giảm ở trên khi OCR tách hai mức giá thành hai dòng", () => {
  const parsed = parseBillText(`
    Mai Ngân: 1 món
    1x Cơm chiên ba rọi sốt BƠ TỎI
    47.700
    53.000
  `);

  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].lineTotal, 47700);
  assert.equal(parsed.subtotal, 47700);
});

test("bỏ số tiền app nguồn đã chia sẵn, ghi chú và giá gạch của món", () => {
  const parsed = parseBillText(`
    "sian ® Xem lộ trình ail 56 67? 5.667
    0.3km 08:64 - 09: 4
    VõDiễm =
    @ 1 phần 408.504
    x1 Americano Nước Dừa 65.000
    Lê Tiến x
    @ 1 phần 30.226
    Coffee
    x1 Cà Phê Phin Đen Đá 35.000
    Nguyễn Minh Nhật N
    (Đơn) 459.244
    x1 Combo Sáng Highlands 59.000
    Option 1: Bạn chọn ly nhé! 68.000
    Phin Sữa Đá - cỡ L
    Option 2: Chọn 1 bánh trong
    combo: Bánh Mì Que Pate
    Apple Pay 117.000
  `);

  assert.deepEqual(parsed.people, ["VõDiễm", "Lê Tiến", "Nguyễn Minh Nhật N"]);
  assert.deepEqual(parsed.items, [
    { ownerName: "VõDiễm", name: "Americano Nước Dừa", quantity: 1, lineTotal: 65000, price: 65000 },
    { ownerName: "Lê Tiến", name: "Cà Phê Phin Đen Đá", quantity: 1, lineTotal: 35000, price: 35000 },
    { ownerName: "Nguyễn Minh Nhật N", name: "Combo Sáng Highlands", quantity: 1, lineTotal: 59000, price: 59000 },
  ]);
  assert.equal(parsed.subtotal, 159000);
});

test("bỏ tổng chia sẵn khi OCR đặt số tiền ngay trên dòng tên người", () => {
  const parsed = parseBillText(`
    Hà 40.850
    1 phần
    x1 Americano Nước Dừa 65.000
  `);

  assert.deepEqual(parsed.people, ["Hà"]);
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].lineTotal, 65000);
  assert.equal(parsed.totalPayable, 65000);
});

test("đọc đúng bố cục OCR thưa khi tên, tổng tạm, số phần, món và giá nằm trên các dòng riêng", () => {
  const parsed = parseBillText(`
    Võ Diễm
    40.850đ ^
    1phần
    Americano Nước Dừa
    65.000đ
    Chọn size: Size L
    không đường
    Lê Tiến
    30.226đ ^
    1phần
    Cà Phê Phin Đen Đá (Coffee)
    35.000đ
    Chọn size: Size S
    Nguyễn Minh Nhật
    45.924đ ^
    1phần
    Combo Sáng Highlands 45K
    59.000đ
    Option 1: Bạn chọn 1 ly nhé! 68.000đ
    Phin Sữa Đá - cỡ L
    Option 2: Chọn 1 bánh trong
    combo: Bánh Mì Que Pate
    Chi tiết thanh toán
    Apple Pay 117.000đ
  `);

  assert.deepEqual(parsed.people, ["Võ Diễm", "Lê Tiến", "Nguyễn Minh Nhật"]);
  assert.deepEqual(parsed.items, [
    { ownerName: "Võ Diễm", name: "Americano Nước Dừa", quantity: 1, lineTotal: 65000, price: 65000 },
    { ownerName: "Lê Tiến", name: "Cà Phê Phin Đen Đá (Coffee)", quantity: 1, lineTotal: 35000, price: 35000 },
    { ownerName: "Nguyễn Minh Nhật", name: "Combo Sáng Highlands 45K", quantity: 1, lineTotal: 59000, price: 59000 },
  ]);
  assert.equal(parsed.subtotal, 159000);
});

test("không tính dòng tiền món vào khuyến mãi và đọc đúng món của trưởng nhóm", () => {
  const parsed = parseBillText(`
    Bạn (Trưởng nhóm) 40.850đ ^
    1 phần
    x1 Americano Nước Dừa 65.000đ
    Lê Tiến 30.226đ ^
    1 phần
    x1 Cà Phê Phin Đen Đá 35.000đ
    Nguyễn Minh Nhật 45.924đ ^
    1 phần
    x1 Combo Sáng Highlands 59.000đ
    Chi tiết thanh toán
    Tiền món 159.000đ
    Apple Pay 117.000đ
  `);

  assert.deepEqual(parsed.people, ["Bạn", "Lê Tiến", "Nguyễn Minh Nhật"]);
  assert.deepEqual(parsed.items.map(({ ownerName, name, lineTotal }) => ({ ownerName, name, lineTotal })), [
    { ownerName: "Bạn", name: "Americano Nước Dừa", lineTotal: 65000 },
    { ownerName: "Lê Tiến", name: "Cà Phê Phin Đen Đá", lineTotal: 35000 },
    { ownerName: "Nguyễn Minh Nhật", name: "Combo Sáng Highlands", lineTotal: 59000 },
  ]);
  assert.equal(parsed.subtotal, 159000);
  assert.equal(parsed.discount, 42000);
  assert.equal(parsed.totalPayable, 117000);
});

test("dùng vị trí OCR để bổ sung tên người bị thiếu và giữ đúng thứ tự món với giá", () => {
  const blocks = [
    { text: "Võ Diễm", bbox: { x0: 160, y0: 60, x1: 294, y1: 93 } },
    { text: "40.850đ ^", bbox: { x0: 654, y0: 86, x1: 889, y1: 118 } },
    { text: "1phần", bbox: { x0: 162, y0: 107, x1: 260, y1: 142 } },
    { text: "Americano Nước Dừa", bbox: { x0: 202, y0: 202, x1: 541, y1: 230 } },
    { text: "65.000đ", bbox: { x0: 737, y0: 202, x1: 904, y1: 235 } },
    { text: "45.924đ ^", bbox: { x0: 659, y0: 808, x1: 889, y1: 840 } },
    { text: "1phần", bbox: { x0: 161, y0: 830, x1: 260, y1: 864 } },
    { text: "Combo Sáng Highlands 45K", bbox: { x0: 202, y0: 924, x1: 650, y1: 959 } },
    { text: "59.000đ", bbox: { x0: 739, y0: 925, x1: 904, y1: 957 } },
  ];

  const totals = findTemporaryTotalRows(blocks, 975);
  assert.equal(totals.length, 2);

  const structuredText = buildStructuredOcrText(blocks, ["Võ Diễm", "Nguyễn Minh Nhật"], 975);
  const parsed = parseBillText(structuredText);
  assert.deepEqual(parsed.people, ["Võ Diễm", "Nguyễn Minh Nhật"]);
  assert.deepEqual(parsed.items.map(({ ownerName, name, lineTotal }) => ({ ownerName, name, lineTotal })), [
    { ownerName: "Võ Diễm", name: "Americano Nước Dừa", lineTotal: 65000 },
    { ownerName: "Nguyễn Minh Nhật", name: "Combo Sáng Highlands 45K", lineTotal: 59000 },
  ]);
});
