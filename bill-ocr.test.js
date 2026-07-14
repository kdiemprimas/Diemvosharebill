import test from "node:test";
import assert from "node:assert/strict";
import { parseAmount, parseBillText } from "./bill-ocr.js";

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

test("bỏ số tiền app nguồn đã chia sẵn và giữ món thực tế bên dưới cho đúng người", () => {
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
    Option 1: Bạn chọn ly nhé! 8.000
    combo: Bánh Mì Que Pate 17.000
  `);

  assert.deepEqual(parsed.people, ["VõDiễm", "Lê Tiến", "Nguyễn Minh Nhật N"]);
  assert.deepEqual(parsed.items, [
    { ownerName: "VõDiễm", name: "Americano Nước Dừa", quantity: 1, lineTotal: 65000, price: 65000 },
    { ownerName: "Lê Tiến", name: "Cà Phê Phin Đen Đá", quantity: 1, lineTotal: 35000, price: 35000 },
    { ownerName: "Nguyễn Minh Nhật N", name: "Combo Sáng Highlands", quantity: 1, lineTotal: 59000, price: 59000 },
    { ownerName: "Nguyễn Minh Nhật N", name: "Option 1: Bạn chọn ly nhé!", quantity: 1, lineTotal: 8000, price: 8000 },
    { ownerName: "Nguyễn Minh Nhật N", name: "combo: Bánh Mì Que Pate", quantity: 1, lineTotal: 17000, price: 17000 },
  ]);
  assert.equal(parsed.subtotal, 184000);
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
