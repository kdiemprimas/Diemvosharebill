import test from "node:test";
import assert from "node:assert/strict";
import { allocateEvenly, calculateBill } from "./bill-calculator.js";

test("chia số tiền lẻ nhưng vẫn giữ đúng tổng", () => {
  const shares = allocateEvenly(10000, ["a", "b", "c"]);
  assert.deepEqual(shares, { a: 3334, b: 3333, c: 3333 });
  assert.equal(Object.values(shares).reduce((sum, value) => sum + value, 0), 10000);
});

test("chia phí ship, phụ thu và giảm giá đều cho tất cả mọi người", () => {
  const bill = calculateBill({
    people: [
      { id: "a", name: "An" },
      { id: "b", name: "Bình" },
    ],
    items: [
      { name: "Cơm", quantity: 1, price: 50000, ownerId: "a" },
      { name: "Bún", quantity: 2, price: 30000, ownerId: "b" },
    ],
    shippingFee: 20000,
    surcharge: 10000,
    discount: 30000,
  });

  assert.equal(bill.subtotal, 110000);
  assert.equal(bill.total, 110000);
  assert.deepEqual(
    bill.results.map(({ itemTotal, shippingShare, surchargeShare, discountShare, payable }) => ({
      itemTotal,
      shippingShare,
      surchargeShare,
      discountShare,
      payable,
    })),
    [
      { itemTotal: 50000, shippingShare: 10000, surchargeShare: 5000, discountShare: 15000, payable: 50000 },
      { itemTotal: 60000, shippingShare: 10000, surchargeShare: 5000, discountShare: 15000, payable: 60000 },
    ],
  );
});

test("món dùng chung cũng được chia đều và không lệch tổng", () => {
  const bill = calculateBill({
    people: [
      { id: "a", name: "An" },
      { id: "b", name: "Bình" },
      { id: "c", name: "Chi" },
    ],
    items: [{ name: "Gà", quantity: 1, price: 100000, ownerId: "all" }],
    shippingFee: 10000,
    discount: 5000,
  });

  assert.equal(bill.results.reduce((sum, result) => sum + result.payable, 0), bill.total);
  assert.deepEqual(bill.results.map(({ payable }) => payable), [35001, 34999, 35000]);
  assert.deepEqual(bill.results.map(({ lineItems }) => lineItems[0].amount), [33334, 33333, 33333]);
});
