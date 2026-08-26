# FBO Designer

Extension VS Code để **xem** — và về sau **kéo thả thiết kế** — form FBO ngay trong IDE, thay
vì đọc `<item value="1100: [ma_kh].Label, [ma_kh]"/>` rồi hình dung trong đầu.

Quyết định tách repo và chia package: hub 4AI, `docs/adr/ADR-0002-fbo-designer-repo-split.md`.

## Hai package

| | Là gì | Luật |
|---|---|---|
| `core/` | Lõi thuần: encoding, offset/splice, đại số `item value`, render model → HTML | ESM `.mjs`, **runtime dependency = 0**, không import `vscode`, không chạm DOM, không ghi file |
| `extension/` | Vỏ VS Code: custom editor, webview, WorkspaceEdit | JavaScript trần, không bundler, không npm install |

Chiều phụ thuộc một chiều: `extension` → `core`. Không bao giờ ngược lại.

## Chạy

```bash
node core/test/run.mjs
```

Không cần `npm install` — đó là điều kiện, không phải sự tiện tay. Extension chạy bằng F5
(`Chạy FBO Designer (Extension Host)`), rồi trong cửa sổ mới gọi lệnh
`FBO Designer: Mở panel bám theo file đang mở`.

Hai cách xem, khác nhau đúng một chỗ — vẽ file nào:

| Lệnh | Vẽ file nào | Dùng khi |
|---|---|---|
| `Mở panel bám theo file đang mở` | file đang active, đổi tab thì đổi theo | sửa XML bên trái, nhìn form bên phải |
| `Mở designer gắn cứng vào file này` | đúng một document, không đổi | cần undo/redo và save của VS Code |

Đo lại hình học khi nghi preview lệch runtime:

```bash
node tools/probe-layout.mjs --serve
```

Nó dựng bản sao shell của webview thành trang tĩnh ở `http://localhost:7391/`, chạy được trong
trình duyệt thường nên đo được bằng devtools.

Mốc đối chiếu **đo trên trang runtime thật đã lưu** (`DevWorkFlow/.temp/`), không phải suy:
panel 575 ngoài · bảng 550 · mọi hàng 24px · ô nhập 13px · container 16px · ô Lookup 77px ·
nhãn canh **trái**. Danh sách đầy đủ ở `extension/media/base/README.md`.

## "Sao form trong Cursor nhìn nhỏ hơn trên web?"

Không phải form nhỏ đi — nó dựng đúng **573px CSS**, bằng đúng con số runtime đặt inline. Cái
khác nhau là **một px CSS được vẽ to bằng nào**:

| Nguồn tỉ lệ | Ở Cursor | Ở trình duyệt |
|---|---|---|
| `window.zoomLevel` (`Ctrl -` / `Ctrl +`) | áp cho cả webview | không có |
| zoom của trình duyệt (nhớ theo site) | không có | có |
| Windows scaling 125%/150% | có | có (khác nếu khác màn hình) |

Cách kiểm bằng số: nhìn dòng cuối thanh trạng thái của designer —
`1 px CSS = M px màn hình` — rồi mở F12 trên trình duyệt gõ `devicePixelRatio`. Hai số bằng
nhau thì hai bên đang vẽ cùng cỡ; lệch nhau thì đó chính là chênh lệch bạn đang thấy.

Muốn form to hơn mà không phải zoom cả cửa sổ Cursor: dùng nút **Tỉ lệ** trên thanh trên. Nó
chỉ đổi cách nhìn — thước blueprint vẫn ghi px khai trong XML.

## Debug mode

Ô **Debug** trên thanh trên mở một bảng ở vùng trạng thái:

| Bảng | Trả lời câu hỏi |
|---|---|
| Stylesheet | file nào đang nạp, nhúng thẳng hay qua URL, có nạp được không |
| Ảnh đang dùng | URL thật · **cỡ file** · cỡ ô vẽ · sprite cắt tại đâu |
| Ô đang chọn | token, cột/trải/px, class, file gốc, offset, HTML nguyên văn |

Bảng ảnh sinh ra từ một lỗi thật: icon Lookup hiện sai hình, và không có cách nào nhìn ra là
do `src` trỏ nhầm file hay do webview giữ ảnh cũ. Cột **cỡ file** đo bằng cách tải riêng từng
URL — `<img>` bị CSS ép cỡ nên nhìn trên màn hình không phân biệt được hai nguyên nhân đó.

Nút **Nạp lại tài nguyên** dựng lại shell với dấu phiên bản mới trên mọi URL. Bình thường
không cần: mọi tài nguyên đã mang `?v=<mtime>` và base pack thì nhúng thẳng với `url()` đã
viết lại. Nó là lối thoát cho trường hợp `mtime` không đổi mà nội dung đổi.

## Đóng gói .vsix

```bash
node tools/package-vsix.mjs
```

Ra `dist/fbo-designer-<version>.vsix`. Cài vào VS Code hoặc Cursor: Extensions → menu `…` →
*Install from VSIX…* (hoặc command palette → *Extensions: Install from VSIX…*), rồi reload.

Bộ đóng gói **không dùng `vsce`** — một `.vsix` chỉ là ZIP theo quy ước OPC, và `vsce` chỉ làm
thêm những việc dự án này không có (validate marketplace, xử lý dependency npm). Đổi lại giữ
được lời hứa không npm install.

Hai điều bộ đóng gói tự lo, đã trả giá mới biết:

- **Tên entry phải là `/`, không phải `\`.** `ZipFile::CreateFromDirectory` trên Windows
  PowerShell 5.1 đặt tên bằng `\`; gói vẫn mở được bằng Explorer nên nhìn tưởng xong, chỉ chết
  lúc cài. Nên phải nén theo danh sách entry đặt tên tường minh, và tự đọc lại central
  directory để kiểm.
- **`core/` được chép VÀO gói.** Khi cài từ `.vsix` thì không còn package anh em bên cạnh;
  `extension.js` thử đường dẫn trong gói trước, rồi mới tới đường dẫn repo.

## Đang ở đâu

**P1 — preview trung thực**, phần lớn đã chạy:

- **Kiểu render chọn theo gốc tài liệu**, không theo thư mục: `<dir>` (tức `Dir/` **và**
  `Filter/`) ra Form, `<grid type="Detail">` (tức `Grid/`) ra lưới Detail.
- Form dựng đủ khung dialog của runtime — bảy lớp `UpdateDlg*` và thanh tiêu đề (có icon,
  có gradient). Bỏ lớp nào là form hụt đúng bằng viền/padding của lớp đó; phép cộng
  573 → 570 → 553 ⊇ 550 ghi trong `core/src/render.mjs`.
- **CSS nền là CSS runtime THẬT**, chép nguyên văn từ một trang FBO đã lưu, không phải bản
  mô phỏng — xem `extension/media/base/README.md`. Luật của nó: không thêm rule nào runtime
  không có.
- Dải nút đáy dialog cố ý không dựng: nút nào hiện là do ngữ cảnh runtime quyết, `<view>`
  không khai gì về chúng.
- Control thật: checkbox, select, textarea, ô Lookup có icon, ô readOnly dùng đúng bộ class
  disabled của runtime.
- **Phân giải entity** đầy đủ — parameter entity, marked section `<![%X;[…]]>`, first-wins.
  Hàng đến từ Include được đánh dấu khoá; bấm vào thì nhảy về đúng `&Name;` trong file đang
  mở (Alt-click nếu muốn mở hẳn file Include).
- Tài nguyên program (`Css`, `Images`, `ClientScript`) suy từ chính file đang mở.
- Base pack CSS rồi tới CSS của program, đúng thứ tự runtime.
- **Blueprint overlay**: thước px, vạch cột theo list px ở `views > item` dòng 1, khung slot.
  Vẽ đè, `pointer-events:none` — tắt đi thì DOM của form không đổi một thuộc tính nào.

Còn thiếu ở P1: tabs/categories, vùng footer (`categoryIndex="-1"`), Grid nhúng trong Form
(`itemsStyle="Grid"`), toolbar. DOM của lưới chưa đối chiếu được với HTML runtime thật —
bề rộng và thứ tự cột thì đọc thẳng từ XML nên đúng, phần chrome quanh lưới còn là ước lượng.

Lộ trình tiếp: **P2** sửa qua property panel → **P3** kéo thả (slot của blueprint đã là đơn vị
thả) → **P4** tabs/toolbar.

Hai câu hỏi spike của P0 vẫn chưa có câu trả lời ghi lại (`docs/P0-QUESTIONS.md`). Câu 1 —
Windows-1258 qua `CustomTextEditorProvider` — phải trả lời **trước P2**, vì P2 là lúc bắt đầu
ghi file.

## Ba điều phải biết trước khi sửa code

**1. Đặc tả nằm ở hub, không nằm ở đây.** `assets/skills/erp/erp-view-design/references/` của
4AI (`reference-item-value.md`, `reference-render-pipeline.md`) là **nguồn thật**; `core/` là
bản cài đặt. Lệch nhau thì sửa code — trừ khi phát hiện đặc tả sai so với corpus, khi đó sửa
đặc tả trước rồi mới sửa code.

**2. Ghi ngược luôn là splice lên văn bản gốc.** Không bao giờ parse-rồi-serialize-lại cả
file. Nguồn FBO có thể là Windows-1258 + CRLF + BOM; serialize lại là viết đè UTF-8 LF ngay
lần lưu đầu, và hỏng im lặng. Mọi phép sửa layout trả về `{ model, splices }`; ai ghi là việc
của `extension/`.

**3. Ô đến từ file entity thì khoá.** `&Name;` trong `item value` nghĩa là layout đó dùng
chung nhiều controller — sửa tại controller là sửa cho tất cả. Designer khoá và chỉ sang file
entity; muốn đổi thì phải đo `used_by` trước (tool `4ai-fbo` của hub).

## Quan hệ với DevWorkFlow

DevWorkFlow (`Development/DevWorkFlow`) đã làm cùng bài toán bằng WPF + WebView2, toàn bộ bằng
C#. Ở đây **không port code** — chỉ đối chiếu ngữ nghĩa khi nghi ngờ, và `docs/04-DESIGNER_PLATFORM.md`
bên đó có mục *Trạng thái thực tế* ghi rõ chỗ doc đã lệch code, nên đọc kèm cảnh giác.

## Quy ước

Văn xuôi **tiếng Việt**, identifier và tên module **tiếng Anh** — cùng quy ước với hub 4AI.
File sinh ra: UTF-8 không BOM, LF. File nguồn FBO đọc vào: giữ nguyên y hệt.
