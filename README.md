# Ai Ăn Nấy Trả

Webapp nhỏ để chia tiền bill GrabFood, beFood, ShopeeFood hoặc nền tảng khác.

## Mở webapp

- Bản online: <https://kdiemprimas.github.io/Diemvosharebill/>
- Bản local: chạy `npm start`, sau đó mở <http://127.0.0.1:4173>.

## Đọc bill từ ảnh

- Tải ảnh PNG, JPG hoặc WEBP lên ứng dụng.
- OCR tiếng Việt và tiếng Anh chạy trực tiếp trong trình duyệt bằng Tesseract.js.
- Kiểm tra bản xem trước “người → món → giá” rồi mới áp dụng vào bill.
- Ảnh không được gửi lên server và không được lưu trong `localStorage`.
- Bộ OCR WebAssembly và dữ liệu ngôn ngữ được phục vụ từ localhost; ảnh không phụ thuộc CDN.

## Quy tắc tính

- Mỗi món được gán cho một người hoặc chia đều cho cả nhóm.
- Phí giao hàng được chia đều cho tổng số người.
- Tổng khuyến mãi được chia đều cho tổng số người.
- Phần lẻ 1 đồng được phân bổ lần lượt để tổng tiền mọi người luôn khớp tổng bill.

## Xuất ảnh nợ có QR chuyển khoản

- Trong lịch sử, chọn người và năm rồi bấm “Xuất ảnh người này”.
- QR BIDV điền sẵn đúng tổng còn nợ trên ảnh, không cộng các khoản đã trả.
- Tổng bằng không hoặc âm sẽ không tạo QR yêu cầu chuyển tiền.
- QR điền sẵn nội dung “Tên con nợ tra no cho Tên chủ nợ ngay DD MM YYYY”, lấy ngày xuất ảnh. Nội dung dùng chữ không dấu, tối đa 50 ký tự; tên dài được viết gọn. Nếu có nhiều chủ nợ, ghi các tên khi đủ chỗ hoặc “cac chu no”.
- Khi xuất ảnh, ứng dụng gửi ngân hàng, số tài khoản nhận, tổng tiền và nội dung chuyển khoản (gồm tên và ngày xuất) tới [VietQR](https://vietqr.io/danh-sach-api/link-tao-ma-nhanh/) để tải QR; cần kết nối mạng. Chi tiết từng khoản không được gửi.
- Nếu không tải được QR trong 15 giây, ứng dụng báo lỗi để thử lại.

## Chạy local

Có thể mở `index.html` bằng một static server bất kỳ. Nếu đã có Node.js:

```bash
npm install
node server.mjs
```

Sau đó mở `http://127.0.0.1:4173`.

Không mở trực tiếp `index.html` bằng địa chỉ `file://`, vì trình duyệt sẽ chặn Web Worker của OCR.

Chạy kiểm thử phần tính tiền:

```bash
npm test
```

Tạo bản tĩnh dùng cho GitHub Pages:

```bash
npm run build
```

Dữ liệu bill được tự động lưu trong `localStorage` của trình duyệt.
