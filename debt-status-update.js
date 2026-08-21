function getDebtStatusLabel(status) {
  return status === "paid" ? "đã trả" : "chưa trả";
}

export function createDebtStatusConfirmation(count, status) {
  const label = getDebtStatusLabel(status);
  return {
    title: `Cập nhật ${count} khoản thành “${label}”?`,
    description: `Bạn có chắc muốn đổi trạng thái của ${count} khoản đã chọn thành “${label}” không?`,
    button: `Xác nhận ${label}`,
  };
}

export function createDebtStatusUpdateFeedback(count, status, succeeded) {
  const label = getDebtStatusLabel(status);
  return succeeded
    ? {
        state: "success",
        message: `Đã cập nhật ${count} khoản thành “${label}” thành công.`,
      }
    : {
        state: "error",
        message: `Cập nhật ${count} khoản thành “${label}” thất bại. Dữ liệu chưa thay đổi, hãy thử lại.`,
      };
}
