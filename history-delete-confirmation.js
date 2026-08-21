export function createHistoryDeleteConfirmation(deleteRequest, context = {}) {
  const historyCount = Number(context.historyCount) || 0;
  const debtCount = Number(context.debtCount) || 0;
  const formatAmount = typeof context.formatAmount === "function"
    ? context.formatAmount
    : (amount) => String(amount ?? 0);

  switch (deleteRequest?.type) {
    case "all":
      return {
        title: "Xóa toàn bộ lịch sử bill?",
        description: `${historyCount} bill đã lưu sẽ bị xóa và không thể khôi phục trên thiết bị này.`,
        button: "Xóa toàn bộ bill",
      };
    case "record":
      return {
        title: `Xóa “${deleteRequest.billName}”?`,
        description: "Bill này sẽ bị xóa khỏi lịch sử và không thể khôi phục trên thiết bị này.",
        button: "Xóa khỏi lịch sử",
      };
    case "debt-all":
      return {
        title: "Xóa toàn bộ sổ tiền chia?",
        description: `${debtCount} khoản đã lưu sẽ bị xóa. Lịch sử bill vẫn được giữ lại.`,
        button: "Xóa sổ tiền chia",
      };
    case "debt-entry":
      return {
        title: `Xóa khoản của “${deleteRequest.debtor}”?`,
        description: `${formatAmount(deleteRequest.amount)} sẽ bị xóa khỏi sổ tiền chia và không thể khôi phục.`,
        button: "Xóa khoản này",
      };
    case "debt-bulk": {
      const count = Array.isArray(deleteRequest.ids) ? deleteRequest.ids.length : 0;
      return {
        title: `Xóa ${count} khoản đã chọn?`,
        description: `${formatAmount(deleteRequest.amount)} trong các khoản đã chọn sẽ bị xóa và không thể khôi phục.`,
        button: `Xóa ${count} khoản`,
      };
    }
    default:
      return null;
  }
}
