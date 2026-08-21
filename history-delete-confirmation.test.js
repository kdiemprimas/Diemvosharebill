import test from "node:test";
import assert from "node:assert/strict";
import { createHistoryDeleteConfirmation } from "./history-delete-confirmation.js";

const context = {
  historyCount: 3,
  debtCount: 5,
  formatAmount: (amount) => `${amount} ₫`,
};

test("tạo xác nhận xóa một bill mà không yêu cầu dữ liệu xóa hàng loạt", () => {
  assert.deepEqual(
    createHistoryDeleteConfirmation(
      { type: "record", id: "bill-1", billName: "Trưa thứ Sáu" },
      context,
    ),
    {
      title: "Xóa “Trưa thứ Sáu”?",
      description: "Bill này sẽ bị xóa khỏi lịch sử và không thể khôi phục trên thiết bị này.",
      button: "Xóa khỏi lịch sử",
    },
  );
});

test("tạo đúng nội dung xác nhận cho xóa hàng loạt", () => {
  assert.deepEqual(
    createHistoryDeleteConfirmation(
      { type: "debt-bulk", ids: ["entry-1", "entry-2"], amount: 75000 },
      context,
    ),
    {
      title: "Xóa 2 khoản đã chọn?",
      description: "75000 ₫ trong các khoản đã chọn sẽ bị xóa và không thể khôi phục.",
      button: "Xóa 2 khoản",
    },
  );
});

test("tạo đúng nội dung xác nhận xóa toàn bộ lịch sử bill", () => {
  assert.deepEqual(createHistoryDeleteConfirmation({ type: "all" }, context), {
    title: "Xóa toàn bộ lịch sử bill?",
    description: "3 bill đã lưu sẽ bị xóa và không thể khôi phục trên thiết bị này.",
    button: "Xóa toàn bộ bill",
  });
});

test("tạo đúng nội dung xác nhận xóa toàn bộ sổ tiền chia", () => {
  assert.deepEqual(createHistoryDeleteConfirmation({ type: "debt-all" }, context), {
    title: "Xóa toàn bộ sổ tiền chia?",
    description: "5 khoản đã lưu sẽ bị xóa. Lịch sử bill vẫn được giữ lại.",
    button: "Xóa sổ tiền chia",
  });
});

test("tạo đúng nội dung xác nhận xóa một khoản nợ", () => {
  assert.deepEqual(
    createHistoryDeleteConfirmation(
      { type: "debt-entry", debtor: "Kha Dang", amount: 100000 },
      context,
    ),
    {
      title: "Xóa khoản của “Kha Dang”?",
      description: "100000 ₫ sẽ bị xóa khỏi sổ tiền chia và không thể khôi phục.",
      button: "Xóa khoản này",
    },
  );
});

test("bỏ qua loại xóa không hợp lệ và dùng mặc định an toàn khi thiếu ngữ cảnh", () => {
  assert.equal(createHistoryDeleteConfirmation({ type: "unknown" }), null);
  assert.deepEqual(createHistoryDeleteConfirmation({ type: "debt-bulk", amount: 0 }), {
    title: "Xóa 0 khoản đã chọn?",
    description: "0 trong các khoản đã chọn sẽ bị xóa và không thể khôi phục.",
    button: "Xóa 0 khoản",
  });
});
