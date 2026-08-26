# P0 — hai câu hỏi, và chỗ ghi câu trả lời

P0 không phải "làm bản đầu tiên cho đẹp". P0 là **trả lời hai câu hỏi có thể giết cả phương
án**, càng sớm càng rẻ. Cả hai đều không đoán được từ tài liệu; phải chạy trên máy thật.

Trả lời xong thì điền thẳng vào file này (kèm ngày, phiên bản VS Code) và ghi kết luận vào
CHANGELOG. Câu 1 nếu ra "không" thì phải viết ADR mới trước khi viết thêm dòng code nào.

---

## Câu 1 — VS Code có giữ được Windows-1258 + CRLF không?

**Vì sao hỏi.** `CustomTextEditorProvider` giao quyền decode/encode file cho VS Code. Nếu VS
Code lưu lại thành UTF-8, ta phá file nguồn của khách ngay lần lưu đầu — và phá **im lặng**,
vì trên màn hình vẫn hiện đúng tiếng Việt.

**Được gì nếu "có".** Undo/redo, dirty state, save, hot exit, diff trong SCM, split view XML ↔
designer — tất cả của VS Code, không phải viết. DevWorkFlow phải tự viết Command/Undo stack vì
WPF không cho không thứ đó.

**Phải làm gì nếu "không".** Bỏ CustomTextEditor, dùng webview panel tự quản file I/O bằng
`core/encoding.mjs`, và **tự viết undo stack**. Đắt hơn hẳn — nên mới phải biết trước.

**Cách chạy.** F5 → trong cửa sổ Extension Host, gõ lệnh
`FBO Designer: Spike P0 — thử vòng Windows-1258 qua VS Code`. Nó tạo file 1258 thật, mở bằng
API thật, chèn một dòng tiếng Việt, lưu, rồi đọc lại **byte** và so.

Ba kết cục, và cái ở giữa mới là cái phải sợ:

| Kết cục | Nghĩa là |
|---|---|
| Giữ nguyên 1258 cả cũ lẫn mới | Đi tiếp bằng CustomTextEditor |
| **Cũ 1258, mới UTF-8** | Hỏng kiểu LAI — mở lại vẫn thấy bình thường ở chỗ cũ, chỉ hỏng chỗ vừa sửa. Tệ nhất |
| Ghi đè hết thành UTF-8 | Tự quản I/O + tự viết undo |

**Trả lời:**

- Ngày:
- VS Code:
- `files.encoding` lúc thử:
- Kết quả (dán từ Output "FBO Designer"):
- Kết luận:

---

## Câu 2 — CSP của webview có nạp được CSS thật của FBO không?

**Vì sao hỏi.** DevWorkFlow trỏ CSS và ảnh qua *virtual host* của WebView2
(`devworkflow.program`, `devworkflow.config` map vào Program root và Config root). Webview của
VS Code **không có** cơ chế đó — phải `asWebviewUri()` từng file và khai `localResourceRoots`,
kèm một CSP đủ chặt mà vẫn cho ảnh và font đi qua. Hai gốc, không phải một: Config root là chỗ
chứa ảnh của CSS pack (`image/fbo-*.png`, `Toolbar.gif`).

Không có CSS thật thì preview vẫn *đúng cấu trúc* nhưng không *giống runtime* — mà cả tầng
designer dựng trên nguyên tắc "cái nhìn thấy lúc thiết kế là cái runtime chạy".

**Cách chạy.** Khai trong settings:

```json
"fboDesigner.programRoot": "D:\\...\\<program>",
"fboDesigner.configRoot": "D:\\...\\<config>",
"fboDesigner.stylesheets": ["D:\\...\\<program>\\Css\\...css"]
```

Mở một file `Dir/*.xml` bằng `FBO Designer: Mở designer cho file này`. Dải trạng thái dưới
cùng báo `CSS thật: n/m nạp được`; file nào trượt thì tên hiện trong Output.

**Trả lời:**

- Ngày:
- CSS khai / nạp được:
- File trượt và lý do (CSP? ngoài localResourceRoots? `url()` trỏ ra ngoài?):
- Ảnh trong CSS có hiện không:
- Kết luận:

---

## Cái P0 CỐ Ý chưa làm

Ghi ra để không ai tưởng là thiếu sót:

- Tabs/categories, vùng footer (`categoryIndex="-1"`), Grid nhúng (`itemsStyle="Grid"`) — P1.
- Phân giải entity xuyên file. P0 chỉ **đánh dấu** hàng có `&…;` và khoá lại; render nội dung
  thật của entity là P1.
- Sửa gì cũng chưa: P0 chỉ đọc. Vòng `edit → splice → WorkspaceEdit → render lại` là P2.
- Kéo thả: P3. `core.setSpan` đã có và đã test — đó là nguyên thuỷ đầu tiên, cố ý làm trước để
  chứng minh hình dạng của tầng layout, không phải để dùng ngay.
