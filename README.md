# Chia Bill đồ ăn

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
