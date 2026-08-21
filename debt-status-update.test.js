import test from "node:test";
import assert from "node:assert/strict";
import {
  createDebtStatusConfirmation,
  createDebtStatusUpdateFeedback,
} from "./debt-status-update.js";

test("tạo nội dung xác nhận cập nhật trạng thái theo số khoản và trạng thái đích", () => {
  assert.deepEqual(createDebtStatusConfirmation(1, "paid"), {
    title: "Cập nhật 1 khoản thành “đã trả”?",
    description: "Bạn có chắc muốn đổi trạng thái của 1 khoản đã chọn thành “đã trả” không?",
    button: "Xác nhận đã trả",
  });
  assert.deepEqual(createDebtStatusConfirmation(3, "unpaid"), {
    title: "Cập nhật 3 khoản thành “chưa trả”?",
    description: "Bạn có chắc muốn đổi trạng thái của 3 khoản đã chọn thành “chưa trả” không?",
    button: "Xác nhận chưa trả",
  });
});

test("tạo thông báo thành công và thất bại rõ ràng cho người dùng", () => {
  assert.deepEqual(createDebtStatusUpdateFeedback(2, "paid", true), {
    state: "success",
    message: "Đã cập nhật 2 khoản thành “đã trả” thành công.",
  });
  assert.deepEqual(createDebtStatusUpdateFeedback(2, "unpaid", false), {
    state: "error",
    message: "Cập nhật 2 khoản thành “chưa trả” thất bại. Dữ liệu chưa thay đổi, hãy thử lại.",
  });
});
