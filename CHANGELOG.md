# Changelog

Định dạng dựa trên [Keep a Changelog](https://keepachangelog.com/).

## [Chưa phát hành]

### Sửa — Email Designer: format số mẫu, lỗi SQL, `{!in_words}`

- Khi SQL mẫu lỗi: hiện dialog error overlay (không chỉ toast).
- `detail`/`footer`: lấy bảng **cuối** resultset nếu là `field`/`format`, áp mặt nạ số
  (`formatNumber`) trước khi đổ JSON.
- Template có `{!in_words}` → gọi `dbo.FastBusiness$Function$System$ReadCurrency(ma_nt, t_tt_nt, language)`.

### Thêm — Email Designer: lấy dữ liệu mẫu thật từ chứng từ (`stt_rec` + `contactID`)

- Nối core `mail-sample.mjs` vào giao diện «Dữ liệu mẫu»:
  - Ô nhập `stt_rec` / `contactID` + nút «Lấy từ chứng từ» trên panel.
  - Hộp thoại xác nhận trước khi ghi dòng tạm vào `dmxn`.
  - Host `extension/src/mail-sample-host.js`: stub → probe bảng → master/detail/footer qua
    `sqlcmd`, gom thành JSON mẫu (`mailSampleFromRows`), bật xem trước.
  - Nhớ `stt_rec`/`contactID` theo file × action trong `workspaceState`.
- Hợp đồng webview: thông điệp `loadMailSample`.
- Test: `core/test/test-mail-sample.mjs` (`mailSampleFromRows`), `test-mail-design-contract.mjs`,
  `extension/test/test-mail-sample-host.mjs`.

### Thêm — Email Designer: dựng SQL cho «Dữ liệu mẫu» thật (core)

- `core/src/mail-sample.mjs` + `mail-template.mjs#readMailReportCommands`: từ một `stt_rec` +
  `contactID` người dùng gõ, dựng ba câu SQL để lấy dữ liệu mẫu THẬT cho mail — thay `master`/`detail`/
  `footer` của chính `<action><query id="report">` trong Message.xml (khác `<header>/<detail>/<footer>`
  của `<body>`, đó là khung HTML mẫu).
  - `buildMailTableProbe`: câu DÒ chỉ đọc, tra `dmct9` bằng `ma_ct` (ba ký tự cuối `stt_rec`) ra tên bảng
    master/detail thật — cần vì `action@table` trong Message.xml chỉ là tiền tố chia kỳ còn thiếu số kỳ
    (`m91$000000`), và một bản xem trước bắt đầu từ `stt_rec` bất kỳ không thể giả định "kỳ hiện tại"
    như `grid-sample.mjs` làm cho lưới.
  - `buildMailSampleStub`: câu GHI duy nhất ở đây — một dòng đánh dấu tạm vào `dmxn` (idempotent: xoá
    trước, chèn sau) để câu `master` join được dù chứng từ chưa từng gửi nhắc cho `contactID` đó. Tầng vỏ
    PHẢI hỏi xác nhận trước khi chạy, cùng luật đã áp cho nhánh lưới báo cáo.
  - `buildMailSampleSelect`: thay `@@table`/`@@contactID`/`@@stt_rec` bằng giá trị thật (`@@table` của
    `master`/`footer` là bảng master, của `detail` là bảng detail), dùng lại `substituteParams` của
    `grid-sample.mjs`.
  - `mailSampleFromRows`: gom dòng SQL thành JSON mẫu cho bản vẽ.
  - Test: `core/test/test-mail-sample.mjs`, cộng thêm ở `core/test/test-mail-template.mjs`.

### Sửa — Email Designer: biến trong <detail>, và bấm trúng biến

- **`<fields>` không còn áp vào `<detail>`**: trong dòng mẫu, `{!so_luong}` là GIÁ TRỊ của dòng chứ không
  phải tiêu đề cột "Số lượng". Trước đây designer thay nhãn ở cả hai vùng nên dòng dữ liệu hiện ra một dãy
  tiêu đề (corpus FBISP24: 22 chỗ).
- **Bấm vào một biến trên bản vẽ** đưa con trỏ XML tới đúng `{!tên}` đó, không còn dừng ở thẻ `<td>` chứa nó.

### Thêm — Email Designer: bám XML theo mẫu, chế độ xem trước, combobox có nút sổ

- **Con trỏ XML sang mẫu (hoặc biến thể) khác** → designer đổi mẫu theo rồi chọn phần tử dưới con trỏ.
- **Chọn mẫu khác trên designer** → XML đang mở nhảy tới thẻ mở `<action id="…">` của mẫu ấy.
- **Bỏ tick «Xem trước»**: ô chế độ hiện biến có sẵn lựa chọn «Xem trước: dữ liệu mẫu» — chính là bản xem
  trước đầy đủ, chỉ đọc.
- **Combobox mẫu mail thêm nút `▾`** để sổ nhanh toàn bộ danh sách; gõ để tìm vẫn như cũ.

### Thêm — Email Designer: xem trước đầy đủ, kiểm tra mẫu, hoàn thiện

- **«Xem trước»**: vẽ cả mẫu với dòng mẫu detail nhân theo `detail` của dữ liệu mẫu — chỉ đọc, cùng
  iframe sandbox và cùng khử độc với bản vẽ thiết kế.
- **«Kiểm tra mẫu»** + huy hiệu trên thanh công cụ: thẻ bị chặn, `on*`, ảnh thiếu `src`/`alt`/`width`,
  liên kết rỗng, CSS mail client không đỡ (`flex`, `grid`, `position`, `float`, ảnh nền), mẫu vượt ngưỡng
  Gmail cắt thư (102KB). Bấm một vấn đề để chọn phần tử (`core/src/mail-lint.mjs`).
- **Bề rộng khung**: vừa cửa sổ / 600px / 375px, nhớ theo webview.
- **Phím tắt**: `Alt+↑/↓` di chuyển, `Ctrl+Shift+↑/↓` chọn cha/con, `F2` sửa chữ.
- **Rút gọn giao diện**: bỏ palette bên trái, nút «Hoàn tác»/«Làm lại», ô «Đi tới XML», mục «Cấu trúc»,
  mục «Biến trong mẫu», mục «Bảng» và mục «Chữ»; gộp «Thuộc tính HTML» + «Style inline» thành một mục
  «Định dạng». Sửa nội dung chữ và phép cột/dòng bảng không còn lối vào trên designer. Di chuyển dùng `Alt+↑/↓` hoặc kéo thả, xoá dùng `Del`, hoàn tác dùng `Ctrl+Z`/`Ctrl+Y`,
  mở XML dùng `Ctrl+click`. Chèn component và bọc liên kết tạm thời không còn lối vào trên giao diện.
- Designer nhớ kết quả bung entity khi Message.xml và các Include không đổi; lỗi lúc vẽ hay khi xử lý
  thao tác hiện ra (kèm Output) thay vì làm designer đứng hình; lượt vẽ chậm được ghi ra Output.

### Thêm — Email Designer: Code ↔ Designer, phép bảng trong designer

- **«Bám XML»** (bật mặc định): chọn phần tử trên designer thì vùng chọn của XML đang mở nhảy tới thẻ
  mở của nó; đặt con trỏ trong XML thì designer chọn phần tử sâu nhất chứa con trỏ. Không lấy focus,
  không mở tab; hai chốt chặn vòng lặp (bỏ sự kiện do chính designer sinh ra, không gửi lại khi trúng
  phần tử đang chọn).
- **File Include đổi trên đĩa** (không mở trong VS Code) → designer vẽ lại, nhờ watcher theo từng file
  góp nội dung vào mẫu.
- **Mục «Bảng»**: đổi bề rộng cột, nhân bản cột, nhân bản dòng header/footer ngay trong designer — dùng
  lại nguyên phép bảng của «Xem mail».
- Core: `mailElementAtSource` (con trỏ nguồn → phần tử), `mailTableContext` (phần tử → số thứ tự cột/dòng).
- Corpus FBISP24: khứ hồi nguồn → phần tử 1810/1810 với phần tử trong CDATA.

### Thêm — Email Designer: biến `{!tên}` và dữ liệu mẫu

- **Ba chế độ hiện biến** trên bản vẽ — nhãn (như runtime), `{!tên}` (chip), dữ liệu mẫu. Chỉ đổi bản
  vẽ; Message.xml giữ nguyên `{!tên}`. Token trong thuộc tính (`href="{!alink}&n=1"`) chỉ thay bằng chữ,
  không bao giờ thành thẻ.
- **Biến trong mẫu**: danh sách nhãn/dữ liệu kèm số lần; bấm để chèn `{!tên}` vào ô Chữ hoặc
  `href`/`src`/`alt`/`title` đang soạn.
- **Dữ liệu mẫu** JSON phẳng + `detail: [...]`, lưu ở workspace state theo file × mẫu — không bao giờ ghi
  vào mẫu. «Tạo khung từ biến», JSON sai hiện lý do ngay dưới ô.
- `core/src/mail-variables.mjs`: quét token theo ngữ cảnh, gom biến, kiểm dữ liệu mẫu, patch bản vẽ.
- Corpus FBISP24: 1528 biến; ba chế độ không lệch phần tử; điền đủ khung → không còn chip nào.

### Thêm — Email Designer: chèn component, xoá, di chuyển, kéo thả

- **Palette** bên trái: Chữ, Tiêu đề, Ảnh, Liên kết, Nút, Đường kẻ, Khoảng trống, Khung chứa, Phần,
  Hai cột, Bảng — kéo thả vào mẫu hoặc bấm để chèn cạnh phần tử đang chọn. HTML sinh ra theo luật
  mail: style inline, bố cục bằng bảng, nút «bulletproof» (`core/src/mail-components.mjs#componentHtml`).
- **Cấu trúc** trong bảng thuộc tính: ▲ Lên / ▼ Xuống (đổi chỗ với anh em liền kề), **Xoá** (cả phím
  Delete; hỏi xác nhận theo `fboDesigner.confirmDelete`), chèn trước/sau/vào cuối, **bọc liên kết** cho ảnh.
- **Kéo phần tử đang chọn** để di chuyển — vạch chỉ chỗ thả; không vượt part (header/detail/footer),
  không giữa hai file nguồn.
- `core/src/mail-structure.mjs`: `planMailRemove`, `planMailMove`, `planMailInsert`, `planMailWrapLink` —
  mỗi kế hoạch trả `selectId` để khung chọn đi theo đúng phần tử sau khi id dồn số.
- `<table>` nằm trọn trong một part giờ là khối (xoá/di chuyển được cả bảng).
- Phím Delete trong ô nhập của bảng thuộc tính xoá ký tự, không xoá phần tử.
- Corpus FBISP24: khứ hồi xoá 68/68, lên 64/64, chèn chữ 68/68, chèn nút 34/34, kéo thả 31/31.

### Thêm — Email Designer: bảng thuộc tính theo loại component, sửa thuộc tính HTML

Bấm một phần tử là bảng thuộc tính hiện đúng nhóm ô của **loại** nó — ảnh (`src`, `alt`, `width`,
`height`, `align`, link của `<a>` bao ngoài), nút/liên kết (`href`, `target`, màu, nền, đệm, bo góc,
căn lề ở khối chứa), đường kẻ, khoảng trống, khung chứa (`width`, `bgcolor`, `align`, `valign`…).
Loại được SUY RA từ thẻ + style + nội dung (`core/src/mail-components.mjs`); phép ghi vẫn theo
whitelist theo thẻ.

- Phép mới `setAttr` (`core/src/mail-edit.mjs#planMailAttr`): đặt/đổi/xoá một thuộc tính; giá trị kiểm
  theo kiểu (`isValidAttrValue` — `width="600px"` bị chặn), ghi nguyên văn (`href="{!alink}&n=1"`
  khứ hồi y hệt), thuộc tính không nháy ghi lại có nháy.
- Thuộc tính do entity sinh ra bị khoá kèm lý do (`attrLocks`).
- Corpus FBISP24: `setAttr` khứ hồi 102/102 (27 vào file Include).

### Thêm — Email Designer cho `Options/Message.xml` (MVP)

Mở mẫu mail bằng *Open With… → FBO Email Designer* hoặc lệnh **Mở Email Designer (Options/Message.xml)**:
chọn mẫu/biến thể trên thanh công cụ, bấm phần tử trên bản xem để chọn, sửa **chữ** và **style
inline** ở bảng thuộc tính. Ghi thẳng vào XML qua `applySplice`; Ctrl+Z trong designer lùi bằng
chồng hoàn tác chung với designer form. Kiến trúc và số đo trên corpus: `docs/EMAIL-DESIGNER.md`.

- `core/src/mail-design-contract.mjs` — hợp đồng webview ↔ host: vai trò phần tử, bảng op,
  whitelist style/thuộc tính, `validateMailMessage` (bỏ mọi trường lạ — webview không gửi được toạ
  độ nguồn), `isSafeCssValue`/`isSafeUrl`.
- `core/src/mail-html.mjs` — dòng HTML ghép từ header/detail/footer theo MẢNH (`cdata` sửa được,
  chữ do `&Entity;` bung ra thì chỉ đọc), tokenizer theo span, chỉ mục phần tử kèm `caps` (lý do khi
  không sửa được), bản vẽ đã làm sạch (`script`/`on*`/URL `javascript:`/`data-fbo-*` giả) gắn
  `data-fbo-el`, `mapMailEdits` quy edit về đúng file nguồn.
- `core/src/mail-edit.mjs` — `planMailText` (HTML-escape, `{!token}` nguyên văn, giữ thụt lề),
  `planMailStyle` (một khai báo trong `style="…"`, không bao giờ sửa class dùng chung).
- `extension/src/mail-designer-editor.js` — custom text editor `fboDesigner.mail`: dựng lại từ văn
  bản hiện tại mỗi lần sửa, so `rev` + dấu vân tay phần tử, vẽ lại một lần khi document/Include đổi.
- `extension/src/mail-apply.js` — quy toạ độ và mở XML dùng chung với panel «Xem mail».
- `extension/media/mail-designer.{js,css}`, `mail-shell.html` — mẫu vẽ trong iframe sandbox không
  script; chọn/hover bắt ở lớp phủ trang cha qua `elementFromPoint`.
- Chạy trên `FBISP24/…/Options/Message.xml`: 39 biến thể, 1874 phần tử, sửa khứ hồi chữ 68/68 và
  style 68/68 (36 edit rơi vào file Include).
- Chưa có: thêm/xoá/di chuyển, biến và dữ liệu mẫu.

### Sửa — xem dữ liệu thật lưới chi tiết: `@@whereClause` không ghép alias bảng

`where stt_rec = '…'` thay cho `where a.stt_rec = '…'` — dạng đã kiểm chạy đúng trên program thật.
Test cập nhật theo (`core/test/test-grid-sample.mjs`, `extension/test/test-sample-host.mjs`).

### Đổi — bỏ "tính năng ẩn" (dev mode), gỡ mục lục/F12/hover, chế độ soi bật/tắt qua cấu hình

Ba tính năng dời sang extension XML khác đang đảm nhận: **mục lục** (`Ctrl+Shift+O`), **F12** /
`Ctrl+click` trong editor văn bản, và **hover** (cả hover field/dữ liệu thật lẫn hover Path/copy/
Content của chế độ soi). Gỡ cả ba khỏi extension này — giữ lại của người khác làm tốt hơn, không
giữ hai bản làm cùng một việc.

- Xoá hẳn `extension/src/symbol-host.js`, `extension/src/definition-host.js` và test tương ứng.
- `language-host.js` chỉ còn gợi ý (completion) — `fieldHover`/`registerHoverProvider` gỡ hết.
  Field/entity của FBO đến từ cây Include đã bung, không extension XML chung nào biết, nên gợi ý
  ở lại.
- `insight-host.js` gỡ hoverMessage trên vệt `&Name;`, gỡ toàn bộ máy dựng hover (`appendNode`,
  `hoverFor`, `copyLink`, lệnh `fboDesigner.insightCopy`) — vệt + chú giải một dòng vẫn y nguyên.
  Theo đó, `core/src/insight.mjs` bỏ luôn cây Include lồng (`children`/`raw`,
  `buildNestedTree`/`mergeNested`/`unresolvedNested`) — dựng ra CHỈ để nuôi hover, hover mất thì
  cây ấy thành mã chết.
- Xoá `extension/src/dev-features.js`, cờ `extension/dev-features.flag`, và cờ `--dev` của
  `tools/package-vsix.mjs` — không còn khái niệm "bản dev mang thêm tính năng". Chẩn đoán, gợi ý,
  chế độ soi giờ LUÔN đăng ký trong `extension.js`, không qua `if (devFeaturesEnabled(...))`.
- **Thêm** cấu hình `fboDesigner.showInsight` (mặc định BẬT) thay cho việc chế độ soi cứng luôn
  bật không tắt được — `registerInsight` nghe `onDidChangeConfiguration`, đổi trong Settings thấy
  hiệu quả ngay, không cần mở lại file.

### Đổi — chế độ soi LUÔN BẬT, chú giải MỘT DÒNG neo ngay sau `&Name;`, bỏ hẳn bản clear text

Dùng thật trên một chương trình thật lộ ra ba việc bản trước làm sai:

1. **Phải bấm mới thấy.** `Ctrl+Alt+E` bắt người dùng nhớ một phím tắt cho một thứ lẽ ra nên có
   sẵn — họ mở file controller là muốn thấy `&Name;` bung ra cái gì NGAY, không phải bật lên rồi
   mới bật.
2. **Bật lên lại mở một tài liệu khác** (bản clear text, scheme `fbo-insight:`) — đúng thứ người
   dùng gọi là "tự bật một file khác" mỗi lần bấm. Họ chỉ cần đọc được nội dung NGAY TRÊN file
   đang sửa, không cần đổi bề mặt nào.
3. **Chú giải nhiều dòng đọc sai chỗ.** Nhiều file FBO thật có nhiều thứ trên cùng một dòng với
   entity — `]]>&Name;<![CDATA[` (đóng CDATA, chèn Include, mở CDATA lại) — và chú giải neo ở
   CUỐI DÒNG (`layoutAnnotations`) làm mũi tên trông như thuộc về cả dòng `]]>&Name;<![CDATA[`
   chứ không phải riêng `&Name;`.

Sửa cả ba bằng một thay đổi: **bỏ hẳn công tắc, bỏ hẳn bản clear text, chú giải LUÔN MỘT DÒNG
neo NGAY SAU `&Name;`**.

- `registerInsight` không còn `on`/`toggle`/`setMode` — vẽ NGAY lúc đăng ký (`paintAll()`) và mỗi
  khi editor active đổi/file lưu/gõ chữ (debounce cũ giữ nguyên). Không có gì để tắt.
- Gỡ TOÀN BỘ cơ chế bản clear text: `CLEAR_SCHEME`, `clearUriFor`/`sourceOfClearUri`,
  `contentProvider` (`TextDocumentContentProvider`), `definitionProvider` riêng cho scheme ấy,
  `openInsight`/`closeInsight`/`closeTextTab`/`restoreTextTab`, `tabsFor`/`needsTextTab`, bảng
  `insights` (fsPath → tab đang mở), và toàn bộ tô khối (`blockDecorationTypes`, `blockHover`,
  `paintBlocks`/`collectBlocks`). Lệnh `fboDesigner.toggleInsight` và phím `Ctrl+Alt+E` gỡ khỏi
  `package.json`.
- `layoutAnnotations` (`core/src/insight.mjs`) — cả hệ thống xếp chú giải nhiều dòng (không lấn
  tham chiếu kế tiếp, căn cột, giữ thụt lề) — gỡ khỏi core: chú giải giờ chỉ là MỘT decoration
  mang `ref.inline` (đã cắt sẵn ở `inlineMax`), neo vào một dải RỖNG NGAY SAU `ref.end` — không
  còn multi-decoration-mỗi-dòng, không còn tính cột, không còn trần `maxLines`.
- Hover (Path/copy/Content, đệ quy vào Include lồng — mục ngay trên) vẫn y nguyên, chỉ đổi chỗ
  neo giống annotation: dải `&Name;`, không phải khối clear text.
- `language-host.js` (`registerLanguageFeatures`) không còn tự hover `&Name;` (`entityHover` gỡ
  hẳn) — chế độ soi giờ LUÔN chạy nên hover của nó đã đủ (và đầy hơn: Path/copy/Content). Hai
  provider cùng trả lời một chỗ trước đây xếp CHỒNG lên nhau thành hai thẻ nói cùng một chuyện
  ("Path hover đang bị lặp lại") — `provideHover` giờ chỉ còn trả lời `field`.

### Thêm — hover chế độ soi: Path, nút copy, Content — đệ quy vào Include lồng

Hover của một `&Name;` (trên file XML) và của một khối (trên bản clear text) nay dựng theo cùng
MỘT cấu trúc: **Path** (nguồn), hai nút copy, rồi **Content**. Dùng chung một hàm (`appendNode`
trong `insight-host.js`) cho cả hai bề mặt, nên sửa một chỗ là cả hai cùng đổi.

Hai nút chép **hai thứ khác nhau**:

- **XML gốc** (`raw`, mới thêm vào `buildEntityInsight`) — nguyên văn khai báo TRƯỚC khi entity
  con của nó được thay: `&Name;` con còn nguyên văn. Với SYSTEM là nguyên văn file trước khi bung
  tiếp; với inline là chính chuỗi trong nháy.
- **Đã phân giải** (`value`, đã có sẵn) — bản bung hết, đúng thứ runtime nhận.

Bấm nút chạy lệnh MỚI `fboDesigner.insightCopy` qua `command:` link trong Markdown (`isTrusted`).
Link chỉ mang **địa chỉ** — `{hostFile, refIndex, path, kind}` — không nhồi nguyên văn nội dung
vào URI: nội dung đọc LẠI đúng lúc bấm (qua `insightFor`, có nhớ), nên luôn khớp với file hiện
tại thay vì một bản chép sẵn từ lúc vẽ hover.

Nếu nội dung một `&Name;` **lại chứa `&Name;` khác** (Include lồng trong Include) — hover xử lý
tương tự như ở ngoài XML, đệ quy: `core/src/insight.mjs` nay dựng thêm `children` trên mỗi
tham chiếu (và trên mỗi node lồng), tìm bằng cách DUYỆT `segments` như một phép duyệt trước —
đoạn nào đổi `file` là một lần NHẢY, vào một Include chưa từng gặp ở tầng ngoài (`ancestors`)
thì là con mới, gặp lại một file đã ở tầng ngoài thì là QUAY VỀ chứ không phải lồng thêm. Tên
entity của mỗi lần nhảy dò lại bằng regex tại đúng vị trí `cursor` trong văn bản file cha, vì
`segments` không giữ tên ấy (khung ngoài ghi đè khung trong, xem `entities.mjs`). Con
`unresolved`/`empty` (không gây một lần nhảy nào, vì không sinh chữ) dò riêng bằng cách quét lại
chính văn bản đó, rồi GHÉP LẠI theo đúng thứ tự xuất hiện với con đã tìm bằng segments.

`appendNode` đệ quy vào `children`, lùi mỗi tầng bằng một lớp blockquote (`> `) — VS Code vẽ nó
thành khung viền trái, nên Include càng lồng sâu càng thụt vào, đúng hình cây. Trần 4 tầng.

Trên bản clear text, mỗi Include lồng còn được tô MỘT KHỐI RIÊNG (`paintBlocks`/`collectBlocks`
đệ quy vào `node.children`), mang màu riêng — dùng lại đúng bảng màu/`groupFor` của tham chiếu
ngoài XML (file trùng thì màu trùng), nhưng KHÔNG cộng vào bộ đếm `groups[i].refs` của nó: đếm đó
là đếm tham chiếu NGOÀI XML, một luật khác không được lẫn với việc gán màu cho include lồng.

### Thêm — chú giải NHIỀU DÒNG vẽ đè lên chính file gốc

`&SharedFields;` bung ra bốn chục dòng, mà chú giải của editor chỉ vẽ được một dòng — VS Code cắt
`contentText` ở dòng đầu trước cả khi dựng CSS. Đó là hằng số, không lách được.

Lách được là chuyện khác: dùng NHIỀU decoration, mỗi dòng một cái. Dòng thứ nhất của bản bung treo
lên chính dòng có `&Name;`, dòng thứ hai treo lên dòng KẾ TIẾP của file, và cứ thế. Không chèn
dòng nào vào file, không sửa gì — chỉ vẽ vào phần trống bên phải. File vẫn gõ được, vẫn `Ctrl+F`
được; tắt chế độ là chữ vẽ biến mất.

Phần xếp chỗ nằm ở `layoutAnnotations` (`core/src/insight.mjs`) — thuần, nên ba luật dễ sai nhất
kiểm được bằng node trần:

1. **Không lấn sang tham chiếu kế tiếp.** Trần dưới của một khối là dòng của `&Name;` KẾ TIẾP —
   kể cả một tham chiếu một dòng chen giữa, vì nó cũng cần chỗ của nó. Hết chỗ thì cắt và nói ra
   `… (+N dòng)`: một khối im lặng dừng giữa chừng trông y hệt một khối đủ.
2. **Căn thành cột.** Chú giải bắt đầu ngay sau chữ của dòng, mà các dòng dài ngắn khác nhau, nên
   không đệm thì khối răng cưa và đọc không ra là một khối. Đệm tính theo dòng DÀI NHẤT của khối.
   Kéo theo: tầng vỏ phải bật `white-space: pre` (qua `textDecoration`, khoá duy nhất VS Code chép
   nguyên văn vào CSS), nếu không CSS gộp khoảng đệm về một dấu cách.
3. **Giữ thụt lề tương đối.** Bỏ đúng phần lề CHUNG của bản bung, giữ phần còn lại — cắt sạch là
   mất cấu trúc lồng nhau, thứ người ta mở chế độ soi ra để nhìn.

Trần 40 dòng cho một tham chiếu: một Include bốn trăm dòng mà vẽ hết là phủ kín cả file, và phần
còn lại đã có bản clear text.

Tầng vỏ nay vẽ HAI lượt trên file XML — vệt neo vào dải `&Name;` (có viền, nền, hover), chú giải
neo vào CUỐI từng dòng bằng một dải RỖNG (không viền không nền, chỉ chữ). Chú giải dùng MỘT kiểu
trang trí duy nhất cho mọi màu: màu khai được ở từng mục (`renderOptions.after.color`), khác viền
và nền vốn chỉ khai được ở tầng kiểu.


### Đổi — bản clear text mang ĐÚNG tên file gốc (`SOTran.xml`, không phải `SOTran.cleartext.xml`)

Tab nay đọc đúng `SOTran.xml`, breadcrumb đúng thư mục: uri của bản clear text giữ y nguyên đường
dẫn của file gốc và chỉ đổi `scheme` (`fbo-insight:` thay `file:`).

Vì sao không dùng thẳng `file:` — ghi lại một lần cho khỏi phải hỏi lại: trong VS Code URI CHÍNH
LÀ danh tính của nội dung, và `file:` đã có chủ (đúng dãy byte trên đĩa). Không có API nào bảo
editor «mở file này nhưng hiện chữ khác»: `TextDocumentContentProvider` và `FileSystemProvider`
đều chỉ đăng ký được cho scheme riêng; decoration không chèn được dòng; `CustomTextEditorProvider`
gắn được vào chính `file:` nhưng là webview, tức mất Ctrl+F, mất chỉ đọc có thông báo, mất
Ctrl+click. Đường duy nhất để chữ nằm TRONG file gốc là GHI vào nó — việc ấy đã có sẵn ở
`entityEditTarget: inline`, và nó là một phép SỬA chứ không phải một chế độ xem.

Kéo theo: ngôn ngữ phải khai bằng `languages.setTextDocumentLanguage(doc, 'xml')` chứ không trông
vào đuôi file nữa. Một nửa số controller FBO là `Dir/X.f` — bản chuẩn sản phẩm — mà VS Code không
biết `.f` là gì, nên thiếu chốt này thì bản đã bung của chúng hiện ra một khối chữ xám.

Và `tabsFor` nay phải so CẢ SCHEME, không chỉ đường dẫn: hai tab của cùng một file giờ chỉ khác
nhau ở đó.


### Đổi — bản clear text là TÀI LIỆU VĂN BẢN, không phải webview

Webview vẽ đúng hình nhưng mất ba thứ mà một bản để ĐỌC không được phép thiếu:

  `Ctrl+F`     webview không có tìm-trong-file của editor. Đây là lý do quyết định: một bản bung
               bốn trăm dòng mà không tìm được thì mở ra chỉ để cuộn.
  chỉ đọc      webview không cho gõ, nhưng cũng không NÓI RA rằng nó là bản phái sinh; tài liệu
               ảo thì VS Code tự chặn và nói thẳng «cannot edit in read-only editor».
  `Ctrl+click` cần một `DefinitionProvider`, mà provider chỉ gắn được vào tài liệu văn bản.

Nay bản clear text là một `TextDocumentContentProvider` với scheme `fbo-insight:`, đuôi
`.cleartext.xml`. Đuôi ấy không phải trang trí: VS Code chọn ngôn ngữ theo ĐUÔI, nên bản đã bung
được tô cú pháp XML, gập được, có minimap, có mục lục — miễn phí, và tên tab đọc ra ngay rằng đây
không phải file thật.

Thêm `Ctrl+click` / F12 trên bản đã bung → file nguồn thật của DÒNG đang bấm. Nó không hỏi
«entity nào» mà hỏi «chữ này của file nào»: `sourceRange` đi qua bản đồ đoạn, nên một dòng do
entity LỒNG kéo vào cũng về đúng file cuối cùng chứ không dừng ở file trung gian. `buildEntityInsight`
vì thế trả kèm `segments`. Đích lấy theo DÒNG chứ không theo ký tự dưới con trỏ — bôi đen trọn
dòng là thứ người ta cần thấy sau cú nhảy.

Tô màu chuyển sang `isWholeLine`: khối bung ra thường thụt lề khác hẳn chữ quanh nó (nội dung
Include có lề riêng), nên tô theo chữ cho ra một hình răng cưa đọc không ra khối. Thêm dấu trên
thanh tổng quan — với bản bung vài trăm dòng thì đó là bản đồ duy nhất cho biết khối nào ở đâu mà
không phải cuộn hết.

Đã GỠ `renderInsightHtml` và bộ tách token XML của nó khỏi `core/src/insight.mjs`: editor tự tô
cú pháp, nên cả bộ ấy thành mã chết. Giữ lại là giữ một bản vẽ thứ hai cho một bề mặt không còn.

Bộ test của tầng vỏ nay dùng một `vscode` RIÊNG (`window`/`workspace` nhân bản). Bản trước né
chuyện ESM cho module anh em chạy xen kẽ ở mỗi `await` bằng cách CẤM `await` trong file test —
trả giá bằng việc không kiểm được đúng phần async quan trọng nhất: mở tài liệu, đóng tab, mở lại
tab. Cô lập `vscode` thì `await` bao nhiêu cũng không ai đụng vào ai.


### Đổi — chế độ soi giờ ĐỔI CHÍNH TAB ĐANG MỞ sang bản clear text

Ba vòng trước lần lượt thử: chú giải trên dòng (cắt ở dòng đầu), tab clear text bên cạnh (phải
liếc qua liếc lại), ô peek (một khối một lúc). Yêu cầu cuối cùng gọn hơn cả ba: bật lên thì TOÀN
BỘ hiện dưới dạng clear text, ngay trên file gốc, không thao tác thêm, không cửa sổ thêm.

Nay `Ctrl+Alt+E` mở một `WebviewPanel` ở ĐÚNG CỘT của editor văn bản đang xem, mang cả file đã
phân giải hết. Bấm lại — hoặc tự đóng tab ấy — là tắt chế độ và tab văn bản hiện lại ngay dưới nó.

Đã GỠ, vì chúng chính là những «thao tác thêm» bị phàn nàn: scheme `fbo-insight:` và tab clear
text bên cạnh, phép cuộn theo con trỏ, và lệnh `fboDesigner.peekEntity` (`Ctrl+Alt+P`).

Ba điều đáng ghi lại:

1. **Webview là chỗ duy nhất còn lại, không phải một lựa chọn thẩm mỹ.** `&SharedFields;` chiếm
   MỘT dòng trong file gốc, bản bung bốn chục dòng; editor văn bản không chèn được dòng ảo, và
   `after.contentText` bị cắt ở dòng đầu trước cả khi dựng CSS. Đường «ghi thẳng vào file» đúng
   nghĩa «hiện trên file gốc» nhất nhưng lỡ `Ctrl+S` là controller mang bản đã bung — với Include
   dùng chung thì đó là đổi cho MỌI program.
2. **Panel CHIẾM CHỖ tab văn bản, không cộng thêm.** `createWebviewPanel` chỉ đẩy một tab mới
   vào nhóm — tab văn bản vẫn nằm đó, và người dùng đếm được HAI tab cho một file. Nên mở panel
   xong là đóng tab văn bản của file ấy trong đúng nhóm đó; đóng panel thì mở lại, đúng cột,
   đúng vị trí con trỏ. Ngoại lệ duy nhất: tài liệu đang SỬA DỞ thì không đóng — `tabGroups.close`
   sẽ dựng hộp thoại «lưu không?» ngay giữa lúc người ta chỉ định nhìn một cái; khi ấy chấp nhận
   hai tab và nói ra lý do. Câu hỏi «có phải mở lại tab văn bản không» hỏi bảng tab NGAY LÚC ĐÓNG
   chứ không nhớ từ lúc mở: giữa hai thời điểm ấy người dùng có thể tự mở lại file, và một cái cờ
   nhớ sẵn sẽ mở chồng thêm một tab thứ hai — đúng lỗi đang sửa, chỉ là ở đầu kia.
3. **Tooltip đặt trên TỪNG DÒNG, không phải chỉ dòng đầu khối.** Người đọc dừng chuột ở dòng nào
   thì hỏi về dòng ấy — bắt họ lần lên đầu khối để biết nó từ đâu là bắt họ làm việc của tooltip.
   Nhãn nổi `&Name; ← File.ent` thì ngược lại, chỉ đặt ở dòng đầu: lặp nó bốn chục lần là bốn chục
   lần cùng một chữ.

Phần vẽ nằm ở `core/src/insight.mjs` (`renderInsightHtml`) chứ không ở tầng vỏ — nó thuần, nên
chỗ dễ sai nhất (cắt chữ theo DÒNG và theo VÙNG cùng lúc, cộng escape) kiểm được bằng node trần.
Bộ tách token XML cố ý KHÔNG dựng cây: bản clear text hay có mảnh không cân thẻ, và một bộ phân
tích thật sẽ từ chối vẽ đúng những file cần nhìn nhất.


### Thêm — chế độ soi entity trên XML (`Ctrl+Alt+E`, bản dev)

Một chế độ XEM mới trong editor văn bản: bật lên thì mọi `&Name;` được gạch chân, tô nền theo
FILE NGUỒN, và đi kèm ĐOẠN CHỮ NÓ BUNG RA vẽ ngay trên dòng ấy. Rê chuột lên `&Name;` hiện file
Include tương ứng, kích thước, các file khác đã góp chữ, và nguyên văn bản đã bung.

Phần thuần nằm ở [`core/src/insight.mjs`](core/src/insight.mjs) (`buildEntityInsight`), phần vẽ
ở [`extension/src/insight-host.js`](extension/src/insight-host.js). Đăng ký trong khối
`devFeaturesEnabled` cùng nhóm với chẩn đoán / mục lục / F12 / hover.

Ba điều đáng ghi lại, vì cả ba đều là chỗ một bản làm vội sẽ sai:

1. **Bung HẾT, không dừng ở chuỗi trong nháy.** Giá trị một entity thường lại chứa `&Name;`
   khác, nên bản đọc từ `declarations` là bản dở dang. Lấy từ `clearText`: `expand` đã đóng dấu
   lên mỗi đoạn cái tham chiếu NGOÀI CÙNG đã kéo nó vào (`seg.ref`), nên gom đoạn theo đồng nhất
   `ref` là ra đúng dải của từng `&Name;` ở file chủ.
2. **`(rỗng)` là một câu trả lời, không phải một chỗ trống.** Entity bung ra chuỗi rỗng chính là
   CÔNG TẮC TẮT của FBO — `<![%Cond;[ … ]]>` IGNORE rồi rơi xuống bản rỗng nhờ luật first-wins.
   Nên ba kiểu «không có đoạn nào» được tách hẳn ra: `empty` (nhánh đang tắt), `unresolved` vì
   chưa khai, và `unresolved` vì khai SYSTEM mà không đọc được — cái sau nhận diện bằng chính
   dải của cảnh báo `entity.unread_system`, không phải đọc lại đĩa để đoán.
3. **`&Name;` KHÔNG bị giấu đi.** Cách «thay hẳn» (`display:none` rồi vẽ bản đã bung vào chỗ
   trống) nghe đúng ý hơn nhưng tự cắt mất một nửa tính năng: dải bị ẩn có bề rộng bằng không
   nên không rê chuột lên được, mà rê chuột lên `&Name;` để đọc file Include mới là thứ dùng
   nhiều nhất.

### Thêm — tab clear text tự đi theo con trỏ, và `Ctrl+Alt+P` xem ngay dưới dòng

Bản bung đầy đủ có rồi thì vẫn còn một khoảng cách: người dùng đứng ở dòng 345 (`&…Category;`),
còn khối nó đẻ ra nằm ở dòng 523 của tab clear text — với một controller thật thì đó là vài trăm
dòng, và mỗi lần bấm sang entity khác lại dò lại từ đầu. Bản bung chỉ đáng giá khi nó tự đến chỗ
đang hỏi.

Nay `onDidChangeTextEditorSelection` đưa tab clear text tới đúng khối của `&Name;` dưới con trỏ
và bôi đen trọn khối (`revealRange` + `selection`, KHÔNG `showTextDocument` — tab kia không được
cướp con trỏ khỏi file đang sửa).

Thêm `fboDesigner.peekEntity` (`Ctrl+Alt+P`): mở khối đã bung NGAY DƯỚI DÒNG đang đứng, trong một
ô peek, không phải đổi tab. Ô peek là bề mặt duy nhất của VS Code hiện được văn bản nhiều dòng
xen vào giữa một file đang mở.

`refAt` nhận cả hai đầu mút của `&Name;` — con trỏ đặt ngay sau dấu `;` vẫn là «đang đứng trên
entity này» với người dùng, và bắt họ lùi một ký tự để lệnh chịu chạy là một quy tắc không ai
đoán ra.

### Thêm — tab clear text: bản bung ĐẦY ĐỦ, không giới hạn số dòng

Chú giải trên dòng không hiện được văn bản nhiều dòng, và đây không phải chuyện gắng thêm là
được: VS Code cắt `contentText` ở DÒNG ĐẦU trước khi dựng CSS (`abstractCodeEditorService`,
`opts.contentText.match(/^.*$/m)[0]`), và không có API nào chèn dòng ảo vào giữa văn bản. Nên bản
bung đầy đủ chuyển sang một TÀI LIỆU THẬT: scheme chỉ đọc `fbo-insight:`, tab
`<tên file>.cleartext.xml` mở kèm bên cạnh, chứa cả file đã phân giải hết — bao nhiêu dòng cũng
bung, Include lồng trong Include cũng bung, không cắt ở đâu.

Đuôi `.cleartext.xml` không phải trang trí: VS Code chọn ngôn ngữ theo đuôi, nên có nó thì bản
clear text được tô cú pháp XML như file thật.

Ở tab ấy, mỗi VÙNG chữ do một `&Name;` đẻ ra vẫn mang màu của file nguồn, và rê chuột lên nói
entity nào đã kéo khối ấy vào — câu hỏi duy nhất mà một bản đã bung hết không tự trả lời được.
Vùng lấy từ `outStart`/`outEnd` mà `buildEntityInsight` nay trả kèm, không phải dò lại bằng cách
so nội dung.

Trên chính file XML, chú giải đổi theo: giá trị MỘT dòng giữ nguyên (hiện nguyên văn), giá trị
NHIỀU dòng nay hiện DÒNG ĐẦU của bản đã bung rồi `…` thay cho thẻ tóm tắt `42 dòng ← File.ent`.
Thẻ ấy nói đặc điểm của bản bung chứ không cho đọc một chữ nào của nó; dòng đầu là chữ thật, và
với đa số Include thì dòng đầu đã đủ nhận ra khối ấy là khối gì.

Hover vẫn có trần (20 000 ký tự) và nói thẳng ra là còn nữa. Không phải vì bản bung bị giới hạn:
`hoverMessage` được dựng SẴN cho mọi tham chiếu ở mỗi lượt vẽ (API nhận giá trị, không nhận hàm),
nên bỏ trần ở đó là nối vài trăm KB markdown cho những hover không ai mở, mỗi lần gõ một phím.
«Không giới hạn» được trả ở chỗ nó không tốn gì — tab clear text, nơi văn bản chỉ dựng khi người
dùng thật sự mở nó.

Lệnh này là lệnh ẩn ĐẦU TIÊN, nên nó kéo theo một khoá ngữ cảnh mới: bốn provider trước không
góp gì vào `package.json` nên bản không có cờ tự khắc không thấy chúng, còn một LỆNH thì phải
khai trong `contributes` mới có tên trong Command Palette và có phím tắt — khai rồi thì bản
không có cờ cũng thấy tên lệnh, bấm vào là «command not found». `activate()` vì thế bật
`fboDesigner.devFeatures`, và cả mục lệnh lẫn phím tắt đều gác sau `when` của khoá ấy.


### Thêm — Phase #1/#2 thành TÍNH NĂNG ẨN, chỉ bật khi đóng `.vsix` bằng `--dev`

Chẩn đoán (Problems panel), mục lục (`Ctrl+Shift+O`), F12, rê chuột và gợi ý — bốn provider đăng
ký ở `activate()` — nay KHÔNG có trong bản `.vsix` đóng gói bình thường. Chúng vẫn còn nguyên
trong mã nguồn và trong bộ test, chỉ là không được `registerDiagnostics`/`registerSymbols`/
`registerDefinitions`/`registerLanguageFeatures` gọi tới trừ khi bật.

Bật khi MỘT trong hai — [`extension/src/dev-features.js`](extension/src/dev-features.js):

1. Extension Host chạy ở chế độ KHÔNG PHẢI `Production` (`context.extensionMode`) — tức F5 từ
   mã nguồn (`Development`) hoặc Extension Test Host (`Test`). Đó là máy của người đang PHÁT
   TRIỂN extension, không cần giấu gì với chính họ.
2. Gói `.vsix` được đóng bằng `node tools/package-vsix.mjs --dev`. Cờ này KHÔNG đổi một dòng mã
   nào, không đổi số hiệu phiên bản — nó chỉ thêm đúng MỘT FILE RỖNG vào gói,
   `extension/dev-features.flag`. `extension.js` đọc SỰ CÓ MẶT của file ấy, không đọc nội dung.
   Hai gói dựng từ cùng một commit chỉ khác nhau ở việc có hay không có đúng một file trống —
   không phải hai nhánh mã khác nhau, không phải hai lượt build khác nhau.

Vì sao một file đánh dấu chứ không phải một khoá trong `package.json`: `package.json` bị đọc
rộng — Cursor/VS Code hiện nó trong panel Extensions, và một `.vsix` chỉ là file ZIP nên ai tò
mò cũng mở ra xem được (xem đầu `package-vsix.mjs`). Một khoá `"dev": true` nằm ngay đó là mời
người ta hỏi "cờ gì vậy". Một file rỗng cạnh `package.json` thì không cần giải thích gì trong
`package.json` cả.

`context` méo mó hoặc thiếu thì mặc định luôn nghiêng về phía ẨN (không phải bật đại): thiếu
thông tin để biết chắc là F5 thì rơi về kiểm tra file, và không có file thì trả `false`.

Mọi lý do "không gate license" đã ghi ở từng provider (Problems, Outline, F12, hover là thứ
editor tự hỏi, không phải lệnh người ta chủ động bấm) vẫn còn nguyên — cờ dev đứng NGOÀI câu hỏi
license, trả lời một câu khác: bản này có MANG tính năng ấy vào hay không, trước cả khi tính tới
ai được phép dùng nó.

`.flag` được khai thêm vào `[Content_Types].xml` như một Default Extension (`text/plain`) — OPC
đòi khai kiểu cho MỌI đuôi file có trong gói, thiếu một cái thì trình đọc chặt từ chối cả gói.
Khai TĨNH, không điều kiện theo `--dev`: khai thêm một đuôi không dùng tới là vô hại, còn thiếu
khai đúng lúc cần thì gói `--dev` hỏng ngay lúc cài trên máy người kiểm thử.

`Ctrl+Alt+D` (Phase #4, xem dữ liệu thật) KHÔNG nằm trong cờ này — vẫn luôn có mặt, chỉ gate
license như trước giờ.

Test: 10 phép kiểm
([`extension/test/test-dev-features.mjs`](extension/test/test-dev-features.mjs)), và xác nhận
trên chính file `.vsix` thật — đóng cả hai đường rồi mở lại bằng
`System.IO.Compression.ZipFile` để khẳng định `extension/dev-features.flag` có mặt đúng lúc,
vắng mặt đúng lúc.


### Sửa tiếp — mốc (`~fbo-dataset-N~`) SAI VỀ NGUYÊN TẮC, bỏ hẳn: `dir@id` là chỉ số vào bảng THẬT SỰ trả về, không phải vào câu lệnh

Bản ngay trước cắm một mốc riêng cho MỖI CÂU sinh resultset trong script (`reportResultsets`).
Sai ở chỗ: nếu một câu `exec` DUY NHẤT tự bên trong nó in ra NHIỀU HƠN MỘT bảng (điều hoàn toàn
có thể với một stored procedure báo cáo), thì một mốc đặt trước câu `exec` ấy không thể tách các
bảng đó ra được — `dir@id` của FBO/DevWorkFlow đúng nghĩa là chỉ số vào `DataSet.Tables[N]`, tức
đếm theo BẢNG THẬT SỰ SQL Server trả về, một con số chỉ biết được SAU KHI CHẠY XONG, không phải
đếm theo số câu lệnh đứng trong văn bản script.

Bỏ hẳn cơ chế cắm mốc. Thay vào đó (`grid-sample.mjs: buildDirectResultsetSelect`):

- Script chạy NGUYÊN VĂN, không sửa MỘT KÝ TỰ NÀO — không mốc, không bảng tạm, không dò schema.
- `sql-host.js: runSampleQueryDataset` bật header của `sqlcmd`, rồi `splitResultsets` tách CHÍNH
  output thô thành từng bảng bằng ranh giới có sẵn của chính `sqlcmd`: mỗi resultset in ra một
  dòng header rồi một dòng gạch ngang phân cách (`----------`) — không cần bất kỳ dấu hiệu nào
  do FBO Designer tự thêm vào.
- Số bảng thật sự (`tableCount`) chỉ biết được ở bước này; `dir@id` vượt quá số đó thì rơi về
  bảng CUỐI CÙNG, có ghi rõ ra Output kèm cả số bảng thật lẫn `dir@id` đã khai, để không ai phải
  đoán vì sao xem trước ra khác báo cáo thật.

### Sửa tiếp — Tiếng Việt vẫn mất dấu dù đã đổi `sqlcmd -Q` → `-i <file>`: đường ống `stdout` của `execFile` không theo `-f 65001`

Đổi sang `-i <file UTF-8>` (mục dưới) đọc ĐÚNG khi chạy `sqlcmd` tay trong SSMS/console, nhưng
extension vẫn ra mojibake — vì `execFile` đọc kết quả qua một PIPE, không phải một console/TTY
thật, và `-f` (codepage) của `sqlcmd` chi phối codepage của CONSOLE, không nhất thiết áp dụng cho
một pipe. Sửa theo đúng cách MCP `run_sql_script` đã dùng: thêm `-o <file kết quả>`, đọc lại từ
FILE đó (không đọc `stdout` nữa), bỏ BOM đầu file trước khi giải UTF-8
(`sql-host.js: runSqlcmd`, `decodeSqlcmdRows`).

### Sửa — TÌM RA GỐC RỄ LỖI ENCODE: `sqlcmd -Q` mất dấu tiếng Việt qua ARGV, không phải cần hex mọi nơi

Đối chiếu trực tiếp `zc_rptPurchaseDiscount` của HOATP qua MCP (chương trình thật, `\\172.168.5.14\
CustomerPro\FBI\HOATP\FBISP2421`) mới lộ ra HAI sự thật cùng lúc:

1. **SQL Server của khách là 2008 R2** — không có `sys.dm_exec_describe_first_result_set` (hàm
   này chỉ từ SQL Server 2012). Toàn bộ cơ chế "dò schema trước rồi hex-hoá qua bảng tạm" của bản
   trước chết ngay từ bước dò — `Invalid object name 'sys.dm_exec_describe_first_result_set'` —
   và không bao giờ tới được bước đọc dữ liệu thật.
2. **Một SELECT trần tiếng Việt đọc THẲNG từ HOATP ra ĐÚNG dấu, không cần hex.** Nghĩa là giả
   thiết nền tảng của toàn bộ cơ chế hex trong file này — "`sqlcmd` LUÔN đổi ký tự có dấu thành
   `?` ở tầng console/OEM codepage" — chỉ đúng với CÁCH GỌI `sqlcmd` mà `sql-host.js` đang dùng
   (`-Q "<query>"`, câu lệnh qua ARGV), không đúng với `sqlcmd` nói chung.

### Sửa tận gốc: `sqlcmd -i <file UTF-8 có BOM> -f 65001`, không còn `-Q`

`runSqlcmd` (`sql-host.js`) đổi từ truyền câu lệnh qua `-Q` (một đối số dòng lệnh — CHÍNH đường
này làm mất dấu, không phải bản thân `sqlcmd`) sang ghi câu lệnh ra một FILE TẠM mã hoá UTF-8 kèm
BOM rồi chạy `-i <file> -f 65001` (UTF-8 cả đọc lẫn ghi), đọc lại stdout bằng UTF-8 thay vì
`latin1`. `run_sql_script` của MCP 4ai-fbo vốn đã dùng đúng cách này ("`sqlcmd -i` với codepage
UTF-8") — không phải một phát minh mới, mà là một cách gọi ĐÃ ĐƯỢC XÁC NHẬN hoạt động đúng trên
đúng loại SQL Server này.

### Viết lại nhánh Report: KHÔNG dò schema, KHÔNG bảng tạm, KHÔNG hex — CHẠY ĐỦ SCRIPT

Chuẩn tắc do người dùng chốt 2026-09-08: *"chạy đủ script, bốc dataset, lấy đúng table id và gán
vào cột là xong"*. Toàn bộ cơ chế BƯỚC 0 (`sys.dm_exec_describe_first_result_set`) + bảng tạm
`##fbo$sample` + `insert…exec`/`select…into` bị BỎ. Thay vào đó:

- Mỗi câu SINH RESULTSET trong script (`reportResultsets`) được cắm một MỐC RIÊNG
  (`~fbo-dataset-0~`, `~fbo-dataset-1~`, …) ngay TRƯỚC nó — không đụng một ký tự nào vào nội
  dung các câu, chỉ chèn một dòng `select '<mốc>';` xen giữa.
- Script chạy ĐỦ, đúng thứ tự gốc, một lần duy nhất — không cắt ngắn, không phân biệt bảng đã
  chọn đứng ở đâu.
- Tầng vỏ (`sql-host.js: runSampleQueryDataset`) bật header của `sqlcmd`, cắt đúng đoạn nằm GIỮA
  mốc của bảng `dir@id` đã chọn và mốc kế tiếp (hoặc hết luồng), rồi khớp cột theo TÊN
  (`mapNamedRows`) — field nào lưới khai mà bảng thật không có cột trùng tên thì BỎ, không đoán.
- KHÔNG hex-hoá: không cần nữa, vì đường `sqlcmd` mới (xem trên) đã ra đúng dấu tiếng Việt.

Đây cũng là lý do gọi được ÍT hơn — bản trước gọi hai lượt `sqlcmd` (một lượt dò schema, một lượt
đọc dữ liệu); bản này gọi ĐÚNG MỘT LƯỢT.

### Sửa — XEM DỮ LIỆU THẬT: báo cáo CHẠY ĐỦ SCRIPT, không cắt ngắn (xác nhận của người dùng 2026-09-08)

`buildResultsetSelect` (báo cáo không `'#$query'`) từng CẮT NGẮN script ngay sau bảng đã chọn:
nếu `dir@id` trỏ tới một bảng KHÔNG phải bảng cuối, mọi câu đứng sau nó (kể cả `exec` proc báo
cáo thật) bị bỏ qua hoàn toàn — sai tác dụng phụ so với runtime, và là lệch với chuẩn tắc đã
chốt: "chạy đủ script, bốc dataset, lấy đúng table id và gán vào cột".

Nay bảng đã chọn được HỨNG VÀO MỘT BẢNG TẠM (`##fbo$sample`) ngay tại đúng vị trí của nó trong
script, rồi PHẦN CÒN LẠI của script vẫn chạy tiếp sau đó — cho tác dụng phụ y hệt runtime, bất kể
`dir@id` trỏ tới bảng nào. Mốc `SAMPLE_SENTINEL` cắm SAU CÙNG (sau cả phần script còn lại), nên
dữ liệu đọc lại luôn là ĐÚNG bảng tạm đã hứng từ trước, không phụ thuộc gì vào việc phần còn lại
của script có in ra resultset gây nhiễu hay không.

Cách hứng vào bảng tạm cũng đơn giản hơn cho trường hợp bảng đã chọn là một `select` trần: dùng
`select … into` (SQL Server tự suy ra schema của chính câu select đó), không cần `create table`
khai kiểu tay như trước — chỉ nhánh `exec` mới cần `create table` đúng schema rồi `insert … exec`
(cú pháp duy nhất nạp resultset của một exec vào một bảng có sẵn).

### Đổi — XEM DỮ LIỆU THẬT: bỏ SET ROWCOUNT, cắt số dòng ở TẦNG VỎ thay vì ở SQL

Lưới chi tiết (`buildDetailSelect`) và báo cáo dự phòng (`buildRawResultsetSelect`) từng chặn số
dòng bằng `SET ROWCOUNT` — cách duy nhất giới hạn được một script nhiều câu mà không đụng cú
pháp của nó. Cái giá đã ghi từ đầu nhưng chưa đủ nghiêm trọng để đổi: `SET ROWCOUNT` chặn MỌI
resultset của cả batch, kể cả các câu `insert into #tmp` ở GIỮA script — một script tự dựng bảng
tạm rồi tổng hợp sẽ ra con số của N dòng đầu của BẢNG TẠM, không phải N dòng đầu của kết quả cuối
(xác nhận của người dùng 2026-09-08: script càng phức tạp thì càng dễ ra một con số không liên
quan gì tới thứ đang xem).

Nay hai nhánh ấy chạy câu lệnh KHÔNG giới hạn số dòng ở SQL, và tầng vỏ (`sample-host.js`) CẮT
CÒN ĐÚNG `fboDesigner.sampleRowCount` (mặc định 10) ngay sau khi đọc xong, trước khi đưa vào
lưới. Vẫn MỘT chỗ cấu hình duy nhất cho mọi kiểu lưới — ba nhánh còn lại (danh mục, chứng từ, báo
cáo có schema) đã tự giới hạn bằng `top N` thật trong câu lệnh, nên lát cắt này với chúng vô hại.
Đánh đổi nói thẳng: câu lệnh có thể kéo về nhiều hơn số dòng cần hiện — chấp nhận được cho một
phép xem trước, và nếu bảng thật sự lớn thì `sqlcmd` tự chạm hạn giờ (đọc được hơn một con số sai
lặng lẽ).

### Sửa — XEM DỮ LIỆU THẬT: báo cáo (không '#$query') giờ HEX-HOÁ được, hết lỗi tiếng Việt thành '?'

Bản trước (khớp `dataset[dir@id]` theo tên bằng cách bật header của `sqlcmd`) đọc ĐÚNG cột,
nhưng vẫn còn lỗi cũ: cột chữ có dấu không hex-hoá được, và `sqlcmd` tự đổi ký tự tiếng Việt
thành `?` ở tầng console/OEM codepage TRƯỚC KHI byte tới tay tầng vỏ — mất luôn, không cách nào
decode lại được nữa ("Chi?t kh?u nh¢m 02.02" thay vì "Chiết khấu nhóm 02.02"). Ba nhánh kia
(danh mục / chứng từ / chi tiết) không dính lỗi này vì chúng TỰ dựng câu `select` nên hex-hoá
được; nhánh báo cáo chạy nguyên văn câu của file nên trước đây không biết cột nào là chữ để bọc.

Nay thêm một BƯỚC 0: trước khi đọc, hỏi CHÍNH XÁC schema của bảng đã chọn (`dir@id`) bằng
`sys.dm_exec_describe_first_result_set` — hàm này biên dịch TĨNH một batch T-SQL và trả về tên
cột thật, kiểu SQL thật, KHÔNG chạy gì cả. Biết trước schema rồi thì dựng được câu ĐỌC LẠI có
hex, y hệt ba nhánh kia:

- Bảng đã chọn là một `exec …` — không "SELECT ... FROM" thẳng một lệnh gọi proc được, nên dựng
  một bảng tạm TOÀN CỤC ĐÚNG schema vừa hỏi rồi `insert … exec …` (cú pháp DUY NHẤT nạp resultset
  của một exec vào một bảng có sẵn), xong mới `select` lại có hex từ bảng ấy.
- Bảng đã chọn là một `select …` (ví dụ `dataset[0]` là câu debug/echo tham số) — bọc thẳng thành
  bảng con `(select …) as t`, không cần bảng tạm nào.

`sys.dm_exec_describe_first_result_set` đòi SQL Server 2012+. Câu dò lỗi (SQL Server cũ hơn, hay
lý do khác) thì tự rơi về cách đọc của bản trước — khớp theo tên LÚC CHẠY, không hex-hoá được,
kèm ghi chú rõ vì sao — không dừng cả lệnh chỉ vì một câu dò không chạy được.

### Sửa — XEM DỮ LIỆU THẬT: báo cáo lấy đúng `dataset[dir@id]`, khớp cột theo TÊN

Khi proc không nhận bảng đích (`'#$query'`), script Processing có thể tự in ra NHIỀU bảng — ADO.NET
nhận kết quả về một `DataSet` gồm nhiều `DataTable`, và Filter nói RÕ lấy bảng nào bằng `dir@id`.
Đo được trên `zcrptPurchaseDiscount.xml` (HOATP/FBISP2421): script in ra đúng hai bảng —
`select @tu_ngay as tu_ngay, @den_ngay as den_ngay` là `dataset[0]`, kết quả của
`exec zc_rptPurchaseDiscount …` là `dataset[1]` — và Filter khai `<dir id="1">`, tức lấy
`dataset[1]`. Bản trước LUÔN lấy resultset của `exec` (đúng cho ca này, tình cờ trùng với
`dir id="1"`), nhưng không đọc `dir@id` nên sai với bất kỳ Filter nào khai số khác.

Nay `grid-sample.mjs` tách thân Processing thành từng CÂU (`splitReportStatements` — ranh giới là
mỗi lần gặp lại `select`/`exec`, vì corpus không có dấu `;` đáng tin cậy để tách), lọc ra những câu
THẬT SỰ sinh resultset (bỏ `select @x = …` chỉ gán biến), rồi đọc `dir@id` làm chỉ số 0-based vào
đúng danh sách ấy. Không khai, hay khai vượt quá số bảng thật có, thì lấy bảng CUỐI CÙNG (phỏng
đoán an toàn nhất — script kiểu này gần như luôn kết thúc bằng câu tạo dữ liệu thật), kèm ghi chú
khi số bị vượt quá.

Cột KHÔNG còn khớp theo VỊ TRÍ nữa — mà theo TÊN THẬT của resultset, đúng cách ADO.NET tự bind
`DataTable` vào lưới. Vì không dựng được `select` bọc ngoài (đây là nguyên văn câu của file), tầng
vỏ bật header của `sqlcmd` (`runSampleQueryNamed`, `sql-host.js`) thay vì tắt hẳn (`-h -1`): đọc
dòng-ngay-sau-mốc làm tên cột, bỏ dòng gạch ngang trang trí nếu có, rồi khớp `field@name` (đã phân
giải `%l`) không phân biệt hoa/thường. Field nào lưới khai mà resultset không có cột trùng tên thì
bị BỎ — không đoán, không giữ một cột rỗng lặng lẽ — và người dùng thấy rõ lý do ở Output.

### Sửa — DIALOG THAM SỐ: ô ngày là Ô CÓ MẶT NẠ, không còn text trần

Ô ngày trong form tham số (Detail lẫn Report) giờ là một ô CÓ MẶT NẠ thật sự, không chỉ hiện đúng
định dạng rồi để người dùng tự gõ đúng chuỗi:

- Gõ số TỰ NHẢY VÙNG — đủ hai chữ số cho `dd`/`MM`, đủ bốn cho `yyyy` thì con trỏ tự sang vùng kế.
- Bôi đen CẢ Ô rồi Delete/Backspace GIỮ LẠI dấu phân cách (`__/__/____`), không xoá trắng thành
  chuỗi rỗng.
- Sửa ở vùng nào thì CHỈ vùng đó đổi — click vào vùng tháng chỉ ghi đè tháng, ngày và năm giữ
  nguyên.
- NGÀY được kẹp về ngày cuối cùng hợp lệ của tháng/năm đang có: `30/02/2026` → `28/02/2026`
  (2026 không nhuận); `29/02/2024` giữ nguyên (2024 nhuận). Ngày CHỜ đủ cả tháng lẫn năm mới kẹp —
  kẹp là phép một chiều, ghi đè sớm khi năm chưa biết có thể phá mất một ngày 29/02 đúng của một
  năm nhuận mà không lấy lại được.

Sống trong chuỗi HTML mà `dialog-panel.js` gửi cho webview (`attachDateMask`) — không phải một hàm
export được, vì nó CHỈ chạy trong trình duyệt của webview. `scriptParamFields` (core) cấp thêm
`mask` cho mỗi tham số (mặc định `dd/MM/yyyy`, hay mặt nạ thật nếu field trỏ `@tên` của
`Options.xml`); `askScriptParams` (extension) truyền mặt nạ ấy vào field spec.

### Sửa — XEM DỮ LIỆU THẬT: ba chỗ chỉnh sau khi dùng thật

**1. Tham số trùng khoá chính thì tự điền, không mở form.** 6 lưới chi tiết của FBISP24 đòi
khoá của hàng cha dưới dạng một tham số `@x` thẳng (`@stt_rec`, `@ma_vt`) thay vì qua
`@@whereClause`. Trước đây lệnh vẫn mở form hỏi giá trị ấy — dù BƯỚC 1 (câu dò) vừa mới tự lấy
được đúng giá trị đó từ database. Nay tham số nào TRÙNG TÊN với `grid@code` được điền thẳng bằng
khoá vừa dò, kèm một dòng Output nói rõ đã điền gì — không hỏi lại một thứ vừa mới tự có. Tham
số khác tên (khoá của một cấp cha khác) không có nguồn nào chắc chắn, nên vẫn hỏi qua form.

**2. Báo cáo không nhận `'#$query'` thì không dựng `##fbo$sample`.** Một số proc báo cáo
(`zc_rptPurchaseDiscount` chẳng hạn) không nhận tham số bảng đích nào — chúng tự in kết quả
ngay khi `exec` chạy. Bản trước vẫn dựng `##fbo$sample` rồi `select … from` bảng ấy sau khi
`exec`, và vì không có `'#$query'` để thay nên không ai tạo ra bảng đó — "Invalid object name",
giết cả câu chỉ vì một bước thừa. Nay nhánh này được nhận diện riêng (`buildExecDirectSelect`):
mốc `SAMPLE_SENTINEL` cắm NGAY TRƯỚC chữ `exec` (mọi `select` dò/gán biến đứng trước, kiểu
`select @tu_ngay as tu_ngay, …`, bị cắt bỏ đúng như tài liệu đầu file đã nói), và kết quả của
CHÍNH `exec` trở thành dữ liệu — không bảng tạm, không `select` bọc ngoài. Đánh đổi: không bọc
được nữa thì không hex-hoá được, nên cột chữ có dấu tiếng Việt có thể sai bảng mã — `notes` nói
thẳng điều này. Số dòng vẫn chặn được bằng `SET ROWCOUNT` quanh câu `exec`.

**3. Form tham số hiện ngày theo `dataFormatString` của field.** Trường ngày trong form (cả
lưới chi tiết lẫn báo cáo) từng hiện chuỗi SQL trần (`2026-09-07`) thay vì định dạng người dùng
quen nhìn. Nay hiện theo đúng mặt nạ của field — `dd/MM/yyyy` mặc định, hoặc mặt nạ thật nếu
field trỏ qua một biến của `Options.xml` (`dataFormatString="@datetimeFormat"`) — và đọc
NGƯỢC lại đúng mặt nạ ấy thành giá trị SQL khi người dùng bấm chạy, dù họ có gõ lại hay giữ
nguyên mặc định. `core/src/format.mjs` cấp thêm `formatDate`/`parseDisplayDate` cho việc
này; `scriptParamFields` nhận thêm `formats` (bản đồ đọc từ `Options.xml`, tầng vỏ tự đọc)
và trả thêm `mask` cho mỗi tham số.

### Sửa — XEM DỮ LIỆU THẬT: lưới chi tiết chạy HAI câu — dò trước, đọc sau

Lưới `Detail` không tự đứng được. Runtime bơm vào nó hai thứ mà màn hình cha đang giữ: khoá chính
của chứng từ đang mở (`@@whereClause`) và kỳ của chính chứng từ ấy (`$partition$current`). Bản
trước đoán cả hai — `1 = 1` cho khoá, tháng hiện tại cho kỳ — và cả hai đều sai theo cùng một
kiểu: `1 = 1` trộn dòng của MỌI chứng từ rồi `SET ROWCOUNT` cắt mười dòng đầu của đống trộn ấy,
còn tháng hiện tại thì đọc `d64$202609` trong khi chứng từ có thật nằm ở `d64$202607`. Một bản xem
trước sinh ra để ĐO BỀ RỘNG CỘT mà cho ra một lưới không chứng từ thật nào giống thì nó đang nói
dối; cái thứ hai còn tệ hơn — nó cho ra lưới rỗng.

Nay nhánh ấy đi HAI bước, và hai bước là bắt buộc: kết quả bước 1 quyết định bước 2 đọc BẢNG NÀO,
nên không có cách nào gộp vào một câu.

**Bước 1 — câu dò.** Hai hình dạng, theo có hay không có `<partition>`:

```sql
select top 1 convert(char(6), ngay_ct, 112) as partition, stt_rec
from c64$000000 where status not in ('*', 'L')      -- có <partition>: bảng là partition@table

select top 1 ma_kh from dmkh             -- không <partition>: bảng là grid@table
```

Cột kỳ dựng từ `partition@expression` (`{0}` là chỗ giữ cho `partition@field`); không khai thì mặc
định `convert(char(6), {0}, 112)`. `status not in ('*', 'L')` CHỈ có ở nhánh trên, và đó không phải chi tiết
trang trí: `partition@table` là bảng CHỨNG TỪ, nơi `status` chắc chắn có và nơi `'*'` nghĩa là đã
xoá; nhánh dưới đọc một bảng danh mục, hỏi `status` ở đó là "Invalid column name" — giết cả câu dò.

**Bước 2 — câu đọc**, chạy chính `<query event="Loading">` của file với hai giá trị vừa dò:

```sql
select … from d64$202607 a where a.stt_rec = 'PN1000000000123' order by stt_rec, line_nbr
```

Kỳ đọc về đi thẳng vào TÊN BẢNG, nên nó phải qua một phép chặn bằng bảng chữ cái trước khi được
ghép — database trả về gì thì cũng là dữ liệu, không phải mẩu SQL được tin. Khoá thì đi vào một
chuỗi, và nháy trong nó được nhân đôi.

Câu dò hỏng ở bất kỳ đâu — không dựng được, sqlcmd lỗi, bảng rỗng — thì bước 2 vẫn chạy, quay về
`1 = 1` + kỳ lịch, kèm một dòng `notes` nói rõ vì sao. Kém hơn, nhưng một bản xem trước kém vẫn hơn
không có bản nào.

Core cấp `buildSampleProbe(text)` cho bước 1 và nhận `probe: {period, key}` ở `buildSampleSelect`
cho bước 2 — chạy SQL vẫn là việc của tầng vỏ, đúng giao kèo cũ.

### Đổi — XEM DỮ LIỆU THẬT: lưới báo cáo hỏi bằng FORM, không phải chuỗi hộp nhập

Tham số của lưới báo cáo từng được hỏi bằng một QuickPick bấm-để-sửa rồi một InputBox cho từng ô,
và sau đó là một hộp cảnh báo `showWarningMessage` nữa để xác nhận. Báo cáo tồn kho hỏi 17 tham số:
nhìn thấy cả 17 ô cùng lúc, mỗi ô mang đúng nhãn của nó trên màn hình lọc thật, là khác hẳn với
bấm qua một danh sách từng cái một.

Nay nó là một **form** của hộp thoại riêng (`extension/src/dialog/`): mỗi tham số `@x` một ô, nhãn
và giá trị mặc định lấy từ `<field>` của chính file `Filter/` cùng tên. Lưới báo cáo mở form ấy kể
cả khi câu Processing không cần tham số nào — vì nút chính của form CŨNG là chỗ xác nhận «có chạy
stored procedure của khách không», và câu hỏi ấy không phụ thuộc vào việc proc có tham số hay
không. Hộp cảnh báo thứ hai bị bỏ: hỏi hai lần cho cùng một quyết định dạy người ta bấm cho xong.

Không đổi: lưới báo cáo **không bao giờ tự nạp** (lượt tự nạp lúc mở giao diện bỏ qua nó và ghi lý
do ra Output), và huỷ ở form là không câu nào chạy.

### Sửa — XEM DỮ LIỆU THẬT: lấy đúng cách runtime lấy, thay vì tự dựng lại

Bản trước dựng một câu `SELECT` của riêng nó: đọc `<query event="Finding">`, tách cặp khoá join,
rồi ghép lại. Nó chạy được, và đó chính là vấn đề — câu tự dựng trả về dữ liệu KHÁC với dữ liệu
runtime hiện ra: sai join (chỉ giữ cặp khoá chính), thiếu mệnh đề phân quyền, sai kỳ. Một bản
xem trước nói dối về màn hình thật là hỏng đúng cái nó sinh ra để chữa.

Nay `grid@type` quyết định lấy dữ liệu bằng cách nào, và đó là bốn cách khác hẳn nhau:

- **danh mục** (`type` trống, 555/2017 lưới của FBISP24) — `grid@table` + `grid@order`, không có
  query nào cả. Nhánh này giữ nguyên luật cũ: câu lệnh dựng HOÀN TOÀN từ định danh đã qua
  `assertIdent`, không một mẩu SQL nào của file lọt vào. Nó cũng là nhánh DUY NHẤT chạy được
  trên file gốc `.f`, vì nó không cần đọc câu query nào.
- **chứng từ** (`Voucher`) — chạy lại chính lời gọi `FastBusiness$App$Voucher$Loading` của file,
  thay `@@id`, `@@master`, `@@prime`, `@@partition`, `@@expression`, `@@extension`,
  `@@pageCount`, `@@textList`, `@@textExternal`, `@@textOrderBy`.
- **lưới chi tiết** (`Detail`) — chạy lại `<query event="Loading">`; `@@prime$partition$current`
  và `@@whereClause` đều lấy từ CÂU DÒ chạy trước (xem trên), số dòng chặn bằng
  `SET ROWCOUNT`.
- **báo cáo** (`Report`) — lưới không có bảng và không có query; dữ liệu do
  `<command event="Processing">` của `Filter/` CÙNG TÊN sinh ra.

Đánh đổi phải nói thẳng, và nó nằm ngay đầu `grid-sample.mjs`: ba nhánh sau CHẠY SQL CỦA FILE
trên database của khách. Lệnh vẫn chỉ-đọc theo ý định, nhưng ý định ấy giờ là của người viết
controller, không phải của công cụ. Cái không đổi: mọi thứ do công cụ SINH RA — tên bảng, tên
cột, alias, `order by` — vẫn đi qua `assertIdent`, tức không thêm lỗ hổng nào của riêng mình vào
một câu vốn đã là của khách.

`aliasName` quyết định nguồn của một cột, và `defaultValue` chỉ vào cuộc ở lưới **Detail**, khi
field khai `external="true"` mà KHÔNG khai `aliasName`. Đó là ca `<field name="ten_dvt%l" external="true"
defaultValue="''">` của `Grid/SQDetail.f`: không alias, không bảng nào có cột `ten_dvt`, nên
`rtrim(a.ten_dvt)` là "Invalid column name" và nó giết CẢ câu lệnh chứ không chỉ một cột.
1069/1109 field khai `defaultValue` mà không khai `aliasName` đều là ca này.

Điều kiện phải HẸP đúng như vậy, đo được trên corpus: 622 field khai CẢ HAI — `ten_vt%l` cùng
file khai `aliasName="b" defaultValue="''"` — và ở đó `aliasName` mới là nguồn thật, còn
`defaultValue` chỉ là giá trị dùng khi chưa join được; ưu tiên nó vô điều kiện là làm rỗng cột
«Tên vật tư» của gần như mọi lưới chi tiết. Và field KHÔNG `external` thì cột có thật trên bảng
— `so_luong defaultValue="0"` của `Grid/BIAccountAssignmentGrid.f` mà lấy `0` thì cả cột số
lượng về 0 trong khi bảng có số thật.

Và CHỈ lưới `Detail`. Lưới danh mục thường đọc một VIEW đã join sẵn — `Grid/Customer.xml` của
HOATP đọc `viewdmkh`, nơi `ten_nvbh` là một cột có thật. Field vẫn khai
`external="true" defaultValue="''"` (nó nói với runtime rằng cột này không nhập tay được), nhưng
nguồn dữ liệu thì là cột thật; lấy `''` ở đó là làm rỗng một cột đang có dữ liệu, tệ hơn hẳn ca
nó sinh ra để chữa. Lưới chứng từ và lưới báo cáo cũng không đi đường này — câu của chúng do
stored procedure dựng, không do bản khai cột dựng.

Trên field của LƯỚI, `defaultValue` luôn là một mẩu SQL (1731 lần khai, không ngoại lệ). Trên
field của `Dir/`/`Filter/` thì ngược lại — `defaultValue="new Date()"` là JavaScript chạy trên
trình duyệt. Đó là hai thứ khác nhau mang cùng một tên, và là lý do `scriptParamFields` cố ý
không đụng tới nó.

Mọi mẩu SQL đọc từ THUỘC TÍNH đều được gỡ escape XML trước khi ghép. `defaultValue="case when
ma_so_thue &lt;&gt; '' then 0 else 1 end"` — dấu `<>` phải viết escape trong XML, mà bộ quét trả
về nguyên văn thuộc tính (nó giữ offset để ghi ngược, nên không được đổi độ dài chuỗi). Đưa
thẳng vào là `&lt;&gt;` chạy vào SQL Server.

`%l` phân giải cả trong THÂN câu query, không chỉ trên `<field>`: câu Loading của
`Grid/CustomerParameterDetail.f` viết thẳng `isnull(a.val_view%l, b.val_view%l)`. Chuỗi
`like '%lo%'` không bị đụng tới — phép thay đòi một định danh đứng ngay trước `%l`.

Ba quyết định đáng ghi lại vì chúng không suy ra được từ file:

`$partition$current` ra **tháng/năm hiện tại**, không dò `partition@default`. Luật: có thẻ
`<partition>` thì chắc chắn có chia kỳ.

Số dòng của lưới chi tiết chặn bằng **`SET ROWCOUNT`**, không phải bằng `top`. Bản đầu chèn
`top N` vào chữ `select` đầu tiên, đọc từ 14 file văn bản thường lúc ấy nhìn thấy; bung entity
ra thì con số thật là 92 câu, và 42 trong số đó là SCRIPT nhiều câu có `declare`, `if … else`,
bảng tạm, tới 43 chữ `select` (`Grid/BillDetail.f`). Ở đó chữ `select` đầu tiên là
`select @whereKey = '…'` — một phép gán — nên câu thật vẫn kéo về cả bảng. Không có luật regex
nào chọn đúng «câu trả dữ liệu» trong một script như thế. `SET ROWCOUNT` chặn mọi bộ kết quả của
cả batch mà không đụng một ký tự nào vào SQL của file, đúng hợp đồng đã ghi. Nó cũng chặn các
câu `insert into #tmp` ở giữa script — `notes` nói ra điều đó thay vì để người đọc tự phát hiện.

`'#$query'` của câu Processing thành một bảng tạm **TOÀN CỤC** (`##`), không phải cục bộ.
Proc báo cáo dựng `select … into <tên>` bằng SQL động, mà bảng `#` tạo trong một `exec()` chết
ngay khi `exec()` ấy kết thúc — đọc lại là rỗng, mà rỗng thì trông y hệt "báo cáo không có dòng
nào". Giá của `##` là tên hằng nên hai người chạy cùng lúc đụng nhau; `drop` ở cả hai đầu làm nó
tự lành sau một nhịp.

Câu lệnh in ra một **dòng mốc** trước phần dữ liệu. Câu Processing của mọi báo cáo có vài
`select` phụ đứng trước `exec` (dòng tiêu đề, tham số lề in), mà `sqlcmd -h -1` nối mọi bộ kết
quả thành một khối — không cắt ở mốc thì mấy dòng phụ thành mấy dòng dữ liệu đầu tiên, sai mà
nhìn vẫn ra vẻ đúng.

`%l` phân giải theo `@@language`: `1` ra `ten_kh`, `2` ra `ten_kh2`. Một công tắc cho cả câu
lệnh, cùng chỗ với mọi biến `@@…` khác — chứ không phải một tuỳ chọn thứ hai để hai bên lệch
nhau. NHÃN cột trả về thì vẫn giữ NGUYÊN VĂN tên khai (`ten_kh%l`): `renderGridHtml` tra ô theo
`field@name`, đổi nhãn sang tên đã phân giải là cả cột im lặng rỗng.

### Sửa — `@@textList` của lưới chứng từ phải TRẦN, và thứ tự cột là của `<fields>`

Hai lỗi cùng lộ ra khi đối chiếu với câu runtime thật của `Grid/SOTran.xml` (HOATP FBISP2421) và
đọc định nghĩa `FastBusiness$App$Voucher$Loading` trên chính database ấy.

**1. Bọc hex `@@textList` là phá phép join.** Proc dùng hai danh sách cột vào hai việc khác hẳn:

    insert into #t select <@@textList> from m64$<kỳ> where stt_rec in (select c from #r)
    select <@@textExternal> from #t a left join dmkh b on a.ma_kh = b.ma_kh …

`@@textList` dựng BẢNG TẠM `#t`, rồi `#t` mang alias `a` và được JOIN bằng chính giá trị của nó.
Bọc hex ở đó hỏng hai lần cùng lúc: `a.ma_kh` thành chuỗi hex nên `on a.ma_kh = b.ma_kh` không
bao giờ khớp (mọi cột đến từ bảng join — `ten_kh`, `ten_nvbh`, `u0.statusname` — về NULL), và
`@@textExternal` còn bọc hex LẦN NỮA lên giá trị đã là hex.

Nay chỉ **vế chiếu cuối cùng** mới bọc: `@@textExternal`, `@@fieldExternal`, và danh sách của
nhánh danh mục/báo cáo. `@@textList` để trần — nó là dữ liệu trung gian, không ai đọc.

Đây cũng là lý do `ma_ct` phải có trong `@@textList`: mệnh đề join của cấu hình là
`left join dmttct u0 on a.ma_ct = u0.ma_ct and a.status = u0.status`, mà `a` chính là `#t`.
Thiếu `ma_ct` trong `@@textList` thì `#t` không có cột ấy và cả câu chết.

**2. Thứ tự cột là của `<fields>`, không phải của `<view>`.** Hai chi tiết của câu runtime chỉ
khớp khi đi đường `<fields>`:

- `t_ck_nt`…`t_tt_nt` đứng SAU `ten_nvbh` trong câu SQL, dù trên lưới chúng đứng TRƯỚC `ma_nt` —
  vì `Config/Fields/SOTran.xml` khai `arrangement="…t_ck_nt:%b(ma_nt);…"`. `arrangement` là phép
  sắp CHỖ NGỒI TRÊN LƯỚI; đem nó vào câu SQL là xếp sai đúng bốn cột tiền.
- `ma_ct` nằm GIỮA `dien_giai` và `status`, đúng chỗ nó được khai trong
  `Grid/Config/Include/Voucher.Field.Status`. `<view>` của group ấy không liệt kê nó, nên mọi
  cách xếp theo view đều đẩy nó ra cuối.

Thứ tự SQL không ảnh hưởng thứ tự trên màn hình: tầng vỏ ghép cột theo VỊ TRÍ rồi khoá dòng theo
tên, còn `renderGridHtml` tra ô theo `field@name` của cột nó đang vẽ.

Kiểm trên database THẬT của HOATP (`HOATP_FBISP2421_A`), chỉ-đọc:

- `@@textList` sinh ra khớp TỪNG KÝ TỰ với câu runtime người dùng cung cấp.
- Vòng hex đi-về chính xác: `4300D400…` giải ra đúng `CÔNG TY TNHH THƯƠNG MẠI VÀ DỊCH VỤ HÒA
  THÀNH PHÁT`.
- Mô phỏng đúng hai bước cuối của proc bằng SELECT thuần trên `m64$202609`: cả ba phép join đều
  khớp, `ten_kh`/`ten_nvbh`/`u0` có giá trị, và sau khi giải hex + định dạng thì ra
  `Chờ duyệt`, `Khách hàng nhóm KV1`, `04/09/2026`, `109 296.00`.

Giới hạn còn lại, nói ra để không ai đi tìm: khi câu `Loading` của một lưới chi tiết viết THẲNG
danh sách cột của nó thay vì dùng `@@fieldExternal` (`select top 0 file_name, … from sysfileinfo`
của `Grid/BIILApprovalFiles.f`), ta không bọc hex được — đó là SQL của file, không phải danh sách
ta dựng. Đo trên HOATP FBISP2421: 18 lưới rơi vào ca này, và cả 18 đều là MỘT màn hình lặp lại —
lưới danh sách tệp đính kèm đọc `sysfileinfo` (`*ApprovalFiles`, `*PurchaseOrderFiles`,
`PurchaseRequisitionFiles`), cùng một câu `select top 0 … from sysfileinfo` chép sang từng chứng
từ. `top 0` nên không có dòng nào để hỏng; cột hỏng được nếu có sẽ là `file_name` tiếng Việt.

Một điều đo được đáng ghi: `m64$000000` của khách này RỖNG — dữ liệu nằm ở `m64$202609`. Proc tự
dựng hậu tố kỳ từ `@@expression` áp lên `ngay_ct` của từng dòng, còn `@@extension` (`'000000'`)
nó chỉ dùng để lấy HÌNH DẠNG CỘT cho bảng tạm. Nên bản khai hiện tại (`@@extension` =
`partition@default`) là đúng, không phải chỗ cần sửa.

### Sửa — tiếng Việt về nguyên vẹn ở MỌI nhánh, không chỉ nhánh danh mục

`sqlcmd` ghi stdout theo CODE PAGE CONSOLE, và phép đổi ấy dùng «best-fit» của Windows: chữ nào
có chữ cái gốc thì rụng dấu, chữ nào không thì thành `?`. Đó đúng là hình dạng người dùng báo —
`CÔNG TY … THƯƠNG MẠI` ra `CONG TY … THUONG M?I`, mất dấu chứ không phải mất hết.

Cột chữ đã đi dạng hex, nhưng CHỈ ở nhánh danh mục và báo cáo. `@@textList`, `@@textExternal`,
`@@fieldExternal` bị để ngoài với lý do «đó là danh sách cột đưa vào query của file, không phải
giá trị trả về». Sai: proc ghép thẳng ba danh sách ấy vào `select`, nên chúng LÀ giá trị trả về
— và đó là lý do lưới chứng từ và lưới chi tiết vẫn ra `M?I`. Nay bật cho cả bốn nhánh.

Bọc thêm một lớp `convert(nvarchar(4000), …)` ở trong cùng, và nó xoá một phép ĐOÁN: không có
lớp ấy thì dãy byte phụ thuộc KIỂU CỘT (`nvarchar` ra UTF-16LE, `varchar` ra code page của
collation), nên tầng vỏ phải đoán mình đang cầm cái nào — bản trước đoán bằng cách đếm byte lẻ
bằng 0, mà một tên toàn tiếng Việt (`Ạ` = A0 1E) có ít byte 0 hơn hẳn một tên tiếng Anh. Phép
đoán ấy lật đúng vào chuỗi khó nhất. Ép kiểu ở vế SQL rẻ hơn mọi phép đoán ở vế JS, và
`decodeHexCell` nay chỉ còn một dòng.

Chỉ bọc cột CHỮ: tầng vỏ cũng chỉ giải hex cho cột chữ, nên bọc một cột số là nó hiện ra đúng
dãy hex.

### Thêm — định dạng theo `dataFormatString`, và canh lề theo kiểu cột

Dữ liệu về từ `sqlcmd` là văn bản thô của SQL Server; runtime thì hiện khác hẳn:

    2026-09-07 00:00:00.000   →   07/09/2026
    1234567.8900              →   1 234 567.89

Một bản xem trước để ĐO BỀ RỘNG CỘT mà hiện chuỗi thô là đo sai, và sai theo hướng khó nhận ra:
chuỗi thô DÀI HƠN chuỗi thật (`.000` thừa ở mọi ô ngày), nên cột nào cũng có vẻ chật hơn thực tế.

`field@dataFormatString` có hai loại, và chúng không cùng một ngôn ngữ: `@tên` TRỎ tới một biến
trong `Options/Options.xml` của program (`@datetimeFormat` → `dd/MM/yyyy`,
`@foreignCurrencyAmountViewFormat` → `# ### ### ### ###.00`), còn mặt nạ viết thẳng thì chính nó
là mặt nạ. Không đọc được `Options.xml` thì KHÔNG đoán — giá trị rơi về dạng thô.

Mặt nạ số đọc theo nghĩa đen: dấu ngăn nhóm là đúng ký tự viết trong mặt nạ (FBO dùng khoảng
trắng), số chữ số lẻ đúng bằng số ký tự sau dấu `.`. Cặp `Input`/`View` khác nhau đúng một chỗ,
và chỗ ấy có nghĩa:

    foreignCurrencyAmountInputFormat   # ### ### ### ##0.00   → 0 hiện ra `0.00`
    foreignCurrencyAmountViewFormat    # ### ### ### ###.00   → 0 để TRỐNG ô

Hàng đơn vị của mặt nạ `View` là `#` chứ không phải `0`, tức không buộc in chữ số — quy ước «số 0
thì để trống» làm lưới FBO nhìn thưa chứ không dày đặc số 0. Bỏ qua nó là bản xem trước đầy
`0.00` ở những ô runtime để trắng.

Ngày KHÔNG đi qua `new Date()`: nó diễn giải theo múi giờ của máy, và một ô ngày lệch một ngày vì
múi giờ là lỗi không ai ngờ tới ở một công cụ xem trước. Mặt nạ thay trong MỘT lượt, vì `mm`
(phút) là chuỗi con của `MM` (tháng).

Canh lề mặc định nay theo KIỂU cột: **số canh phải, ngày canh giữa, còn lại canh trái**.
`<items style="Numeric">` một mình là chưa đủ — phần lớn cột tiền của lưới chứng từ khai
`type="Decimal"` mà KHÔNG khai `<items>` (`t_tt_nt`, `t_ck_nt`, `t_thue_nt` của
`Grid/Config/Fields/SOTran.xml`), nên trước đây chúng dính lề trái trong khi runtime canh phải.
Nhánh «còn lại» trả `null` chứ không trả `left`: `text-align` mặc định của `<input>` đã là trái.

Mọi nhánh không định dạng được đều rơi về giá trị THÔ, không nhánh nào ném — một ô hiện số thô
vẫn đọc được, một bản vẽ chết vì một ô lạ thì không.

Test: 38 phép kiểm ở `core/test/test-format.mjs`.

### Sửa — lấy MỌI field đã khai, không chỉ field có mặt trong `<view>`

Danh sách cột trước đây dựng thuần từ `view/field`. Thiếu, và ca chứng minh nằm ngay trong
`Grid/Config/Include/Voucher.Field.Status`: nó khai ba field — `ma_ct`, `status`, `u0` — nhưng
`<view>` của group chỉ liệt kê `status` và `u0`. `ma_ct` không có mặt ở view nào cả, mà câu
runtime thì vẫn mang `rtrim(a.ma_ct) as ma_ct`.

Nay: **mọi field đã khai đều vào câu lệnh**, xếp theo thứ tự của `view` (kể cả phép sắp
`arrangement` của cấu hình ẩn); field không có mặt trong `view` xếp SAU CÙNG, theo thứ tự khai.

Cột thừa không tốn gì: `renderGridHtml` tra ô theo `field@name` của cột nó đang vẽ, nên một khoá
thừa trong dòng dữ liệu chỉ nằm đó không ai đọc. Thiếu thì ngược lại — ô hiện gạch chéo «không
lấy được dữ liệu», và với `@@textList` thì tệ hơn hẳn: thiếu một cột là proc dựng ra một câu
khác hẳn câu thật.

Đo trên `Grid/` của FBISP24: 31 lưới có cột chỉ khai ở `<fields>` (49 cột) — `ma_ct` của sáu lưới
chứng từ, `nhieu_dvt`/`sua_tk_vt` của mười bốn lưới chi tiết, `ma_kho`/`ten_kho%l`/`ma_tt`/
`ten_tt%l` của mấy lưới thuế. Thêm một lưới danh mục dựng được câu mà trước đây trả về
`no_columns` vì `<view>` của nó rỗng.

### Sửa — `Grid/Config` thêm cột thì cũng phải thêm JOIN nuôi cột ấy

Cấu hình ẩn đã được gộp vào DANH SÁCH CỘT của câu mẫu. Cái còn thiếu là vế kia: cấu hình cũng
sửa câu query, và nó khai điều đó dưới dạng VÁ CHUỖI chứ không phải một câu query mới.

    <query event="Loading">
      <items>
        <item source="a left join dmkh b on a.ma_kh = b.ma_kh"
              destination="a left join dmkh b on a.ma_kh = b.ma_kh left join dmnvbh v0 on …" />
      </items>
    </query>

Bỏ qua vế ấy là câu mẫu mang `rtrim(v0.ten_nvbh) as ten_nvbh` trong khi mệnh đề join truyền cho
`FastBusiness$App$Voucher$Loading` không hề có `v0` — "The multi-part identifier could not be
bound", và nó giết CẢ câu chứ không chỉ một cột.

`Grid/SOTran.xml` của HOATP FBISP2421 là ca đủ cả hai mảnh, và hai bản vá neo vào hai chỗ khác
nhau — đó là chi tiết đáng ghi lại nhất:

    Config/Fields/SOTran.xml   neo vào chính mệnh đề join   → thêm `left join dmnvbh v0`
    Initialize group 001       neo vào `', @@textOrderBy`   → thêm `left join dmttct u0`

Mảnh thứ hai neo vào DẤU NHÁY ĐÓNG của chuỗi join cộng tham số kế tiếp, nên nó chèn vào bên
trong chuỗi ấy mà không đụng gì tới mảnh thứ nhất. Nhờ vậy hai phép vá không tranh nhau — nhưng
thứ tự áp vẫn theo `rank` (Fields trước Initialize, cùng thứ tự `mergeGridConfig` dùng để xếp
cột), vì dựa vào sự không-tranh-nhau ấy là dựa vào một trùng hợp, không phải một luật.

Áp bản vá TRƯỚC khi thay `@@…`: bản khai neo vào chính tên biến, nên thay biến trước là không
còn gì để tìm. Thay bằng `split`/`join` chứ không bằng `RegExp` — `source` là một mẩu SQL thường,
đầy ký tự có nghĩa trong biểu thức chính quy.

`event="Scattering"` CỐ Ý không đọc: `source` của nó là BIỂU THỨC CHÍNH QUY (`\bstatus\b`,
`[(]ma_ct[)]`) và nó vá mệnh đề LỌC, không vá câu query. Trộn hai loại vào một bảng là để một
`\b` chạy vào phép thay chuỗi thường. `<clauses><clause statement=…>` cũng không nhặt.

### Sửa — `defaultValue` cũng là nguồn của cột trên lưới CHỨNG TỪ

Bản trước giới hạn `defaultValue` ở lưới `Detail`. Sai, và ca chứng minh là cột «Trạng thái» của
gần như mọi lưới chứng từ: `<field name="u0" external="true" defaultValue="rtrim(u0.statusname%l)">`
khai trong `<group id="001">` của `Grid/Config/Initialize.xml`. Không alias, không cột `u0` trên
bảng master, nên `rtrim(a.u0)` là "Invalid column name".

Ranh giới thật là NGUỒN của lưới, không phải `type`:

- **chứng từ / lưới chi tiết** đọc bảng master/chi tiết (`m64$000000`, `d31$000000`) cộng mấy
  mệnh đề join viết rõ trong câu. `external="true"` không alias ở đó nghĩa là cột KHÔNG nằm trên
  hàng gốc, chấm hết — `defaultValue` là nguồn duy nhất còn lại.
- **danh mục / báo cáo** đọc một nguồn PHẲNG, mà nguồn ấy hay là một view đã join sẵn:
  `Grid/Customer.xml` của HOATP đọc `viewdmkh`, nơi `ten_nvbh` là cột có thật. Ở đây `external`
  không nói được gì về việc cột có tồn tại hay không, nên `defaultValue` chỉ được dùng khi nó là
  BIỂU THỨC — hằng `''`/`0` thì bỏ qua và SELECT cột thật.

Đo trên `App_Data\Controllers` của HOATP FBISP2421 sau khi sửa: 612 lưới danh mục, 118 lưới chi
tiết và 25 lưới chứng từ dựng được câu; 22 lưới được áp bản vá của cấu hình; và **không lưới nào
còn alias xuất hiện ở vế `select` mà thiếu trong mệnh đề join** — đúng cái lỗi runtime mà cả hai
bản sửa này tồn tại để chặn.

### Thêm — tự lấy dữ liệu thật khi mở giao diện giả lập

`fboDesigner.autoLoadSampleData`, **mặc định BẬT**: mở designer cho một lưới thì dữ liệu thật đổ
vào ngay, không cần bấm `Ctrl+Alt+D` nữa.

Điều này lật một luật đã ghi ở đầu `sample-host.js` từ bản đầu — «KHÔNG BAO GIỜ TỰ CHẠY: dữ liệu
thật của khách không phải thứ tự dưng chảy về máy lập trình viên». Lật theo yêu cầu của người
dùng (2026-09-07), và luật cũ vẫn còn nguyên trong file kèm lý do lật, vì nó là thứ người sửa
tiếp cần đọc trước khi nới thêm.

Bốn thứ chặn lại, và chúng mới là phần đáng đọc:

- **Chỉ lưới, một lần cho mỗi file.** Bốn cửa chặn (tuỳ chọn tắt / không phải controller lưới /
  đã có dữ liệu / người dùng đã tự tắt) đều rẻ và đều đứng TRƯỚC lượt nối database, nên nhảy qua
  nhảy lại giữa hai file không sinh ra một lượt `sqlcmd` nào.
- **Lượt tự nạp KHÔNG BAO GIỜ HỎI.** Lưới báo cáo (cần tham số + hộp xác nhận) và lưới có tham số
  `@x` bị bỏ qua, im lặng, kèm một dòng lý do ở Output. Một hộp thoại tự bật lên vì người ta vừa
  MỞ một file là thứ dạy người ta tắt tuỳ chọn — mà tuỳ chọn ấy vừa được bật mặc định.
- **TẮT TAY THẮNG.** Bấm `Ctrl+Alt+D` để tắt dữ liệu của một file thì file ấy không tự nạp lại
  trong phiên này. Không có luật này thì tắt xong, nhảy sang file khác rồi quay lại là dữ liệu tự
  về — người dùng vừa bảo «đừng hiện nữa» và công cụ hiện lại ngay.
- **Không `await`, không ném.** Bố cục vẽ ra ngay; kho dữ liệu tự bảo panel vẽ lại khi có dòng.
  Một lượt tự nạp ném ra là cả `track()` của panel chết theo, mà bản xem trước phải vẽ được bố
  cục kể cả khi không nối được database — đó mới là thứ designer sinh ra để làm.

Che dữ liệu vẫn BẬT mặc định, nên thứ tự nạp về là chuỗi đã che, giữ nguyên độ dài.

### Thêm — bản khai giá trị cho các biến `@@…`

`core/config/sample-params.json`, đè được bằng thiết lập `fboDesigner.sampleParams`. Mỗi giá trị
là một MẨU SQL chứ không phải một giá trị — chuỗi phải tự mang dấu nháy — vì cùng một biến khi
thì là tham số chuỗi (`@@id` → `'HDA'`), khi thì là tên bảng ghép thẳng
(`@@sysDatabaseName..ticket`); một lớp tự thêm nháy sẽ sai đúng một nửa số chỗ.

`@@appDatabaseName`/`@@sysDatabaseName` lấy từ `Web.config`. Vì thế lệnh nay **nối database
TRƯỚC** khi dựng câu lệnh: hai biến ấy có mặt ở 750 chỗ trong FBISP24, dựng trước rồi mới nối là
dựng ra một câu còn nguyên chúng, tức một câu chắc chắn hỏng.

### Thêm — hỏi tham số của câu query, và hỏi lại trước khi chạy báo cáo

Tham số `@x` không đoán: chúng là điều kiện lọc của người dùng (từ ngày, đến ngày, kho nào), và
đoán một khoảng ngày là chạy một báo cáo trên khoảng dữ liệu không ai yêu cầu. Extension quét ra
đúng những tham số script DÙNG mà KHÔNG tự `declare` (khai lại một biến script tự khai là lỗi
biên dịch — `rptStockBalance` mở đầu bằng `declare @c varchar(1024)`), ghép với `<field>` của
chính file Filter để có nhãn và giá trị mặc định thật, rồi hỏi bằng một danh sách bấm-để-sửa.
Không phải một chuỗi hộp nhập nối đuôi: báo cáo tồn kho hỏi 17 tham số mà người ta thường chỉ
sửa hai.

`defaultValue` KHÔNG dùng làm giá trị mặc định — nó là JavaScript chạy trên trình duyệt
(`new Date()`), không phải một hằng. `clientDefault` mới là hằng.

Không riêng báo cáo: 6 lưới chi tiết của FBISP24 cũng cần (`@ma_vt`, `@stt_rec` — khoá của hàng
cha mà runtime bơm vào), và bỏ qua chúng là dựng ra một câu chắc chắn chết ở "Must declare the
scalar variable". Cùng một cơ chế, cùng một hộp thoại; nhãn lấy từ `<field>` của file Filter với
lưới báo cáo, của chính file lưới với những lưới còn lại.

Rồi hỏi lại một lần nữa bằng hộp thoại modal trước khi chạy — chỉ với lưới báo cáo. Đây là nhánh duy nhất gọi một
stored procedure của khách với tham số vừa nhập: nó có thể quét cả năm dữ liệu và ghi bảng tạm y
như một lần chạy báo cáo thật. Hạn giờ nới lên 60 giây cho riêng nhánh này; ba nhánh còn lại
giữ 10 giây.

### Giới hạn — nói ra thay vì đoán

Câu query của file gốc `.f` nằm trong `<Encrypted>`: 729/751 câu Processing, và 464 câu Loading
của `Grid/` (320 lưới chi tiết + 144 lưới chứng từ). Extension nói thẳng «đang mã hoá» chứ không
im lặng trả về lưới rỗng. Đo trên corpus FBISP24, ba nhánh mới chạy được ở 84 lưới chi tiết, 7
lưới chứng từ và 44 lưới báo cáo — toàn bộ là file `.xml` đã customize, tức đúng loại file người
ta mở designer ra để sửa. Nhánh danh mục chạy được ở toàn bộ 551 lưới đo được. (6 lưới chi tiết trong số 84 kia hỏi thêm tham
số trước khi chạy.)

Lưới `Inquiry` (207 file) không tự lấy dữ liệu — màn hình cha bơm vào — nên bị từ chối kèm lý do.

Test: 124 phép kiểm ở core cho bốn nhánh + 40 ở tầng vỏ cho cả luồng (nối database trước, hỏi
tham số, huỷ ở bất kỳ đâu là không chạy gì, và bốn cửa chặn của lượt tự nạp). Bản giả `vscode` nay vào vai được người dùng —
xếp sẵn câu trả lời cho `showQuickPick`/`showInputBox`, đọc lại `asked` để khẳng định đã hỏi
đúng những gì.

## [1.0.2] — 2026-09-07

### Thêm — RÊ CHUỘT và GỢI Ý, và chỗ ba mảng gặp nhau

Bước cuối của bản kế hoạch. Hover trên một field hiện nhãn, kiểu, `maxLength`, bề rộng,
`aliasName`, và FILE KHAI NÓ — chỉ khi đó không phải file đang mở, vì nhắc lại tên file người ta
đang nhìn là một dòng không mang tin nào. Hover trên `&Name;` hiện nó trỏ tới file nào, hoặc
chính giá trị nếu khai inline, hoặc nói thẳng «chưa có khai báo».

Điều đáng kể nhất không phải bản thân hover mà là thứ nó GHÉP LẠI. Sau khi bấm `Ctrl+Alt+D`,
hover kèm luôn thống kê dữ liệu thật:

    ten_kh — Tên khách
    String · width 60px · aliasName="b"
    khai ở Include/SVTran-SharedFields.xml
    dữ liệu thật: dài nhất 32 ký tự / 10 dòng (đã che, độ dài giữ nguyên)

`width 60px` và `dài nhất 32 ký tự` đứng cạnh nhau, và đó là toàn bộ câu trả lời cho «cột này có
đủ rộng không» — câu hỏi mà cả nhánh xem-trước sinh ra để trả lời, nay gọn trong một lần rê
chuột. Ba thứ dựng riêng ở ba bước khác nhau (chẩn đoán biết field khai ở đâu, xem-trước biết dữ
liệu dài bao nhiêu, mục lục/F12 biết con trỏ đang ở đâu) chỉ có ích cùng nhau tại đúng chỗ này.

Hover KHÔNG hiện một giá trị nào, chỉ độ dài. Hover là chỗ dễ chụp màn hình nhất, và cả tính
năng xem-trước đã cố ý che dữ liệu đi rồi — hiện lại ở đây là mở đúng cánh cửa vừa đóng. Chưa
lấy dữ liệu thì không nhắc gì tới nó: một dòng «chưa lấy dữ liệu» trên mọi hover là tiếng ồn
dạy người ta thôi đọc hover.

Gợi ý bật bằng chính ký tự mở — `[` trong một `<item value>` ra danh sách field, `&` ra danh
sách entity. Không khai hai ký tự kích hoạt ấy thì gợi ý chỉ hiện khi người dùng tự bấm
`Ctrl+Space`, và gần như không ai biết là có.

Danh sách field lấy từ bản ĐÃ BUNG, không từ file đang mở: một controller dùng được mọi field mà
Include của nó kéo vào, nên gợi ý chỉ những field gõ thấy trong file này là bỏ mất phần lớn danh
sách — đúng ở những program dùng Include nhiều nhất. Có phép kiểm riêng cho điều đó.

`replaceStart` tính TỪ ký tự mở chứ không từ con trỏ. Không tính thì VS Code chèn thêm vào sau
phần đã gõ và ra `[ma_[ma_kh]` — lỗi nhìn thấy ngay, nhưng chỉ khi bấm chọn, tức là sau khi
tính năng đã có vẻ chạy.

Bối cảnh gợi ý nhận ra bằng cách nhìn LÙI từ con trỏ, không bằng cách phân tích cả tài liệu:
người dùng đang gõ dở thì tài liệu KHÔNG hợp lệ, và một bộ phân tích đòi hỏi hợp lệ sẽ im lặng
đúng vào lúc người ta cần gợi ý nhất.

`definitionTargetAt` nhận thêm tuỳ chọn `declarations`. Tắt (mặc định) cho F12 — nhảy từ một
định nghĩa tới chính nó là cú nhảy không đi đâu cả. BẬT cho hover — người ta rê chuột lên một
`<field>` chính là để đọc nó, và im lặng ở đó là im lặng đúng chỗ thông tin đầy đủ nhất.

Hai provider ở chung một file vì chúng hỏi cùng một thứ và trả lời từ CÙNG MỘT bản bung. Bản ấy
được nhớ theo (file, `document.version`): gợi ý bắn theo từng phím nên bộ nhớ này không cứu được
lượt gõ tiếp theo, nhưng nó cứu những lượt hỏi lại trong cùng một phiên bản — VS Code lọc lại
danh sách, hover ngay sau completion, hai provider cùng hỏi một chỗ.

Test: 26 phép kiểm ở core cho bối cảnh gợi ý (phần lớn là chỗ KHÔNG được gợi ý) + 37 ở tầng vỏ.
Đáng giá nhất là hai ca: field đến từ Include có mặt trong danh sách gợi ý, và hover đọc được
thống kê dữ liệu thật mà không lộ một giá trị nào.

### Thêm — ĐI TỚI ĐỊNH NGHĨA (`F12` / `Ctrl+click`) trong editor văn bản

Ba thứ nhảy được ngay trong file XML: tham chiếu `&Name;`, đường dẫn `SYSTEM "…"` trong khai
báo, và tên field (`[ma_kh]` trong `item value`, hoặc `<field name>` liệt kê cột của lưới).

**Hai lối nhảy tồn tại song song, và chúng KHÔNG trùng nhau.** Ctrl+click trên designer đi qua
`revealSource`: đích tính từ MODEL đã dựng (`origin`/`range`/`hostRef` mà `buildViewModel` gắn
lên từng hàng), và tầng vỏ còn quyết mở ở cột nào, có mở kèm file liên quan không. F12 trong
editor thì nhận một OFFSET thô và chỉ trả một `Location` — VS Code lo phần mở file.

Đầu vào khác nhau nên KHÔNG có bộ phân giải nào để tách ra dùng chung, ngược với dự đoán lúc
lập kế hoạch. Thứ thật sự dùng chung là `expandEntities`/`sourceRange` của core, và cả hai lối
đều đã đi qua đó từ trước. Chép lại một trong hai mới là chỗ chúng bắt đầu chỉ vào hai nơi khác
nhau — nên phần mới được cắt theo một đường khác:

    core/src/definition.mjs        THUẦN — nhìn văn bản thô tại một offset, trả lời «đây là cái
                                   gì». Không đọc đĩa, không bung entity.
    extension/src/definition-host  VỎ — cầm câu trả lời ấy đi TÌM đích: bung entity, tra bảng
                                   khai báo, quy dải về file nguồn.

Cắt ở đó vì «con trỏ đứng trên cái gì» chỉ cần chuỗi đang mở, nên nó test được headless với hàng
chục ca biên — đứng giữa token, đúng dấu ngoặc, trong comment, trên chính khai báo. Còn «cái đó
khai ở đâu» thì cần cả cây Include.

Entity trỏ FILE nhảy tới NỘI DUNG, không tới dòng khai báo: «đi tới định nghĩa» của `&Rows;` là
đi tới thứ nó bung ra, còn dừng ở `<!ENTITY Rows SYSTEM …>` là dừng ở tấm biển chỉ đường và bắt
người dùng bấm thêm lần nữa — đúng cái F12 sinh ra để khỏi phải làm. Entity khai INLINE thì
ngược lại: nội dung CHÍNH LÀ giá trị trong nháy, nên nhảy tới đó.

Đứng trên chính khai báo thì trả `null` — nhảy từ một định nghĩa tới chính nó là một cú nhảy
không đi đâu cả. Cùng vậy với list px, với pattern của hàng, và với mọi thứ đã comment.

Token nhận ra được nhờ `at`/`len` mà `parseRow` ghi lên từng token từ bước gắn toạ độ cho cảnh
báo. Không có chúng thì ở đây phải dò lại dấu ngoặc bằng tay, và bản dò thứ hai sẽ đọc
`[a].Label, [a]` khác bản thứ nhất ở đúng những ca lắt léo — có test khẳng định token THỨ HAI
của một hàng ra chính nó chứ không ra token đầu.

Hai chỗ được dọn thành của dùng chung trong lúc làm. `lineStarts`/`positionAt` gỡ khỏi
`diagnostic-host.js` thành [`text-position.js`](extension/src/text-position.js): cả gạch đỏ lẫn
cú nhảy đều đặt một dấu vào file bằng offset của core, và hai bản quy khác nhau nghĩa là chúng
chỉ vào hai chỗ khác nhau của cùng một khai báo. Bộ chọn file về `render-host.js` cạnh
`isControllerDocument` — nơi câu hỏi «file nào là của mình» vốn đã ở đó. Và bộ quét `&Name;` mở
ra khỏi `entities.mjs` thành `scanEntityRefs`, dùng chung với mục lục: hai bản quét cho cùng một
câu hỏi thì mục lục sẽ thấy một tham chiếu mà F12 không thấy, hoặc ngược lại.

Test: 41 phép kiểm ở core (phần lớn là ca biên và ca «KHÔNG được nhảy») + 18 ở tầng vỏ. Đáng giá
nhất là ca field khai ở INCLUDE — ca duy nhất mà một bản làm ẩu vẫn «chạy»: quên đi qua
`sourceRange` thì dải tính trên văn bản đã bung được áp thẳng lên file đang mở, ra một vị trí
hợp lệ trỏ vào một chỗ tình cờ, và không có lỗi nào để lần ra. Phép kiểm cắt văn bản THẬT của
file Include tại dải trả về và so chữ.

### Thêm — MỤC LỤC FILE (`Ctrl+Shift+O` và panel Outline)

Controller thật dài vài nghìn dòng, và tới giờ cách duy nhất để tìm một khai báo trong đó là
cuộn. Nay có cây cấu trúc: `fields`, từng `view` với hàng/cột/tab của nó, `toolbar` — bấm một
mục là con trỏ nhảy tới đúng chỗ khai.

**Quét VĂN BẢN THÔ, không bung entity** — và đây là chỗ đi NGƯỢC lại thói quen vừa hình thành
qua bốn bước chẩn đoán, nên nó được viết thành một khối riêng ở đầu
[`core/src/outline.mjs`](core/src/outline.mjs):

    Chẩn đoán   hỏi «bản khai này SAI ở đâu» → phải bung, vì lỗi nằm ở hàng file này kéo vào
    Outline     hỏi «FILE NÀY khai những gì» → tuyệt đối không bung

Liệt kê hai chục field đến từ một Include dùng chung là dựng mục lục cho một tài liệu không tồn
tại, và bấm vào thì nhảy sang file khác. Hệ quả cố ý: một view mà mọi hàng đến từ `&Rows;` hiện
ra đúng một nút `&Rows;` — vừa là câu trả lời thành thật, vừa nói luôn muốn sửa hàng thì phải
sang file kia.

Không có nút GỐC: VS Code đã hiện tên file ngay trên cây, thêm một nút `<grid table="…">` bọc
ngoài là một tầng phải bung ra mỗi lần mở đổi lấy thông tin đã có ở nhãn tab.

Hàng hiện DANH SÁCH TOKEN chứ không phải cả chuỗi `value`, pattern xuống dòng mô tả: người mở
mục lục đi tìm «hàng nào có `ma_kh`», không đi tìm «hàng nào pattern `110-`». Cột lưới hiện
`aliasName` tra từ khối `<fields>` — không phải từ thẻ cột của view, vốn chỉ liệt kê tên. Đọc
nhầm chỗ ấy thì detail rỗng trơn trên mọi file thật và mục lục im lặng bỏ mất đúng thông tin
đáng thấy nhất ở một lưới: cột này lấy dữ liệu từ bảng nào. (Cùng cái bẫy đã sập một lần ở bước
thêm luật chẩn đoán; lần này test bắt được ngay.)

PHẠM VI RỘNG HƠN designer, có chủ ý. Designer chỉ vẽ `Dir`/`Filter`/`Grid` vì chỉ ba thư mục ấy
ra được một màn hình. Mục lục thì không cần vẽ gì — một `Include\*.ent` khai bốn chục `<field>`
vẫn có mục lục hữu ích, và đó lại đúng là loại file dài nhất, khó cuộn nhất. Bộ chọn bắt theo
ĐƯỜNG DẪN chứ không theo `language`: VS Code không biết `.f` là ngôn ngữ gì, nên chọn theo
language là bỏ qua đúng nửa số file của dự án.

Không tìm thấy gì thì trả `undefined`, KHÔNG phải `[]`: `[]` là câu trả lời «tôi phụ trách file
này và nó rỗng» — nó chiếm chỗ và đuổi mất outline của provider khác. Core ném thì cũng nhường,
chỉ ghi Output: gõ dở một thẻ là chuyện thường của file đang sửa, và một hộp lỗi mỗi lần gõ tệ
hơn hẳn việc outline lặng lẽ giữ bản cũ.

Không gate license, cùng lý do với chẩn đoán: đây là thứ editor tự hỏi khi người dùng bấm
`Ctrl+Shift+O`, không phải một lệnh người ta chủ động chạy.

Hai bộ quét được bổ sung offset để có dải mà neo: `scanFields` nay trả `end` (biên cả phần tử,
tới `</field>`), và nút của `scanToolbar` trả `start`/`end`. Cả hai đều là thứ bước sau
(DefinitionProvider) cũng sẽ cần.

Logic cây ở core, thuần và test được headless (`kind` là CHUỖI); tầng vỏ
[`extension/src/symbol-host.js`](extension/src/symbol-host.js) chỉ đổi chuỗi thành
`vscode.SymbolKind` và offset thành `Range`. Bảng ánh xạ ấy là chỗ duy nhất biết về `vscode`
trong cả tính năng.

Test: 44 phép kiểm ở core + 34 ở tầng vỏ. Hai bất biến gánh phần lớn giá trị — mọi dải CẮT RA
ĐÚNG thứ nó nói (mục lục sai dải thì tệ hơn không có mục lục, vì người ta tin nó), và dải CHỌN
luôn nằm TRONG dải phần tử (VS Code NÉM nếu không, và ném lúc dựng outline thì mất cả cây chứ
không mất riêng một mục). Cộng một phép kiểm bắt ca «core thêm loại nút mới mà quên bảng ánh
xạ» — ca không ném, chỉ hiện sai icon.

### Thêm — XEM DỮ LIỆU THẬT trên lưới (`Ctrl+Alt+D`)

Hai bước trước dựng câu lệnh và dựng chỗ vẽ; bước này nối chúng vào một lệnh. Mở một lưới, bấm
`Ctrl+Alt+D`, vài dòng thật đổ vào chính bản vẽ đang xem — đúng bề rộng cột, đúng chỗ runtime
cắt chữ. Bấm lại để bỏ đi (một phím tắt bật/tắt dễ nhớ hơn hai lệnh, và «tắt đi» là việc người
ta muốn làm ngay sau khi đo xong cột).

Đây là lệnh DUY NHẤT của extension đọc DỮ LIỆU NGHIỆP VỤ của khách — mọi lệnh khác chỉ đọc lược
đồ (`sys.columns`, `sys.types`) hoặc sinh script cho người khác chạy. Nên nó có bốn luật riêng,
viết ngay đầu [`extension/src/sample-host.js`](extension/src/sample-host.js):

1. **KHÔNG BAO GIỜ TỰ CHẠY.** Không nhánh nào gọi nó khi mở file, khi gõ phím, hay khi vẽ lại.
2. **CHE MẶC ĐỊNH BẬT.** Chữ thành `x`/`X`, số thành `0`, giữ NGUYÊN ĐỘ DÀI.
3. **CHỈ ĐỌC, CÓ TRẦN, CÓ HẠN GIỜ.** `TOP` trần 100, `READ UNCOMMITTED`, `sqlcmd` hạn 10 giây.
4. **KHÔNG GIỮ LẠI.** Trong bộ nhớ phiên, không ghi đĩa, `deactivate` là quên sạch.

Che mà vẫn đo được cột là nhờ một điều: thứ làm một cột bị cắt là ĐỘ DÀI, không phải nội dung.
Dấu phân cách giữ nguyên (`12/03/2026` → `00/00/0000`, `KH-0012` → `XX-0000`) vì chúng vừa là
phần lớn hình dạng chuỗi vừa không nói gì về danh tính ai. Phần KHÔNG giữ được cũng nói thẳng:
bề rộng từng chữ cái khác nhau trong font tỉ lệ, nên chuỗi đã che rộng XẤP XỈ chứ không bằng
đúng chuỗi gốc — ai cần đo tới từng pixel thì tắt công tắc trong một lát. Đó là lý do nó là một
công tắc chứ không phải một luật cứng.

Trạng thái sống trong một KHO riêng ([`sample-store.js`](extension/src/sample-store.js)) khoá
theo đường dẫn file, không phải một trường trên panel. Designer có HAI bề mặt — `PreviewPanel`
bám theo file đang active, custom editor gắn cứng vào một document — khác nhau ở vòng đời và
cách giữ trạng thái, nhưng cùng gọi `buildPayload`. Đặt dữ liệu ở chỗ `buildPayload` đọc được
thì cả hai cùng thấy, lệnh không phải biết người dùng đang mở bề mặt nào, và dữ liệu SỐNG QUA
mọi lần vẽ lại — gõ tay vào XML, kéo một control, đổi ngôn ngữ nhãn — thay vì biến mất sau nhịp
render đầu tiên.

Payload gửi sang webview mang TÓM TẮT (số dòng, đã che hay chưa, lý do từng cột bị bỏ) chứ
KHÔNG mang lại chính dữ liệu: giá trị thật đã nằm trong `html` rồi, gửi thêm một bản nữa là chép
dữ liệu của khách qua ranh giới lần thứ hai mà không ai đọc bản thứ hai ấy. Cùng lý do, câu lệnh
đã chạy chỉ ghi ra Output Channel chứ không vào thông báo lỗi — thông báo thì hay bị chụp lại
gửi đi, mà câu lệnh thì mang tên bảng và tên cột của khách.

Cột không lấy được hiện GẠCH CHÉO XÁM, không phải đỏ: đây không phải lỗi của bản khai, chỉ là
chỗ phép xem trước không với tới. Đỏ ở đây là gọi một chuyện bình thường thành một chuyện phải
sửa.

Lệnh này ĐI QUA `withLicense`, khác chẩn đoán ở bước trước. Chẩn đoán là gạch đỏ chạy nền, khoá
lại thì người chưa kích hoạt không hiểu vì sao im lặng. Lệnh này thì ngược hẳn — nó đọc dữ liệu
nghiệp vụ qua một kết nối database thật, đúng loại việc mà license nói ai được phép làm.

`resolveTargetConnection` (giải `%Database` qua `sys.entity.cdata`) dọn từ `add-column-host.js`
lên [`sql-host.js`](extension/src/sql-host.js) cho hai lệnh dùng chung. Chép sang bản thứ hai là
hai bản sẽ lệch nhau đúng vào ngày một khách nào đó khai `%Database` theo kiểu chưa gặp — và bản
lệch thì nối vào SAI DATABASE mà vẫn chạy trơn.

`NULL` của SQL về CHUỖI RỖNG: `sqlcmd` in ô null ra bốn chữ `NULL`, để nguyên thì lưới hiện một
ô rộng bốn ký tự ở chỗ runtime hiện ô trống — sai đúng cái người ta đang đo. Đổi lại, một ô chứa
đúng văn bản "NULL" cũng thành rỗng; đánh đổi ấy nghiêng hẳn về phía đo đúng bề rộng.

Test: 20 phép kiểm cho phép che ở core, 15 cho kho, và 15 cho MỐI NỐI giữa kho và phép vẽ
([`extension/test/test-sample-render.mjs`](extension/test/test-sample-render.mjs)) — đoạn mà
core đã kiểm một đầu, kho đã kiểm đầu kia, còn khúc giữa thì thiếu một dòng là mọi test vẫn xanh
mà bấm phím tắt không thấy gì đổi. Trong đó có phép kiểm rằng bỏ dữ liệu đi thì HTML TRÙNG KHÍT
bản trước khi có dữ liệu, và phép kiểm rằng tóm tắt không kèm một giá trị thật nào.

### Thêm — thân lưới vẽ được DỮ LIỆU THẬT

Nửa sau của phần thuần: bước trước dựng câu lệnh, bước này vẽ kết quả. `renderGridHtml` nhận
thêm `sampleRows` — mỗi dòng trả về từ database là một hàng.

**Lối cũ giữ nguyên TỪNG BYTE.** Bản vẽ mặc định của designer là thứ mọi phép đo đối chiếu với
runtime đang dựa vào: thước cột, chiều cao khối, ảnh chụp trong tài liệu. Thêm một tính năng mà
làm xê dịch nó là âm thầm đổi thứ người ta đang tin, và không ai nhận ra cho tới lần đối chiếu
tiếp theo. Nên `sampleRows === null` đi đúng đường cũ, và có một ẢNH CHỤP nguyên văn trong test
giữ điều đó — dài, khó đọc, và cố ý như vậy: đổi một dấu cách trong `dataCell` là nó phải gãy.

Giá trị nằm TRONG control, không phải chữ trần. Cả `grid.mjs` đo theo HTML runtime thật, và chữ
trần cắt ở một chỗ khác với chữ trong một `<input>` cùng bề rộng — mà xem trước để biết cột 60px
có cắt mất tên khách hay không thì phải cắt ở ĐÚNG chỗ runtime cắt.

`renderGridControl` vì thế nhận thêm hai tuỳ chọn: `value` (đè lên giá trị mặc định của field)
và `withId` (bỏ `id=` đi). `withId` là bắt buộc chứ không phải cho đẹp: `id` suy từ tên field,
nên mười hàng là mười phần tử trùng id và `getElementById` của webview vớ phải hàng đầu cho mọi
hàng. Cả hai tuỳ chọn có giá trị mặc định trùng hành vi cũ.

BA trạng thái của một ô, và trộn chúng vào nhau là để người dùng kết luận sai:

    value=""                giá trị THẬT, rỗng — ô trống trong database
    NULL của SQL            cũng ra ô trống, và KHÔNG rơi về giá trị mặc định của field
    data-fbo-nodata="1"     cột đã bị `buildSampleSelect` BỎ khỏi câu lệnh

Vế thứ ba là vế đáng giữ nhất. Cột bị bỏ (bảng tạm cục bộ, biểu thức không bóc được…) mà hiện ra
một ô trống trơn thì người đọc kết luận «dữ liệu rỗng» từ một chỗ ta biết rõ là KHÔNG LẤY ĐƯỢC.
Dấu riêng để tầng vỏ nói ra được điều đó.

Cột ẩn vẫn dựng đủ ô, chỉ là không có gì bên trong — bỏ hẳn ô đi là hàng hụt một `<td>` và mọi
cột sau lệch; runtime cũng dựng đủ rồi mới ẩn. Trả về 0 dòng thì thân RỖNG chứ không rơi về hàng
giữ chỗ: 0 dòng là một câu trả lời thật, và giả vờ chưa lấy dữ liệu là nói dối.

Test: 28 phép kiểm ([`core/test/test-grid-body.mjs`](core/test/test-grid-body.mjs)). Đáng kể
nhất, ngoài ảnh chụp, là phép kiểm MỐI NỐI: nhãn cột của `buildSampleSelect` phải trùng
`model.columns[].name`. Hai bên lệch nhau thì mọi ô đều `data-fbo-nodata` — lưới trông như không
có dữ liệu, trong khi câu lệnh đã chạy xong và trả về đủ dòng. Đó là kiểu hỏng thầm lặng nhất
của cả tính năng, và nó nằm đúng ở chỗ hai file không nhìn thấy nhau.

Cộng một phép kiểm nhỏ mà thiếu thì hỏng chỉ lộ ra lúc bấm nút thật: `renderControllerHtml` có
truyền `sampleRows` xuống `renderGrid` hay không. Và một phép kiểm thoát HTML — dữ liệu đến từ
database của khách, một dấu nháy kép chưa thoát là thoát ra khỏi thuộc tính `value` và cả bản vẽ
hỏng từ đó trở đi.

### Thêm — dựng câu SELECT lấy dữ liệu thật cho lưới (phần thuần)

Bước đầu của «xem trước bằng dữ liệu thật». Chỉnh bề rộng cột trên blueprint hiện là làm bằng
cảm tính: không ai biết cột 60px có cắt mất tên khách hay không cho tới khi màn hình chạy trên
máy khách. Bước này dựng câu lệnh; bước sau mới chạy nó và đổ vào lưới.

[`core/src/grid-sample.mjs`](core/src/grid-sample.mjs) là file DUY NHẤT trong core sinh ra một
câu lệnh sẽ chạy trên DATABASE CỦA KHÁCH, nên nó có một luật riêng, viết ngay đầu file:

**KHÔNG MỘT MẨU SQL NÀO CỦA FILE KHÁCH ĐI THẲNG VÀO CÂU LỆNH.**

Mọi thứ ghép vào đều là ĐỊNH DANH đã qua `assertIdent` — tên bảng, alias, tên cột. Không chép
nguyên mệnh đề `ON`, không chép nguyên biểu thức `aliasName`, không chép nguyên `<query>`. Một
controller hỏng (hoặc bị sửa ác ý) không được biến thành một câu lệnh làm chuyện khác.

Cái giá của luật ấy được nói thẳng chứ không giấu: phép join DỰNG LẠI từ cặp khoá chính mà
`scanFindingJoin` tách được, không phải mệnh đề `ON` đầy đủ — join nhiều điều kiện vì thế có thể
trả về thừa dòng. Với một phép xem trước để ĐO BỀ RỘNG CỘT thì thừa dòng không sao, và `notes`
luôn nói ra điều đó thay vì để người đọc tự phát hiện.

Ba ca TỪ CHỐI cả câu, mỗi ca một mã đọc được: không có `root@table`; bảng là TIỀN TỐ chia kỳ
chưa có kỳ (`m64$` — `assertIdent` không bắt được vì `$` hợp lệ trong định danh SQL Server, nên
phải hỏi riêng, và lời từ chối kèm luôn bảng master để tầng vỏ có cái mà gợi ý); và không cột
nào lấy được.

Sáu ca BỎ RIÊNG CỘT, giữ phần còn lại: không có `<field>`; `aliasName` là biểu thức không bóc
được thành `alias.cột`; alias không có trong câu Finding; alias trỏ bảng tạm CỤC BỘ; bảng join
là tiền tố chia kỳ hoặc tên không phải định danh trần; không tách được cặp khoá.

**Lệch khỏi kế hoạch, có lý do.** Kế hoạch định TỪ CHỐI cả câu khi có cột join tới bảng tạm cục
bộ. Làm thật thì bỏ riêng cột ấy tốt hơn ở cả hai mặt: mối nguy của bảng tạm là nó lọt VÀO câu
lệnh (không tồn tại → lỗi, hoặc tệ hơn: trúng một `#x` khác cùng tên của phiên khác), mà bỏ cột
thì nó không lọt vào nữa — nguy cơ biến mất y như từ chối, còn mười chín cột lành thì vẫn xem
được.

Câu Finding không đọc được (`<Encrypted>`, hoặc không có) cũng KHÔNG từ chối: cột của bảng chính
không cần nó, và với đa số lưới đó là phần lớn cột. Chỉ ghi một dòng `notes` nói vì sao mấy cột
kia vắng mặt.

Hai chi tiết nhỏ mà sai thì hỏng thầm lặng. Nhãn cột giữ NGUYÊN VĂN tên FBO (`AS [ten_kh%l]`)
trong khi vế `SELECT` phân giải hậu tố ngôn ngữ (`b.ten_kh`): tầng vỏ đối chiếu tên cột trả về
với cột trên lưới để đổ đúng chỗ, và phân giải ở nhãn là `ten_kh%l` với `ten_kh` cùng ra một
nhãn rồi đổ chồng lên nhau. Và `buildSampleSelect` KHÔNG BAO GIỜ ném: `assertIdent` ném là đúng
việc của nó, nhưng một lệnh người dùng bấm thì không được chết vì một tên cột lạ trong file
khách — bắt lại, trả về `sample.bad_identifier` kèm nguyên lý do.

Câu lệnh luôn mở bằng `SET NOCOUNT ON` và `SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED`:
xem trước không được khoá dòng của ai đang làm việc thật trên database của khách. `TOP` có sàn 1,
trần 100, mặc định 10 — đây là phép xem trước để đo cột, không phải công cụ trích dữ liệu.

`assertIdent` được mở ra khỏi `sql-config.mjs` để hai bên dùng chung một phép chặn; bảng tạm
TOÀN CỤC (`##x`) vẫn join được nên tên bảng đi qua một bảng chữ cái nới đúng một ký tự (`#`),
nới có lý do và ghi rõ lý do.

Test: 53 phép kiểm ([`core/test/test-grid-sample.mjs`](core/test/test-grid-sample.mjs)), xếp
theo thứ tự quan trọng — AN TOÀN trước, rồi TỪ CHỐI/BỎ CỘT, rồi mới tới dựng đúng. Nhóm đầu
khẳng định những thứ KHÔNG có trong câu lệnh: không có `DROP` khi `aliasName` mang một câu lệnh
huỷ bảng, không có điều kiện thứ hai của mệnh đề `ON`, không có tên bảng tạm cục bộ, và không
lối nào ném ra tầng vỏ kể cả với văn bản rỗng hay không phải XML.

### Thêm — BỐN LUẬT CHẨN ĐOÁN MỚI: field khai chết, alias hỏng, lưới tràn vùng

Ba bước trước dựng đường ống; bước này đổ luật vào. Khác với ~30 luật đã có — vốn là những gì
`render`/`grid` VẤP PHẢI trên đường vẽ («tôi không vẽ được cái này») — bốn luật mới đi TÌM: bản
khai vẽ ra bình thường, nhưng có chỗ sai chỉ lộ lúc chạy thật, hoặc không lộ ra bao giờ.

    lint.field_unused          <field> khai mà không chỗ nào dùng
    lint.alias_not_joined      aliasName không có trong <query event="Finding">
    lint.alias_local_temp      aliasName trỏ tới bảng tạm CỤC BỘ (#x)
    lint.grid_overflows_view   <field rows> làm lưới cao hơn view@height

Cả bốn đều `warning`, không cái nào `error`: không cái nào làm control biến mất khỏi màn hình —
đúng ranh giới đã chốt ở bước đầu.

Nhà mới: [`core/src/lint.mjs`](core/src/lint.mjs), và luật chung của nó là **KHÔNG BIẾT THÌ IM**.
Một luật kêu oan chỉ cần vài lần là người dùng thôi đọc cả bảng Problems, và khi ấy nó kéo theo
mọi luật đúng xuống cùng. Nên mỗi rule có ít nhất bằng ấy phép kiểm cho ca «biết im» như cho ca
«bắt đúng».

«Field khai chết» là luật dễ kêu oan nhất, và nó có HAI lớp chặn chồng lên nhau. Lớp một: chỉ
xét field khai trong CHÍNH file controller đang mở — một Include dùng chung khai năm chục field
cho hai chục controller, mỗi controller dùng dăm cái, nên không có lớp này thì mở một file ra là
bốn mươi lăm cảnh báo sai. Lớp hai: tên field phải xuất hiện ĐÚNG MỘT LẦN trong cả tài liệu,
chính chỗ khai ra nó. Field có thể được dùng ở chỗ bộ quét không đọc — `<query>`, `arrangement`,
một hàm trong `Include\Javascript`, một view thứ hai mà `renderGrid` không dựng tới. Thấy dấu
vết lần thứ hai ở bất cứ đâu là đủ để im.

Lớp hai ấy cũng chính là thứ cứu ca LƯỚI NHIỀU VIEW: `renderGrid` chỉ dựng một view, nên cột chỉ
dùng ở view in ấn không nằm trong tập «đang hiện» — và lưới nhiều view là chuyện thường.

Hai luật alias đọc `aliasName` bằng CHÍNH `readAliasName` mà bản sinh SQL dùng, không tự tách
lấy: thuộc tính ấy mang hai nghĩa (alias trần, hoặc biểu thức SQL), và một bản đọc thứ hai chỉ
chờ ngày lệch khỏi bản thứ nhất. `readAliasName` và phép thử bảng tạm cục bộ vì thế được mở ra
khỏi `filter-declare.mjs`; phép thử `#x` khác `##x` nay là hàm `isLocalTempTable` có tên, thay
vì một regex trần nằm giữa một khối comment dài.

Bảng tạm cục bộ là ca thật đã tốn công một lần: `Grid\SVTran.xml` của HOATP join
`#invoiceTypeTmp` — bảng tự tạo lại mỗi lần chạy Finding, nhưng lọc nhanh gọi
`FastBusiness$System$GetDynamicFilter` ở một lời gọi HOÀN TOÀN RIÊNG nên không thấy nó. Nay lỗi
ấy hiện ngay lúc mở file, không phải sau khi khách gõ vào ô lọc.

`lint.grid_overflows_view` so đúng con số mà `renderGridHtml` đã tính, qua `gridBlockPx` dùng
chung — hai bản sao của một phép cộng geometry là hai bản sẽ lệch nhau ở lần đo lại tiếp theo.
Mốc lấy nguyên từ runtime: `<view height="302">` đi với `<field rows="242">` là VỪA KHÍT
(30 + 242 + 8 + 22), nên phép so là chặt — lớn hơn mới kêu.

Luật thứ năm dự kiến («tổng span vượt số cột») KHÔNG thêm: `item.pattern_too_long` ở bước đầu đã
phủ đúng ca gây hại, tức pattern dài hơn view và CẮT MẤT control. Phần dư còn lại — pattern dài
hơn nhưng chỉ thừa ô trống — không mất gì trên màn hình, và thêm một cảnh báo cho nó là thêm
tiếng ồn chứ không thêm thông tin.

Test: 32 phép kiểm mới ([`core/test/test-lint.mjs`](core/test/test-lint.mjs)). Fixture của
`test-edit.mjs` hoá ra khai sẵn một field `e="Unused"` — luật mới bắt đúng nó, nên hai phép kiểm
«không đẻ ra cảnh báo mới» ở đó được viết lại cho đúng ý: chúng đưa `[le_loi]` vào một hàng, nên
cảnh báo phải BIẾN MẤT, và đó là điều đáng khẳng định hơn hẳn "số cảnh báo không đổi".

### Thêm — CHẨN ĐOÁN trong Problems panel

Chỗ hai bước nền trước hiện ra ngoài. Mở một file trong `Dir` / `Filter` / `Grid` là lỗi vào
thẳng Problems (`Ctrl+Shift+M`), bấm một dòng là nhảy tới chỗ khai — không cần mở designer.

KHÔNG gate license, có chủ ý. Mọi lệnh nghiệp vụ đi qua `withLicense`, nhưng gạch đỏ là thứ
chạy nền chứ không phải một lệnh người ta bấm: khoá nó lại thì người chưa kích hoạt mở một
controller hỏng ra và thấy không gì cả — không thông báo, không chỗ để hỏi vì sao. Im lặng là
câu trả lời tệ hơn cả một lời từ chối.

Phần khó nhất KHÔNG phải là gọi `createDiagnosticCollection`, mà là **một file Include được
nhiều controller kéo vào**. `DiagnosticCollection.set(uri, …)` THAY TOÀN BỘ danh sách của uri
đó, nên cách viết tự nhiên nhất — mỗi controller tự `set` lên từng file nó chạm — làm controller
chạy sau xoá sạch chẩn đoán của controller chạy trước. Hỏng im lặng: không ném, không log, chỉ
là một nửa số gạch đỏ không bao giờ hiện. Include dùng chung là chuyện thường ngày của FBO nên
đây là ca THẬT, không phải ca biên. Nên kết quả giữ RIÊNG theo từng controller, và mỗi lần đổi
thì dựng lại HỢP của mọi controller cho từng file bị chạm.

Dọn phải theo dấu vết của lượt TRƯỚC, không chỉ lượt này: sửa xong một lỗi thì lượt mới chẳng
nhắc gì tới file ấy nữa, và không ai bảo VS Code bỏ gạch cũ đi thì nó nằm lại vĩnh viễn.

Cùng một khiếm khuyết trong một Include được mọi controller kéo file ấy vào cùng báo lên, nên
bản gộp bỏ trùng theo (mã, dải, câu chữ). Khiếm khuyết là của FILE; năm controller đọc nó không
làm nó thành năm khiếm khuyết.

Offset quy ra dòng/cột trên ĐÚNG CHUỖI đã sinh ra offset ấy — `document.getText()` cho controller
đang mở, `core.readSource` cho Include. Đổi chỗ hai bên là để VS Code giải mã lại theo cấu hình
của NÓ, và gạch lệch cột ở mọi dòng có ký tự ngoài ASCII đứng trước. Hệ quả đã biết và chấp
nhận: Include đang sửa dở chưa lưu thì chẩn đoán tính trên bản đã lưu — đúng hành vi của
designer hôm nay, và hai bên nói khác nhau về cùng một file còn tệ hơn.

`severity: 'info'` KHÔNG vào Problems. Luật duy nhất ở mức ấy — thiếu CSS nền — là lỗi nạp tài
nguyên của extension, không phải khiếm khuyết của file người dùng đang mở; đặt nó vào Problems
là chỉ tay vào một file không có gì sai. Nó ở lại Output Channel, và có một phép kiểm giữ quyết
định ấy khỏi bị "dọn gọn" mất.

Ba chốt nhỏ hơn: quét lần đầu đẩy sang nhịp sau chứ không chạy trong `activate` (VS Code CHỜ
`activate` xong, và ai khôi phục một phiên hai chục controller sẽ trả giá bằng một khoảng treo
lúc mở IDE); gõ thì debounce 300ms còn lưu thì chạy ngay; quét ném thì GIỮ NGUYÊN kết quả lần
trước, vì gõ dở một thẻ XML là trạng thái bình thường của file đang sửa và xoá trắng Problems
mỗi lần như thế làm cả bảng nhấp nháy.

Dùng lại `buildPayload` với `skipHtml`, không tự dựng đường tính riêng: cảnh báo phụ thuộc cả
`loadDetail` lẫn `gridConfig`, và hai đường nói hai chuyện khác nhau về cùng một file đúng là
thứ đầu `render-host.js` đã cảnh báo. Nhánh `skipHtml` của nó nay trả thêm `diagnostics` cho
khớp nhánh đầy đủ — hai hình dạng lệch nhau là cái bẫy chờ người gọi tiếp theo.

Vỏ ở [`extension/src/diagnostic-host.js`](extension/src/diagnostic-host.js). Kèm bộ test ĐẦU
TIÊN cho tầng extension ([`extension/test/`](extension/test/run.mjs), 30 phép kiểm, `npm run
test:extension`) — chạy bằng node trần với một `vscode` giả. Nó đứng riêng khỏi `core/test`:
bộ test của core là bằng chứng sống cho luật "core không phụ thuộc gì" (ADR-0002), và trộn một
bản giả lập vào đó là làm mờ đúng cái ranh giới ấy.

### Thêm — chẩn đoán entity mang mã và dải nguồn

Nửa còn lại của bước nền. Chín chỗ `expandEntities` báo lỗi — entity chưa khai, entity đệ quy,
file SYSTEM không đọc được, `%tham-số;` chưa khai, include vòng, marked section không đóng, hai
chốt độ sâu — nay đi ra cùng hình dạng với cảnh báo của `render`/`grid`:
`{code, message, severity, item, range}`.

Trước bản này chúng là `{severity, message}` trần, không có lấy một con số. Chín chỗ ấy đều
đang CẦM SẴN `file` trong tay, và tám chỗ cầm luôn cả khớp regex — tức là toạ độ vẫn ở đó, chỉ
là bị vứt đi ngay tại chỗ phát. Nên đây gần như thuần cơ học, và cái giá đã trả từ trước.

Khác cảnh báo của `render.mjs` ở một điểm đáng nhớ: ở đây KHÔNG có `sourceRange` nào cả.
`collect`/`expand` luôn cầm cặp (`file`, `base`) của chính đoạn đang xét, nên chỗ phát chẩn đoán
đã đứng sẵn trong hệ toạ độ file nguồn. Bung entity là việc SINH RA `clearText`; nó không thể
tra một bản đồ mà chính nó chưa dựng xong.

Chỗ dễ sai duy nhất là `base`. `collect` gần như không bao giờ quét cả file — nó quét một LÁT
internal subset, hoặc quét giá trị inline của một parameter entity. Quên cộng `base` thì mọi
chẩn đoán của internal subset lệch đúng bằng vị trí của `<!DOCTYPE`: vẫn ra một dải trông hợp
lệ, chỉ là trỏ vào dòng khác — đúng cái bẫy mà `valueStart` đã phải né từ trước. Có một phép
kiểm riêng cho ca ấy.

Hai chốt độ sâu neo vào CẢ ĐOẠN đang quét, không vào một khớp: vượt 32 tầng lồng nhau không
phải lỗi của một `&Name;` cụ thể mà của cả chuỗi kéo tới đó, và chỉ vào một ký tự đơn lẻ là gán
tội cho kẻ đứng cuối hàng.

`ctx.warn` nay nhận `code` + `params` thay vì chuỗi đã format, nên `msg` không còn được dùng
trong [`core/src/entities.mjs`](core/src/entities.mjs) nữa — mọi câu chữ đi qua `warn.mjs`.
Mức `'warn'` cũ đổi thành `'warning'` cho khớp phần còn lại; không chỗ nào rẽ nhánh theo giá
trị đó, chỉ có ba dòng `output.appendLine` in nó ra.

Test: 9 phép kiểm mới, mỗi phép CẮT văn bản thật tại dải trả về rồi so chữ — so `start`/`end`
với một con số chép tay thì chỉ chứng minh code hôm nay khớp con số hôm nay. Đáng giá nhất vẫn
là ca `&ThieuHan;` viết trong file Include: chẩn đoán quy về CHÍNH file Include, cắt ra đúng
`&ThieuHan;`, chứ không quy về controller đang mở.

### Thêm — cảnh báo của core mang MÃ, MỨC và DẢI NGUỒN

Bước nền cho chẩn đoán trong Problems panel. Chưa đổi gì người dùng nhìn thấy: webview vẫn đọc
đúng `item` và `message` như cũ, và bản vẽ không khác một pixel nào.

Cái đổi là thứ đi kèm. Core có sẵn khoảng ba mươi luật cảnh báo — token trỏ vào field không
khai, pattern lệch số cột, list px hỏng, cột lưới không có `<field>`, tab khai trùng — nhưng
chúng chỉ đi tới một danh sách trong webview và một dòng trong Output Channel. Muốn đặt một
gạch đỏ vào file thì ba thứ còn thiếu:

    code      khoá `messages.json`. Thứ ổn định để lọc/tắt từng luật; chuỗi thông điệp thì
              không — nó đổi mỗi lần ai đó viết lại cho dễ đọc hơn.
    severity  phân biệt «form CHẮC CHẮN vẽ sai» với «vẽ được nhưng đáng ngờ». Trộn hai thứ vào
              một mức là Problems panel đỏ đều và người đọc thôi phân biệt.
    range     `{file, start, end}` trong file nguồn.

`range` là phần đắt, và lý do nằm ở entity. Cộng offset vào chuỗi `value` chỉ cho ra toạ độ
trong văn bản ĐÃ BUNG — một chuỗi không nằm trên đĩa của ai cả; đặt gạch đỏ theo con số ấy là
đặt vào hư không, mà nó lại TRÔNG như một toạ độ thật. Nên mọi cảnh báo đi qua `sourceRange`
đúng đường mà `range` của mỗi hàng đã đi từ trước: quy CẢ DẢI về một file một lần, không map
riêng hai đầu. Kết quả là lỗi của một hàng khai trong Include hiện ở CHÍNH file Include —
đúng file phải sửa, chứ không phải controller đang mở.

Toạ độ đi hai tầng, tách theo đúng chỗ đứt của thông tin. `parseWidths`/`parseRow`/`buildCells`
chỉ nhìn thấy một chuỗi `value` và không biết file nào, offset nào — nên chúng phát ra `at`/`len`
TƯƠNG ĐỐI trong chính chuỗi ấy. `render.mjs`/`grid.mjs` cộng offset gốc rồi mới quy về file.

Nhờ tầng dưới có `at`, cảnh báo chỉ đúng khúc chữ hỏng thay vì bôi cả hàng: `token "[a].Lable"
sai kind` gạch đúng token đó, `cột 7 không phải số px` gạch đúng phần tử thứ 7 trong list mười
bảy cột. Token nay nhớ luôn chỗ mình đứng (`at`/`len` trong `parseRow`), đo bằng con trỏ chạy
chứ không `indexOf` — một hàng có hai token trùng văn bản thì `indexOf` trả cùng một chỗ cho cả
hai, và gạch đỏ thứ hai nằm chồng lên gạch thứ nhất.

`range: null` là một câu trả lời HỢP LỆ, không phải chỗ còn thiếu, và có hai ca thật. Cảnh báo
`arrangement` đọc chuỗi đến từ `Grid/Config/Fields/<Tên>.xml` — file mà `segments` không phủ, nên
không có dải nào đúng để mà trả; bịa ra một dải trong controller là chỉ tay vào file không chứa
lỗi. Và `pattern dài hơn N cột` nói về quan hệ pattern↔số cột của view, không về một khúc chữ
nào hẹp hơn cả `value`.

Bảy chuỗi tiếng Việt viết thẳng trong `item-value.mjs` chuyển hết vào `messages.json` (nguyên
văn, không sửa câu chữ) để có khoá mà làm `code`. Mức thì chia theo hậu quả THẬT: lệch pattern
với token, pattern vượt số cột, `"1"` hết token, token không ai nhận, token trỏ field không khai,
cột lưới không có field — sáu ca này làm control BIẾN MẤT khỏi màn hình nên là `error`; list px
hỏng thì coi như 0 và vẫn vẽ ra được nên là `warning`. Thiếu CSS nền xuống `info`: đó là lỗi nạp
tài nguyên của extension, không phải khiếm khuyết của file người dùng đang mở, và đẩy nó vào
Problems cùng mức lỗi thật là bắt người ta đi sửa một file không có gì sai.

`category index="8"` khai trùng nay neo vào bản khai THỨ HAI. Thông điệp nói «chỉ lần đầu được
dùng», nên cái đáng gạch là cái bị bỏ qua — gạch vào bản đầu là chỉ tay vào đúng bản đang chạy.

Hình dạng mới ở [`core/src/warn.mjs`](core/src/warn.mjs); chỗ phát ở
[`core/src/item-value.mjs`](core/src/item-value.mjs), chỗ neo ở
[`core/src/render.mjs`](core/src/render.mjs) và [`core/src/grid.mjs`](core/src/grid.mjs)
(test: 26 phép kiểm mới, trong đó phép đắt nhất cắt dải trả về trên văn bản THẬT của file
Include và khẳng định nó ra đúng `[khong_co]`).

`tools/package-vsix.mjs` dùng danh sách file tường minh, nên `warn.mjs` được thêm vào đó —
thiếu một dòng ấy thì mọi test vẫn xanh mà bản `.vsix` cài lên máy khác không nạp nổi core.

### Thêm — ĐỔI CHỖ hai control trong cùng một hàng

Kéo một control thả lên control khác cùng bề rộng, hoặc bấm `⇄←` / `⇄→` trên thanh lệnh của ô
đang chọn. Trước bản này không có đường trực tiếp: `moveCell` từ chối chỗ đã có người (đúng — dời
lên chỗ đó là làm mất một khai báo không ai yêu cầu), nên đổi thứ tự hai field phải làm tay qua
hai bước — xoá rồi thêm lại, hoặc dời vòng qua một ô trống trung gian.

CHỈ ĐỔI CHỖ HAI Ô CÙNG SPAN, và chính giới hạn đó làm phép này rẻ tới mức không ngờ: hai ô cùng
span thì **pattern không đổi một ký tự nào** — cột bắt đầu và số cột chiếm của cả hai đều giữ
nguyên, chỉ có hai token hoán vị. Splice vì thế chỉ chạm vào phần token, và hàng viết bằng entity
đi qua nguyên văn (`[&k;]` vẫn là `[&k;]`).

Khác span thì TỪ CHỐI kèm cả hai con số và đường ra (`hai control khác bề rộng (trải 3 và 1 cột)
— cho bằng nhau rồi mới đổi chỗ được`), không tự dồn lại hàng: ô trải 3 tráo với ô trải 1 sẽ đè
lên ô thứ ba nằm giữa, và dồn lại cả hàng là một quyết định bố cục người dùng chưa hề nói ra.

Bóng mờ lúc kéo nay có màu thứ BA (tím, vạch đứt) cho «đổi chỗ», tách khỏi xanh «dời được» và đỏ
«không nhận» — thả xuống đây làm đổi HAI control chứ không phải một, và đó là điều duy nhất cần
phân biệt trước khi buông tay. Nút trên thanh lệnh mờ đi kèm lý do khi control bên cạnh khác bề
rộng, thay vì bấm được rồi mới nhận câu từ chối.

Logic thuần ở `swapCells` trong [`core/src/item-value.mjs`](core/src/item-value.mjs) + nhánh
`swap` của `planRowEdit` trong [`core/src/edit.mjs`](core/src/edit.mjs) (test:
[`core/test/test-edit.mjs`](core/test/test-edit.mjs), 17 phép kiểm); tầng vỏ ở
[`extension/src/edit-host.js`](extension/src/edit-host.js) và
[`extension/media/designer.js`](extension/media/designer.js).

### Đã sửa — bóng mờ lúc kéo dời báo ĐỎ ở những chỗ thả xuống vẫn chạy được

Phép kiểm «cột đích có trống không» của bóng mờ quét cả BẢNG (`table.querySelectorAll`), trong
khi phép sửa thật chỉ tính trên HÀNG. Một control ở hàng khác đứng cùng cột là đủ để bóng chuyển
đỏ, dù thả xuống vẫn đi được — trên form nhiều hàng thì gần như chỗ nào cũng đỏ. Nay quét trong
`tr.FormRow` của chính ô đang kéo, cùng phạm vi với `moveCell`.

### Thêm — tách / gộp BIÊN CỘT của một vùng form

Bấm vào con số px trên dải thước của blueprint để hiện thanh `Tách` / `Gộp◄` / `Gộp►`. Phép này
sửa chính DANH SÁCH BIÊN CỘT của vùng — `<item value="100, 60, 90">` ở đầu view, hoặc
`<category columns="…">` của một tab — chứ không phải span của một control (đó là tay cầm xanh ở
mép ô, đã có từ trước và không đổi gì).

Danh sách biên là thứ dùng chung, nên một cú bấm là một CHÙM splice đi cùng nhau: list px, pattern
của mọi hàng đọc list px ấy (kể cả hàng ở tab đang đóng và hàng nằm trong file Include), và
`anchor`/`split` của mọi vùng dùng chung nó. Ghi hết trong một `WorkspaceEdit`, hoặc không ghi gì
— nửa chùm là toạ độ lệch hàng loạt mà form vẫn vẽ ra bình thường. Hộp thoại nói rõ bao nhiêu
hàng, bao nhiêu file trước khi ghi.

Hai chỗ TỪ CHỐI thay vì đoán: gộp hai cột đang giữ hai control khác nhau (mất một cái), và gộp
đúng vào vạch `split` đang trỏ tới (vạch biến mất, dời sang bên nào cũng là đổi bố cục theo một ý
chưa ai nói ra).

Logic thuần ở [`core/src/columns.mjs`](core/src/columns.mjs) +
`planRegionColumns`/`regionColumnFiles` trong [`core/src/edit.mjs`](core/src/edit.mjs) (test:
[`core/test/test-columns.mjs`](core/test/test-columns.mjs), 71 phép kiểm); tầng vỏ ở
`handleRegionColumns` trong [`extension/src/edit-host.js`](extension/src/edit-host.js).

Phần dựng splice từ một cặp before/after văn bản được tách khỏi `patternPlan` thành `textPatch`
dùng chung — nhờ đó list px viết bằng entity cũng ghi được vào đúng file khai nó, cùng đường với
pattern lai đã có.

### Đã sửa — cột join tới bảng TẠM CỤC BỘ được khai `xtable` với mức tin cậy "joined", sai mà trông như đúng

Ca thật, nguyên văn `Grid\SVTran.xml` của HOATP: cột `ten_loai_hd%l` khai `aliasName="c"`, và
`<query event="Finding">` join `left join dmkh b on a.ma_kh = b.ma_kh left join #invoiceTypeTmp c
on a.loai_hd = c.loai_hd`. Ngay TRÊN dòng `exec`, trong CÙNG khối CDATA, là:

    create table #invoiceTypeTmp (loai_hd char(2), ten_loai_hd nvarchar(256), …)
    insert into #invoiceTypeTmp values('01', N'Hóa đơn bán lẻ'), …

`#invoiceTypeTmp` là bảng tạm CỤC BỘ, tự tạo lại mỗi lần chạy `<query event="Loading">`/
`<query event="Finding">` — nó chỉ sống trong đúng phiên đã tạo ra nó. "Lọc nhanh" không chạy
lại hai câu ấy: nó gọi thẳng `FastBusiness$System$GetDynamicFilter` ở một lời gọi HOÀN TOÀN
RIÊNG, không đi qua đoạn `create table` nói trên.

Bản trước coi mọi bảng tra được từ câu Finding là `xtable` hợp lệ như nhau, không phân biệt bảng
tạm — `buildFilterDeclarations` khai `xtable = "#invoiceTypeTmp"` với `confidence: "joined"`,
tức máy nói "chắc, không cần xem lại". Chạy script sinh ra là `Invalid object name
'#invoiceTypeTmp'` ngay khi người dùng gõ vào ô lọc: đúng kiểu hỏng mà tài liệu đầu file này luôn
cảnh giác — sinh sai bản đồ join tệ hơn hẳn không sinh gì.

Nay bảng được join tới mà tên bắt đầu bằng đúng MỘT dấu `#` (bảng tạm cục bộ, không phải bảng
tạm TOÀN CỤC `##…` — thứ này sống qua mọi phiên nên không dính luật này) đi vào một mức tin cậy
riêng, `temp-table`: không khai `xtable`/khoá/`joinclause`/`conditionalreplace` nào, và ghi chú
nói rõ vì sao. Script SQL đánh dấu các dòng này bằng nhãn riêng `BẢNG TẠM`, tách khỏi nhóm
`XEM LẠI` — nhóm kia là "thiếu thông tin, điền tay được", còn đây là "biết chắc không khai được,
điền tay cũng vô ích".

### Đã thêm — tên database `sys` đọc thẳng từ `Web.config`, không hỏi tay

`renderFilterDeclareSql` nhận tham số `sysDatabase` để ghi `<database>..sysfilterdeclares` vào
đầu script, nhưng trước nay không ai điền nó — script luôn viết trần `sysfilterdeclares`, và
người dùng phải tự đổi tên database trước khi chạy trên đúng server.

`Web.config` của MỌI program FBO khai đúng một connection string tên `sysConnectionString` trỏ
vào database hệ thống (đối chiếu `WebConfigReader.cs` của DevWorkFlow — cùng tên, cùng cấu
trúc `<connectionStrings><add name="sysConnectionString" connectionString="…"/>`). Tên database
nằm trong `Initial Catalog=` của chuỗi ấy (`Database=` là từ khoá tương đương). Core thêm hàm
thuần `scanSysDatabaseName(webConfigText)` để tách tên ấy ra khỏi văn bản `Web.config`; tầng vỏ
(`filter-host.js`) tìm `Web.config` tại gốc program (`resolveProgramPaths(...).programRoot`,
cùng cấp `App_Data`, không phải cạnh file controller) và đọc nó vào trước khi sinh script.

Không thấy `Web.config`, đọc lỗi, hay file không khai `sysConnectionString` đều không chặn lệnh
lại — chỉ ghi lại lý do trong Output và để trống `sysDatabase` như hành vi cũ, người dùng tự gõ
tên database vào script.

### Đã sửa — hộp chọn cột lọc nhanh tick sẵn cột đã khai, dễ nạp lại nguyên xi dòng cũ

Hộp `showQuickPick` của lệnh «Khai báo lọc nhanh» tick sẵn `picked: true` cho mọi cột đã có
`allowFilter="true"` — bấm OK mà không nhìn kỹ từng dòng là nạp lại y nguyên cả những dòng đáng
lẽ cần sửa. Nay mọi cột đều mặc định KHÔNG tick; người dùng phải tự chọn lại từng cột muốn khai,
kể cả cột cũ. Cột đã khai vẫn được đánh dấu rõ trong mô tả (`— (đã khai allowFilter)`) để không
mất thông tin, chỉ là không còn tự động chọn hộ.

### Đã sửa — cột hoá đơn điện tử ra sai hoàn toàn: ba lỗi chồng lên nhau

Ba dòng `so_ct_hddt`, `so_seri_hddt`, `ten_tt_hddt` của `SVTran` sinh ra dạng
`char(254) + 'rtrim(e1.so_ct_hddt)'` với mọi cột nguồn để trống — tức hình dạng dành cho một
alias KHÔNG tra được, trong khi mọi thông số cần thiết đều có sẵn trong file. Ba nguyên nhân
độc lập, và phải sửa cả ba mới ra đúng:

**1. Lời gọi Finding có HAI mệnh đề join, ở hai tham số khác nhau.** `&EIGridQuery;` của
`Include\Invoice.ent` bung ra ba tham số ở tận cuối lời gọi:

    , 'stt_rec, so_seri_hddt, so_ct_hddt, tinh_trang_hddt, xac_thuc'   cột lấy từ bảng EI
    , 'hddt00$'                                                        tiền tố bảng chia kỳ
    , ' left join hddt00$ e1 on a.stt_rec = e1.stt_rec
        left join dmtthddt e2 on e1.tinh_trang_hddt = e2.status'       mệnh đề join của EI

`scanFindingJoin` chỉ đọc chuỗi hằng ĐẦU TIÊN có chữ `join`, nên `e1`/`e2` không tra ra bảng nào
và mọi cột EI rơi xuống nhánh «alias lạ». Nay gom HẾT mọi chuỗi hằng có `join`. Alias gốc vẫn chỉ
đọc từ mệnh đề chính — mệnh đề EI mở đầu thẳng bằng `left join`, lấy alias gốc từ nó là ra chữ
`left`.

**2. `aliasName` là biểu thức bọc MỘT cột, phải bóc ra chứ không giữ nguyên khối.**
`rtrim(e1.so_ct_hddt)` không phải biểu thức tự do — nó là «cột `so_ct_hddt` trên alias `e1`»,
`rtrim()` chỉ để hiển thị. Khi alias tra ngược được về một phép join thì bản khai đúng là khai
CÁI JOIN ẤY, còn `rtrim()` bỏ đi. Nay bóc được cả `f(alias.cot)` lẫn `alias.cot` trần.

**3. `exname` có ba ca, bản trước gộp nhầm hai ca đầu vào ca thứ ba:**

| aliasName | field | exname |
|---|---|---|
| `rtrim(e1.so_ct_hddt)` | `so_ct_hddt` | **trống** — cột trùng tên field, proc tự dùng `a.field` |
| `rtrim(e2.statusname%l)` | `ten_tt_hddt` | **`statusname%2`** — trần, không `rtrim`, không cờ |
| `m.dien_giai` (alias không tra được) | `dien_giai` | `char(254)` + nguyên văn |

Hai hình dạng ấy LOẠI TRỪ nhau: hoặc khai `xtable` + khoá để proc tự dựng join và tự chắp alias,
hoặc để `exname` mang cả biểu thức kèm cờ `char(254)` và proc dùng nguyên văn. Trộn cả hai là
proc join bảng dưới alias `m3` trong khi biểu thức vẫn gọi `e2.` — một alias không tồn tại trong
câu nó vừa ghép. Đo trên 707 dòng có `char(254)` của SEAVNFBO: TẤT CẢ đều bỏ trống `xtable`,
`fieldkey`, `reftable`, `joinclause`; không dòng nào trộn hai hình dạng. Nên biểu thức không bóc
được thành `alias.cot` thì nay bỏ luôn phép join, dù alias có tra ra bảng.

Đối chiếu lại với bản chuẩn, dựng từ nguyên văn `Include\XML\EIGridFields.txt` của HOATP: cả sáu
dòng đại diện — hai cột trên bảng chia kỳ, một join bắc cầu qua bảng chia kỳ, một join thường,
một cột thuộc bộ sáu, một cột gốc trên bảng master — khớp từng ô.

Còn một ô KHÔNG khớp và không thể khớp: `id`. Bản chuẩn ghi `SVTran.AuthenticationReferenceNumber`
trong khi `<header e>` của field là `Reference Number`, nên máy sinh ra `SVTran.ReferenceNumber`.
Đó là một cái nhãn do người đặt, không suy được từ file — và `FilterInitialize` không hề đọc
`b.id`, nên lệch ở đó không đổi hành vi lọc.


### Đã sửa — bảng CHIA KỲ được join vào: sai cả tên bảng lẫn hình dạng khai báo

Phần mở rộng hoá đơn điện tử của `SVTran` nối thêm hai bảng, và chúng ra hai hình dạng khai báo
khác hẳn nhau. Bản trước sinh sai cả hai.

    left join hddt00$ e1 on a.stt_rec = e1.stt_rec              cột nằm TRÊN bảng chia kỳ
    left join dmtthddt e2 on e1.tinh_trang_hddt = e2.status     join BẮC CẦU từ bảng chia kỳ ấy

**Tên bảng chia kỳ luôn mang `%Partition`.** Câu Finding viết tên TRẦN (`hddt00$`) vì nó đã ở
trong ngữ cảnh một kỳ cụ thể; chép thẳng sang `sysfilterdeclares` là khai một bảng không tồn tại
ở tầng lọc. Đo trên toàn bộ `sysfilterdeclares` của SEAVNFBO: **0** dòng có `xtable` hay
`reftable` kết thúc bằng `$` mà thiếu hậu tố. Áp cho cả tên đã cắm kỳ sẵn (`hddt00$000000`).

**Cột NẰM TRÊN bảng chia kỳ khai đúng một ô `xtable`**, mọi cột khoá để trống —
`SVTran.AuthenticationReferenceNumber` (`so_ct_hddt`) là ca mẫu. `GetDynamicFilter` tự dựng lấy
phép join cho dòng thiếu `fieldkey`:

    left join <datasource> <alias> on a.stt_rec = <alias>.stt_rec

nên khoá và mệnh đề join là thừa. Không phải thừa vô hại: khai `fieldkey` vào là dòng ấy rơi sang
nhánh khác của proc — nhánh dựng join theo `joinClause`, và còn chạy trước một lượt truy vấn phân
giải giá trị. Bản trước sinh ra `xtable=hddt00$` kèm `fieldkey=stt_rec`,
`reftable=%inquiryTable`, `joinclause=a.stt_rec=b.stt_rec` — sai ở cả năm ô. Đo: **1176/1176**
dòng có `xtable` là bảng chia kỳ đều bỏ trống `fieldkey`, `reftable`, `reffieldkey`,
`joinclause`. Không một ngoại lệ.

`conditionalreplace` thì VẪN bọc: cột đến qua `left join` vẫn NULL được, y hệt ca thường.

**Join bắc cầu lấy `reftable` là bảng chia kỳ nó xuất phát từ**, không phải bảng master —
`SVTran.AuthenticationStatus` (`ten_tt_hddt`): `xtable=dmtthddt`, `fieldkey=status`,
`reftable=hddt00$%Partition`, `reffieldkey=tinh_trang_hddt`,
`joinclause=a.tinh_trang_hddt=b.status`. Bản trước trả `hddt00$` trần ở `reftable`. Đo: 435 dòng
có `reftable` là bảng chia kỳ, cả 435 đều có đủ khoá và mệnh đề join — hình dạng ngược hẳn với
vế trên.

Sinh lại sáu dòng đại diện của `SVTran` — hai cột trên bảng chia kỳ, một join bắc cầu, một join
thường, một cột thuộc bộ sáu, một cột gốc trên bảng master — giờ khớp bản chuẩn trên MỌI ô.


### Đã sửa — `xtable` của cột gốc: lưới Voucher có bộ sáu cột cố định, không phải đoán

Lượt trước suy ra luật đúng nhưng đọc sai bản chất của nó: «cột nằm sẵn trên bảng inquiry thì
`xtable` để trống» — rồi kết luận rằng phải hỏi database mới biết bảng inquiry có cột gì, nên khi
không hỏi được thì rơi về bảng master cho mọi cột gốc.

Không cần hỏi. Bảng inquiry của lưới `type="Voucher"` có schema CỐ ĐỊNH trong cả sản phẩm — đo
trên `i81$000000`: đúng mười cột, gồm sáu cột nghiệp vụ

    stt_rec · ngay_ct · so_ct · ma_dvcs · status · user_id0

cộng bốn cột sổ sách `c$ m$ d$ e$` mà không màn hình nào lọc theo. Nên với lưới Voucher, sáu cột
ấy để `xtable` TRỐNG và mọi cột gốc còn lại lấy bảng master — biết chắc, không đoán, không phải
nối database.

Vì sao trống mới đúng, đọc từ `FastBusiness$System$GetDynamicFilter`: `#_f.datasource` nhận
`isnull(b.xtable, '')`, và mọi phép dựng join của proc đều lọc `datasource <> ''`. Khai một
`xtable` cho sáu cột ấy là bắt proc `left join` thêm bảng master chỉ để lấy một cột đã nằm sẵn
trong hàng gốc. Ngược lại, cột gốc KHÔNG thuộc bộ sáu thì phải khai — proc nối nó bằng
`left join <xtable> <alias> on a.stt_rec = <alias>.stt_rec` cho những dòng không có `fieldkey`,
và đó chính là hình dạng của `ma_kh`, `t_tt_nt`, `ma_nt` trong bản chuẩn.

Đối chiếu trên 115 controller lưới Voucher của SEAVNFBO: 357 dòng khai đúng theo luật, 17 dòng
lệch — đều là màn hình có bảng gốc không phải bảng inquiry chuẩn. Nên đây là MẶC ĐỊNH tốt chứ
không phải luật tuyệt đối, và `inquiryColumns` vẫn ghi đè được.

Lưới KHÔNG phải Voucher thì không áp: bảng gốc của chúng là bảng nghiệp vụ riêng (`hrrmyc`,
`phrt`, `bim03$…` — đọc được ngay trong `sysfilterdeclares`), mỗi màn hình một khác. Ở đó vẫn rơi
về bảng master kèm ghi chú nói rõ là không có bộ chuẩn nào để dựa vào.

Sinh lại toàn bộ dòng của `SVTran` giờ khớp bản chuẩn trên mọi cột suy được — kể cả bốn dòng
`xtable` trống mà lượt trước sinh sai.

Hai stored proc nay được ghi thành NGUỒN ở đầu `filter-declare.mjs`, cùng ba điều chỉ đọc proc
mới biết: ý nghĩa của `datasource` trống và `%inquiryTable`, luật nối bằng `stt_rec` khi thiếu
`fieldkey`, và chuyện `joinClause` bị thay chuỗi trên đúng hai alias `a`/`b` — vế cuối này là lý
do phép quy về `a`/`b` ở lượt trước không phải chuyện trình bày mà là điều kiện để câu lọc chạy.


### Đã sửa — Ctrl+bấm một cột đến từ `Initialize.xml` nhảy sai chỗ

`loadGridConfig` cắt đúng thẻ `<group>` của controller ra khỏi `Grid/Config/Initialize.xml` rồi
quét trên lát ấy, nên mọi span bộ quét trả về đo TỪ ĐẦU THẺ. Nhưng nó đưa kèm `segments` của cả
FILE, tức đo từ đầu file — hai hệ toạ độ trộn vào nhau. Ctrl+bấm một cột như thế nhảy tới vị trí
cùng số ấy tính từ đầu file, cách chỗ đúng đúng bằng khoảng cách tới thẻ `<group>`; file thật
khai cả trăm controller nên đó là hàng chục nghìn ký tự, và con trỏ đáp xuống giữa cấu hình của
một controller khác hẳn.

Nay bản đồ đoạn được DỜI theo lát vừa cắt (`shiftSegments`). Dời bản đồ chứ không dời từng span:
span nằm rải trong nhiều cấu trúc lồng nhau (`attrSpans`, `columns`, `valueSpan`), còn bản đồ chỉ
là một mảng phẳng.

### Đã thêm — ba nguồn khai cột, ba màu, và một tuỳ chọn mở kèm file liên quan

`data-fbo-foreign` chỉ nói «khai ở file khác», mà ba nguồn rất khác nhau cùng rơi vào đó: Include
kéo qua entity, `Grid/Config/Fields/<Tên>.xml`, và `<group>` dùng chung trong
`Grid/Config/Initialize.xml`. Diện ảnh hưởng của chúng khác hẳn — sửa một cột của `<group>` là
đổi cho MỌI controller cùng nhóm — nên một màu cho cả ba là giấu mất đúng thứ người dùng cần biết
trước khi sửa.

Nay cột mang `data-fbo-config`: tím cho bản riêng của controller, hồng cho nhóm dùng chung. Màu
nói ra rằng cột đến từ chỗ khác, còn tooltip của ô tiêu đề nói ra chỗ nào — «từ Initialize.xml
(nhóm dùng chung — sửa là đổi cho mọi controller cùng nhóm)». Không có tooltip thì bảng màu cần
một chú giải, mà chú giải thì không có chỗ nào đặt trong một cái lưới.

Thêm `fboDesigner.revealRelatedFiles`:

| | Ctrl+bấm mở gì |
|---|---|
| `one` (mặc định) | chỉ file khai ra ô đang bấm |
| `all` | thêm mọi file cùng góp phần: dòng `&Name;` trong file chủ, `Config/Fields/<Tên>.xml`, `Config/Initialize.xml` |

Một cột lưới có thể được khai ở tới bốn chỗ, và câu hỏi ngay sau «nó khai ở đâu» thường là «còn
chỗ nào khác nói về nó nữa». Danh sách file lấy từ chính các mảnh ĐÃ ĐỌC (`model.relatedFiles`),
không đoán theo quy ước thư mục. Mặc định vẫn `one`: mở bốn tab cho một cú bấm là thứ phải tự
chọn, không phải thứ ập vào mặt người chỉ định liếc một cái. File phụ mở với `preserveFocus` và
không đặt con trỏ — chỉ file chính mới được, nếu không thì không còn biết cái nào là chỗ vừa hỏi.

Ca ENTITY đi cùng đường: `all` mở kèm file chủ tại đúng dòng `&Name;` đã kéo hàng đó vào — vế thứ
hai mà Alt+bấm vốn phải chọn thay vì được xem cùng lúc.

### Đã sửa — cột dùng chung chen lên trước cột khai riêng

Thứ tự cột giờ theo đúng mức độ cụ thể của nguồn:

1. view của chính `Grid/<Tên>`
2. `Config/Fields/<Tên>` @`arrangement` — luật neo chạy sau cùng nên nó nói lời cuối về vị trí
3. các cột `Config/Fields/<Tên>` khai thêm
4. cột của `<group>` trong `Config/Initialize.xml`

Bản trước xếp 4 TRƯỚC 3, và không vì một lý do nào cả — chỉ vì tầng vỏ đẩy `Initialize` vào mảng
trước. `arrangement` cũng lấy theo «mảnh cuối cùng khai», thứ chỉ đúng nhờ thứ tự mảng ấy; đảo
thứ tự là `Initialize` lặng lẽ giành mất quyền sắp xếp khỏi bản riêng của controller.

Nay xếp bằng `rank` — luật ưu tiên là quy ước của FBO, không phải chi tiết cài đặt của tầng vỏ —
và `arrangement` lấy từ mảnh CỤ THỂ NHẤT khai nó. Đảo thứ tự mảng đầu vào cho ra cùng kết quả,
và có test ghim đúng điều đó. `Initialize` khai `arrangement` mà bản riêng không khai thì vẫn
dùng của `Initialize`: «bản riêng thắng» không có nghĩa là bỏ qua.

### Đã thêm — rê chuột vào ô nhập thì hiện tên field

Câu hỏi hay hỏi nhất khi nhìn một form FBO lạ là «ô này là field gì» — để viết JS, để tra cột
database, để tìm nó trong XML. Trước nay trả lời được bằng cách bấm vào ô rồi đọc bảng Debug, tức
ba thao tác cho một câu hỏi hỏi liên tục.

Hiện CẢ HAI tên khi chúng khác nhau: `ten_kh2 · khai: ten_kh%l`. Bên trái là cột database thật
(thứ cần viết vào SQL), bên phải là thứ nằm trong XML (thứ cần tìm kiếm) — đưa một cái thì người
dùng vẫn phải tự suy cái kia, và `%l` phân giải theo bản đang xem chứ không cố định. Áp cho cả ô
form lẫn ô lưới. `title` không đổi một px nào của bố cục nên nó không phá luật «form phải giống
runtime từng px».


### Đã sửa — lưới ĐỨNG RIÊNG không sửa được cột nào

`data-fbo-grid` là khoá duy nhất webview dùng để nói «cột này thuộc lưới nào» (`gridColTarget`).
Nó chỉ được gắn ở MỘT chỗ: ô `<td class="FormCellGrid">` của form chứa lưới nhúng. Nên mở thẳng
một `Grid/X.xml` ra thì cả trang không có dấu nào — hàm tra trả `null`, và cú `mousedown` kéo
giãn cột thoát ngay từ dòng đầu. Không riêng kéo giãn: chèn cột và xoá cột cũng đi qua đúng hàm
ấy, nên với lưới đứng riêng thì KHÔNG phép sửa cột nào chạy, và nó im lặng — không cảnh báo,
không nhật ký, con trỏ cũng không đổi.

Nay lưới tự xưng tên trên chính panel của nó: lưới nhúng lấy tên từ `<items controller="X"/>`
của form, lưới đứng riêng suy từ tên file đang mở. Lưới nhúng vì thế mang hai dấu (ô của form +
panel) — không sao, `closest` lấy cái gần nhất và hai dấu cùng một tên.

Tầng edit cũng đổi theo: với lưới đứng riêng nó DÙNG LẠI model mà `render()` vừa vẽ thay vì dựng
lại từ file lưới. Model vẽ đã gộp `Grid/Config` (cột ẩn, `arrangement`); model dựng lại thì
không — và mọi cột đến từ Config sẽ báo «không có cột …» dù nó nằm sờ sờ trên màn hình.

### Đã sửa — chèn cột lưới: khai báo đi lạc sang file form, và không có bề rộng

Hai lỗi trong cùng một thao tác:

**Khai báo đi lạc.** Chỗ đặt `<field>` mới chọn bằng `fieldsHost`, thứ rơi về controller đang mở
khi file lưới không có `<fields>`. Với lưới nhúng đó là một cái bẫy im lặng: cột được thêm vào
`<view>` của `Grid/X.xml` trong khi khai báo của nó nằm ở `Dir/Y.xml`. Runtime đọc lưới không
thấy `<field>` nào tên ấy — cột hiện ra rỗng, và không có gì nối hai chỗ đó lại khi đi tìm
nguyên nhân. Nay khai báo cột lưới LUÔN vào `<fields>` của chính file lưới; không có `<fields>`
thì từ chối kèm lý do, chứ không đoán sang file khác.

**Không có bề rộng.** Cột lưới có bề rộng riêng ở `<field width="N">`; không khai thì runtime tự
cho 100px — con số vẫn tồn tại, chỉ nằm ở chỗ không ai đọc được. Nay lúc tạo cột có hỏi bề rộng,
điền sẵn 100 nên Enter là đi tiếp. Ô của FORM thì KHÔNG hỏi và không sinh `width`: px của nó nằm
ở list cột của vùng (`<item value="100, 60, …">`), khai thêm một con số runtime bỏ qua chỉ làm
người đọc file sau này tin nhầm.

### Đã sửa — script lọc nhanh sinh sai bản đồ join

Đối chiếu với bản chuẩn của Fast: `sysfilterdeclares` của SEAVNFBO, 38 dòng của `SVTran` và 705
dòng có join của toàn database. Năm chỗ lệch, và chỗ đầu là lỗi thật:

**1. `fieldkey` / `reffieldkey` ghép NGƯỢC.** Đúng phải là `a.<reffieldkey>=b.<fieldkey>` —
`fieldkey` là khoá trên bảng ĐƯỢC join tới, `reffieldkey` là khoá trên bảng XUẤT PHÁT. Kiểm trên
cả 705 dòng: 586 dòng khớp đúng chiều, **0 dòng ngược chiều**, 106 dòng còn lại là join ghép
nhiều điều kiện nên không so bằng chuỗi được. Lỗi này KHÔNG lộ ra ở ca thường nhất
(`a.ma_kh=b.ma_kh`, hai khoá trùng tên nên đổi chỗ vẫn ra cùng chữ) — nó chỉ sai khi hai bên đặt
tên khác nhau, đúng lúc `user_id0` join với `u_id`. Bộ test cũ dùng fixture trùng tên nên không
bắt được; nay có một ca hai đầu khác tên.

**2. `joinclause` chép nguyên alias của file.** Bản chuẩn LUÔN viết theo cặp `a`/`b` (704/705
dòng), còn mệnh đề trong `<query event="Finding">` dùng alias do file đặt (`e1`, `m3`…). Chép
nguyên là runtime ghép ra câu tham chiếu một alias không tồn tại. Nay quy về `a`/`b` trong một
lượt thay, và viết sát dấu `=` như bản chuẩn (687/705 dòng viết sát).

**3. `xtable` của cột gốc luôn để trống.** Alias gốc `a` CHÍNH LÀ bảng inquiry, không phải bảng
master — nên cột gốc chỉ để trống `xtable` khi nó nằm sẵn trên bảng inquiry. Đo được:
`i81$000000` của SEAVNFBO chỉ có `ma_dvcs, ngay_ct, so_ct, status, user_id0`, và đúng năm cột ấy
là toàn bộ số dòng `xtable` null; 30 cột gốc còn lại đều mang `m81$%Partition`. Bảng inquiry là
chuyện của database nên `buildFilterDeclarations` nhận thêm `inquiryColumns`; không truyền thì
rơi về bảng master và script mang theo câu SQL để tự tra. Sai về phía bảng master là join dư một
bảng (chậm, vẫn đúng); sai về phía để trống là cột không tìm thấy và câu lọc nổ.

**4. `reftable` ghim cứng bảng master.** Có 128 dòng dùng `%inquiryTable` — join xuất phát từ một
cột nằm trên bảng inquiry. Ghi bảng master ở đó là join từ một bảng không có cột ấy. Nay chọn
theo chính khoá xuất phát, và join bắc cầu thì lấy bảng của join trước nó.

**5. Cột SỐ qua join không được bọc `isnull`.** Lý do cũ («bọc cột số là ép kiểu và đổi nghĩa
`>=`») sai: `isnull(x, 0)` không ép kiểu gì, và bản chuẩn làm đúng thế
(`SVTran.PaymentDay(s)` → `isnull(ÿhan_tt, 0)`). Không bọc thì `left join` trả NULL và mọi phép
so sánh đều sai, y hệt ca cột chữ. Cột NGÀY vẫn để trống: `isnull(ngày, 0)` ra 1900-01-01, một
giá trị lọt được vào khoảng «từ ngày … đến ngày …» — và bản chuẩn không có cột ngày nào qua join
để mà bắt chước.

Kèm hai chỗ nói thật thay vì đoán:

- **join ghép nhiều điều kiện** thì cặp khoá chính không chắc đứng đầu (106 dòng ghép, chỉ 9
  dòng có cặp thật đứng đầu — `SVTran.StatusName` lấy cặp THỨ HAI, và vế `ma_ct='HDA'` thành
  `exfieldkey`). Máy vẫn sinh dòng nhưng đánh dấu «XEM LẠI» kèm lý do.
- **`exname`** khi tên field trên màn hình khác tên cột nguồn (`u1` ↔ `u_name`) không suy được từ
  XML — vẫn để trống, và nói ra.

`id` cũng bỏ khoảng trắng cho khớp bản chuẩn (`SVTran.CustomerName`; 0/705 dòng có dấu cách).
Ghi chú chung của cả lượt sinh nay đi vào đầu script — trước đây `buildFilterDeclarations` trả
chúng về mà `renderFilterDeclareSql` không nhận, nên cảnh báo quan trọng nhất rơi mất trên đường.

Đối chiếu lại một dòng đầy đủ với chính bản chuẩn (`SVTran.CreatedBy`): 7/7 cột suy được đều
khớp từng ký tự — `xtable=vsysuser`, `fieldkey=u_id`, `reftable=%inquiryTable`,
`reffieldkey=user_id0`, `joinclause=a.user_id0=b.u_id`.


### Đã sửa — kéo giãn cột lưới: thân và tổng không đi theo tiêu đề

Phép kéo chỉ sửa `style.width` của ô TIÊU ĐỀ. Nhưng lưới runtime không có `table-layout:fixed`,
không có `<col>` nào, và tiêu đề với thân còn nằm ở hai BẢNG khác nhau (`divHeader` / `divGrid`) —
bề rộng nằm trên từng `<td>`. Sửa một bên thì bên kia không có đường nào biết: tiêu đề giãn ra,
hàng dữ liệu đứng im, và từ ô thứ hai trở đi tiêu đề lệch hẳn khỏi cột của nó.

Nay một cú kéo sửa cả cột — ô tiêu đề, mọi ô dữ liệu, ô tổng, và div container BÊN TRONG từng ô
(chỉ sửa `<td>` thì div bên trong ghim ô ở bề rộng cũ). Ghép theo VỊ TRÍ ô trong hàng chứ không
theo `data-fbo-column`: ô số thứ tự và ô tổng cố tình không mang `data-fbo-*` — chúng là chrome,
không phải slot sửa được — nhưng vẫn phải giãn theo. Bất biến «bốn hàng khớp nhau từng ô» nay có
test ghim ở `test-grid.mjs`.

### Đã sửa — dải px của lưới trôi lên xuống mỗi khi kéo giãn cột

Hai lỗi chồng lên nhau, cùng ở lớp blueprint:

**Con số không đổi.** Nhãn px đọc từ `data-fbo-col-widths` của bảng tiêu đề, mà phép kéo không
đụng tới thuộc tính ấy. Cột giãn ra trước mắt còn con số dưới thước vẫn đứng ở giá trị cũ, và
người dùng không có cách nào biết mình đang kéo tới đâu cho tới lúc thả tay.

**Cả dải dịch chỗ.** `drawRegion` đo tỉ lệ zoom bằng `rộng thật / tổng px khai`. Với form thì
đúng — bảng `table-layout:fixed` rộng đúng tổng px. Với lưới thì sai: ô lưới là content-box còn
div container cộng thêm `padding:4px` hai bên, nên bảng luôn rộng hơn tổng px và `k` ra 1.078
ngay cả khi zoom = 1. Tệ hơn, mẫu số là TỔNG PX KHAI — nên mỗi lần kéo giãn một cột, `k` nhảy và
`top` của dải px nhảy theo, trong khi cột chỉ đổi bề RỘNG.

Nay lưới đo zoom bằng `rect / offsetWidth` (bề rộng layout, chưa nhân zoom), cùng công thức
`gridTicks` vẫn dùng cho mốc nhãn. Form giữ nguyên công thức cũ: ở đó vạch KHÔNG trùng mép ô là
một tín hiệu thật, và đổi công thức là bịt mất đúng cái tín hiệu ấy.

### Đã thêm — xoá control cuối cùng của hàng thì bỏ luôn thẻ `<item>`

Một `<item value="----: "/>` không còn token nào vẫn CHIẾM một hàng trên form — runtime dựng
`<tr>` cao bằng hàng thường. Người dùng vừa xoá control cuối cùng và nhìn thấy một khoảng trắng
không giải thích được, trong khi XML còn một dòng trông như có nội dung.

Từ chối bỏ thẻ khi không biết chắc biên của nó (thiếu `itemRange`, hoặc thẻ nằm ở file khác dải
`value`, hoặc đoạn sắp cắt không phải một `<item …/>`) — khi ấy rơi về lối cũ: ghi lại value rỗng,
vẫn đúng, chỉ còn thừa một hàng.

### Đã thêm — Shift+Delete xoá cả cụm: Label, Footer, Description

Ba kind ấy chỉ tô điểm cho một ô Input, không sống độc lập. Để chúng ở lại là để lại một cái nhãn
trỏ vào hư không và một dòng chú thích của control không còn tồn tại.

Phép này đụng NHIỀU HÀNG ở NHIỀU FILE: `[x].Description` hay nằm ở hàng dưới, `[x].Footer` ở hàng
cuối vùng, và hàng phụ có thể ở Include trong khi hàng chính ở controller. Nên `applySplice` nay
nhận một DANH SÁCH splice thay vì `splice` + `extra`, và tất cả đi chung một `WorkspaceEdit` —
một lần hoàn tác trả lại đúng trạng thái cũ, không có nửa vời «control đã mất mà nhãn còn nguyên».

Chỉ ô INPUT mới kéo theo cả cụm. Shift trên chính ô `.Label` thì chỉ ô đó đi — người dùng nhắm
vào cái nhãn thì xoá cả control là làm nhiều hơn họ yêu cầu.

Khai báo `<field>` vẫn được đề nghị xoá kèm khi không còn hàng nào dùng, và nay tìm ở CẢ
controller lẫn file chứa hàng: `<fields>` gần như luôn ở controller kể cả khi hàng đến từ Include,
nên bản trước (chỉ tìm trong file chứa hàng) không bao giờ tìm ra.

### Đã thêm — Ctrl+Z hoàn tác được ngay trong designer

Undo của VS Code bám vào editor đang active. Đứng trong webview thì editor active chính là cái
webview — không phải TextEditor nào cả — nên phím tắt của workbench không có gì để bám và cú
Ctrl+Z rơi vào hư không.

Designer nay giữ một chồng hoàn tác RIÊNG (`edit-history.js`) cho những phép sửa do chính nó gây
ra, dùng chung giữa panel và custom editor. Nó KHÔNG thay undo của editor: gõ tay trong XML vẫn là
undo của VS Code lo. Ctrl+Y và Ctrl+Shift+Z làm lại.

Ảnh chụp là TOÀN VĂN file, không phải splice ngược: một phép sửa có thể chạm hai file cùng lúc, và
VS Code còn chỉnh thêm lúc lưu (cắt khoảng trắng cuối dòng, thêm dòng trắng cuối file) — offset
ngược không còn đúng sau đó. Trước khi lùi, file phải đang mang đúng trạng thái mà bước ấy để lại;
không khớp thì TỪ CHỐI và nói rõ, vì hoàn tác khi ấy sẽ nuốt luôn thứ người dùng vừa gõ tay.

### Đã thêm — ba tuỳ chọn hỏi trước khi ghi

| tuỳ chọn | mặc định | hỏi về chuyện gì |
|---|---|---|
| `fboDesigner.confirmForeignEdit` | bật | ghi vào file KHÁC file đang mở (Include, khai báo `&ENTITY;`) |
| `fboDesigner.confirmDelete` | bật | xoá một control khỏi form, hoặc một cột khỏi lưới |
| `fboDesigner.entityEditTarget` | `ask` | thao tác lên control đến từ `&ENTITY;` thì ghi vào đâu |

Hai cái đầu tắt được vì người quen tay sửa Include suốt ngày thì mỗi thao tác một hộp thoại là
phiền hơn là an toàn — và tắt không phải là mất đường về, Ctrl+Z vẫn lùi được.

### Đã thêm — phân giải `&ENTITY;` vào file thiết kế

Hai đường đi cho một hàng đến từ Include, và chúng dẫn tới hai kết quả khác hẳn nhau:

- **Cập nhật file gốc** — sửa `Include\…`, mọi controller include file đó cùng đổi theo. Đúng khi
  đang sửa một quy ước dùng chung.
- **Phân giải vào file thiết kế** — comment dòng `&Name;` trong controller rồi chèn bản đã bung
  ngay dưới, và sửa trên bản ấy. Chỉ màn hình NÀY đổi. Đúng khi đang customize cho một khách.

Tham chiếu cũ được COMMENT chứ không xoá: người đọc file sau này thấy ngay «chỗ này từng là
`&Name;`, đã bung ra tại chỗ» và biết đường quay lại. Xoá đi là biến một quyết định thành một sự
trùng hợp.

TỪ CHỐI khi dòng chứa `&Name;` còn thứ khác ngoài chính nó — comment cả dòng khi ấy là tắt luôn
phần nội dung kia, hỏng im lặng. Cũng từ chối khi tham chiếu nằm ở một Include khác chứ không ở
controller đang mở: ở đây không có dòng nào để mà comment.

Nội dung chèn xuống lấy từ chính bản đã bung của lần render đang xem (`refResolvedSpan` gom các
đoạn cùng một tham chiếu theo ĐỒNG NHẤT `ref`), không bung lại — cái được chèn phải đúng bằng cái
người dùng đang nhìn.

### Đã sửa — render sau mỗi thao tác chậm thấy được

Bốn nguyên nhân, ba trong số đó là công lặp lại:

1. **Vẽ lại nhiều lượt cho một thao tác.** `onDidChangeTextDocument` bắn một nhịp cho mỗi file
   `applyEdit` đụng tới, rồi một nhịp nữa nếu `save()` khiến VS Code cắt khoảng trắng cuối dòng.
   Xoá control kèm khai báo `<field>` là hai file; phân giải entity rồi sửa là hai lượt ghi. Mỗi
   nhịp kéo theo một lượt bung entity + dựng lại toàn bộ HTML, nên lượt cuối — lượt duy nhất
   người dùng nhìn thấy — phải xếp hàng sau hai, ba lượt vô ích. Gõ tay trong XML cũng vậy: từng
   phím một lượt.

   Hai lớp chặn, vì một lớp không đủ. **Bấm giờ 40ms** gộp những nhịp rơi gần nhau (dưới ngưỡng
   mắt thấy được, quanh 100ms). Nhưng bấm giờ chỉ là cái lưới thưa: `applyEdit` với `save()` là
   hai lượt chạm đĩa, trên máy đang bận chúng cách nhau hơn 40ms và lại ra hai lượt vẽ. Nên thêm
   **chốt `editing`**: trong lúc một phép sửa (hoặc một phép hoàn tác) đang chạy, nhịp vẽ chỉ
   được GHI NHẬN; khi phép sửa ngã ngũ mới thả ra đúng một lượt. Không phụ thuộc vào việc đoán
   đúng con số mili giây.

   Phép sửa bị TỪ CHỐI thì không nhịp nào bị hoãn, và khi ấy không vẽ lại gì cả — dựng lại
   `innerHTML` là mất vị trí cuộn với tab đang mở, trả giá cho một thao tác không xảy ra.
2. **Đọc lại đĩa mỗi lần vẽ.** Bung entity đọc lại toàn bộ Include mà controller kéo vào (một
   controller thật kéo hơn hai chục file), mỗi file lại dò BOM và decode. Nay nhớ theo
   `mtime + size`: `statSync` rẻ hơn đọc-và-decode cả bậc, mà vẫn bắt được thay đổi từ công cụ
   ngoài VS Code.
3. **Bung lại cấu hình lưới mỗi lần vẽ.** `Grid/Config/Initialize.xml` kéo cả `Include\Field.ent`
   và bung ra 147 `<controller>` — chỉ để lấy đúng một thẻ `<group>`. Từng lưới Detail nhúng trong
   tab cũng bung lại. Nay nhớ kết quả ĐÃ BUNG, bỏ nhớ theo mtime của MỌI file đã góp vào nó (đọc
   từ `segments`, không phải đoán) — nên sửa `Field.ent` vẫn thấy đổi ngay.
4. **Custom editor gửi cả `model` qua `postMessage`.** `model` mang `Map` và hàm getter nên
   structured clone NÉM, và cả bản vẽ không tới nơi. Panel đã bóc từ đầu; custom editor thì chưa.

Đo trên một cây program giả có fan-out giống thật — 22 Include, 132 hàng, 147 controller trong
`Initialize.xml`:

| | mỗi lượt vẽ | lượt đọc đĩa |
|---|---|---|
| đọc lại mọi thứ | 19,2 ms | 24 |
| nhớ theo mtime | 6,0 ms | 0 |

Cộng cả phần gộp nhịp: một thao tác trước đây tốn 2–3 lượt × 19,2ms ≈ 40–58ms công của host, nay
còn đúng một lượt 6ms.

### Đã sửa — khai báo `<field>` mới viết theo đúng lối của corpus

Field chỉ có `<header>` nằm gọn một dòng; field có thêm `<items>` hay `<footer>` thì xuống dòng và
thụt vào — đo trên `Dir/Customer.xml`. Bản trước luôn sinh một dòng dài
`<field …><header …/><items …/></field>`, thứ không giống bất kỳ dòng nào quanh nó. Thụt lề do
`planAddField` kê lại theo file đích, vì nó là bên duy nhất biết file dùng mấy dấu cách.

### Đã sửa — thanh dưới chỉ còn dòng hướng dẫn thao tác

Trước đây nó còn ba dòng nữa: số entity đã bung, danh sách tài nguyên, và tỉ lệ nhìn. Cả ba là số
liệu CHẨN ĐOÁN, không phải thứ cần liếc khi đang kéo thả — chúng đẩy thanh dưới cao lên ba, bốn
dòng, ăn mất chiều cao của chính cái form đang xem, và dòng hướng dẫn chìm nghỉm giữa chúng.

Số liệu vẫn còn chỗ: mã hoá/EOL/program ở thanh trên, cảnh báo XML và số entity đi vào kênh Output,
stylesheet với ảnh nằm trong panel Debug. (`showWarnings` trước nay còn ghi vào một phần tử
`#fbo-warnings` KHÔNG tồn tại trong `shell.html` — nó ném `TypeError` mỗi lần chạy.)


### Đã sửa — hồi quy: CSS riêng của controller bị base pack đè

Bản gắn scope `#fbo-form` ở lượt trước làm base pack thắng CSS program — đúng yêu cầu — nhưng nó
thắng luôn cả `<css>` của CHÍNH controller. Nút «Khác…» (`div.GroupExtra`) do controller tự khai
icon bị `.ToolbarBackgroundImage` của base pack đè, và hiện sprite chung thay vì ảnh của nó.

Nay `<css>` của controller cũng được gắn scope, thành ba tầng có thứ tự rõ ràng:

| tầng | nguồn | đặc hiệu | ở đâu |
|---|---|---|---|
| 1 | CSS program (`<link>`) | `div.X` = 0-1-1 | head |
| 2 | base pack | `#fbo-form .X` = 1-1-0 | head |
| 3 | `<css>` của controller | `#fbo-form div.X` = 1-1-1 | body |

Tầng 2 thắng tầng 1 bằng đặc hiệu; tầng 3 thắng tầng 2 vì `div.GroupExtra` sau khi gắn scope là
(1,1,1), và khai bằng class trần thì hoà đặc hiệu rồi thắng bằng thứ tự. Runtime cũng xếp đúng
thế: `<style>` của controller nhúng sau mọi `<link>`.

Đo lại trên bàn đo với đúng rule `div.ToolbarBackgroundImage` của HOATP: nút thường lấy
`fbo-toolbar.png` (base thắng program), nút `GroupExtra` lấy `fbo-group.png` (controller thắng base).

### Đã sửa — `field@align`, và `type="Boolean"` mặc định canh giữa

`align` trước nay chỉ đặt trên `<input>`. Với `type="Boolean"` thì vô nghĩa: `text-align` không
làm gì trên một `<input type="checkbox">` — checkbox là hộp cỡ cố định, nó chỉ dịch khi thứ BỌC
nó canh nó. Nên cột Boolean vĩnh viễn dính lề trái.

Nay `alignOf(field)` là một chỗ duy nhất quyết định, và kết quả đặt trên CẢ container lẫn control:
`align` khai tay thắng tất cả, rồi `<items style="Numeric">` canh phải, rồi `type="Boolean"` canh
giữa. Áp cho cả form lẫn lưới.

### Đã thêm — hai màu cho hai nguồn khai báo

Xanh (đã có): khai ở file KHÁC file đang mở — Include, entity. Hổ phách (mới): khai ở một file
`.f`, tức **bản chuẩn của sản phẩm** mà designer từ chối ghi vào và bản nâng cấp sau sẽ ghi đè.

Hai cờ chứ không một, vì chúng nói hai chuyện khác nhau và một hàng có thể là cả hai — khi ấy giữ
nền xanh và thêm vạch hổ phách bên trái, chồng hai nền lên nhau ra một màu thứ ba không nói gì cả.
Nguồn hiệu lực là `origin.file` khi có `segments`, không thì chính `hostFile` — thiếu vế fallback
là mở thẳng một `Dir/X.f` mà không hàng nào được tô, đúng ca hay gặp nhất. Dải trạng thái nói ra
số lượng để không ai phải đoán ý nghĩa của màu.

### Đã sửa — thao tác sửa làm nhảy về tab đầu, và giật khung hình

Hai triệu chứng, một gốc: mọi phép sửa đi đường vẽ lại TOÀN BỘ (`formLayer.innerHTML = …`).

**Tab**: trạng thái DOM bị xoá sạch nên tab luôn về cái đầu tiên. Đang đứng ở tab «Thông tin khác»
sửa một control thì bị ném về tab «Chi tiết» rồi phải tự bấm quay lại — sửa mười control là mười
lần. Nay nhớ tab theo `id` của panel (không theo chỉ số: chỉ số đổi khi thêm/bớt tab) và khôi phục
sau mỗi lần vẽ. Tab cũ không còn thì im lặng rơi về tab đầu.

**Giật**: cơ chế vá MỘT hàng đã có sẵn nhưng chỉ mở cho `resize`. `move`, `insert`, `remove` cũng
chỉ ghi lại `value` của đúng một thẻ `<item>`, nên cả ba nay đi cùng đường — không dựng lại cả
form, không mất vị trí cuộn. `addRow` vẫn vẽ lại toàn bộ: nó thêm hẳn một hàng, không có hàng cũ
nào để vá. Sau phép dời, ô được chọn lại theo CỘT mới chứ không theo chỉ số ô cũ.

### Đã sửa — ba chỗ nhỏ của lưới và control

**px của cột lưới không cập nhật khi kéo.** Thước blueprint đọc `data-fbo-width`, mà lúc kéo chỉ
`style.width` đổi — cột giãn ra trước mắt còn con số dưới thước đứng im ở giá trị cũ. Nay đổi cả
thuộc tính.

**Dải nút trôi theo dữ liệu lưới.** Đổi từ `position:relative` sang `sticky; left:0` — nó vẫn tạo
tầng riêng nên menu group vẫn vẽ đè lên lưới. Đo lại: cuộn lưới 200px, dải nút đứng yên.

**Dropdownlist không chọn/kéo/gộp được.** `<select>` là phần tử thật: bấm vào là mở danh sách, và
cú bấm KHÔNG bao giờ tới được `<td>`. Designer chỉ VẼ, không nhập liệu — nay mọi `input`, `select`,
`textarea` trong bản vẽ đều `pointer-events: none`, nên mọi cú bấm rơi đúng vào ô và mọi thao tác
sửa layout áp cho MỌI loại control như nhau.

### Đã sửa — thêm/xoá control bị khoá vì hàng có entity

`1111-: [&k;].Label, [&k;], [ma_kh_ref].Label, [ma_kh_ref]` — thêm một control vào ô trống bên
phải chẳng liên quan gì tới `&k;`, nhưng bản trước TỪ CHỐI cả thao tác đó.

Lý do: mọi phép sửa hàng chạy trên model dựng từ `clearText`, tức bản ĐÃ BUNG (`[ma_kh]`). Ghi
bản ấy đè lên nguồn là xoá sạch tham chiếu entity, nên `canEditRow` chặn — chặn đúng, nhưng chặn
cả những phép chẳng đụng gì tới entity.

Nay THÊM, XOÁ và DỜI chạy trên **bản parse của văn bản GỐC**. Token không đụng tới đi qua nguyên
văn `t.raw`, nên `[&k;]` vẫn là `[&k;]` từng byte; `serializeRow` ghi lại đúng chuỗi ấy. Kết quả
đo trên chính ví dụ trên:

```
trước: 1111-: [&k;].Label, [&k;], [ma_kh_ref].Label, [ma_kh_ref]
sau  : 11111: [&k;].Label, [&k;], [ma_kh_ref].Label, [ma_kh_ref], [ghi_chu]
```

Hai chốt còn lại, và cả hai đều cần: **pattern** không được chứa entity (phép thêm ghi lại
pattern, `-` thành `1`), và bản gốc phải parse ra đúng pattern và đúng số token như model — lệch
nghĩa là offset đã cũ hoặc có entity bung ra nhiều token, cả hai đều làm chỉ số trỏ sai chỗ.

`planAddRow` cũng bỏ `canEditRow`: nó CHÈN một thẻ `<item>` mới, không ghi đè ký tự nào của hàng
cũ. `canEditRow` vẫn còn nguyên và vẫn chặn phép ghi đè cả hàng — nó chưa bị gỡ bỏ.

### Đã sửa — tab dạng lưới vẫn vẽ anchor/split

Ở tab chỉ chứa lưới, hai con số ấy không có nghĩa gì, nhưng blueprint vẫn mọc ra mỏ neo và vạch
chia KÉO ĐƯỢC — kéo là ghi một con số vô nghĩa vào `<category>`.

Chốt cũ (`table.closest('.GridTabPanel')`) chỉ bắt bảng CỦA CHÍNH lưới; bảng của TAB thì lưới là
con của nó nên `closest` không thấy. Nay hỏi bằng `querySelector`, và đòi MỌI ô có nội dung đều
là ô lưới — tab trộn lưới với vài hàng form thường thì anchor/split vẫn nói về mấy hàng ấy, tắt
đi là lấy mất một thao tác đang đúng. Vạch cột thì vẫn vẽ: chúng nói về list px, thứ tab lưới
vẫn dùng thật.

### Đã thêm — kéo thả control sang slot khác

`moveCell` dời một ô sang cột khác trong cùng hàng. **Span đi theo**: ô trải 3 cột dời sang chỗ
mới vẫn trải 3 — người dùng kéo một control, họ không ngầm yêu cầu bóp nó lại; chỗ mới không đủ
thì từ chối chứ không tự co. Token đi nguyên xi nên đây cũng là phép không đụng tới entity.

Vùng đích được phép CHỒNG vùng nguồn (dời một nấc là ca thường nhất), nên phép kiểm "cột đích có
trống không" chạy trên pattern ĐÃ xoá vùng nguồn — kiểm trên pattern gốc thì mọi cú dời một nấc
tự đụng vào chính mình rồi bị từ chối.

Phía webview: kéo từ GIỮA ô đang chọn (cạnh vẫn là co giãn như cũ). Chỉ hoá thành phép dời khi
con trỏ đi quá 4px — không có chốt đó thì mọi cú bấm chọn ô đều thành một phép dời dài 0px và
người dùng mất luôn thao tác chọn. Bóng mờ bám mốc cột và đổi sang đỏ khi chỗ đích không nhận
được, để nói trước thay vì thả tay rồi đọc một câu từ chối.

### Đã sửa — entity và thẻ nằm trong `<!-- … -->` vẫn bị đọc vào

Cả `spans.mjs` lẫn `entities.mjs` quét bằng regex trên văn bản thô, và **không cái nào biết
comment là gì**. Ca thật, `Dir/Customer.xml` của HOATP, ngay sau `<views>`:

```xml
<!-- &BI.Form.View.Customer; -->
```

Entity ấy bung ra **2970 byte chứa nguyên một `<view>` với 28 `<item>`**. Designer bung nó,
`scanViews` nhặt phải, và vì `renderControllerHtml` lấy view đầu tiên — nó vẽ đúng cái view đã
bị tắt. File thì rõ ràng đã comment.

Sửa ở BA tầng, cùng một luật:

| tầng | thứ bị bỏ qua |
|---|---|
| `entities.mjs` · `collect` | `<!ENTITY>` bị comment — nặng vì luật FIRST-WINS: bản bị comment đứng trước còn THẮNG bản khai thật đứng sau |
| `entities.mjs` · `expand` | `&Name;` bị comment — vế nặng nhất, vì entity có thể bung ra cả khối `<view>` |
| `spans.mjs` | `<view>`, `<item>`, `<field>` bị comment |

Vùng comment tính ở `core/src/xml-comment.mjs`, và nó **KHÔNG cắt văn bản** — trả về VÙNG. Cả
tầng ghi ngược chạy bằng offset vào văn bản gốc; cắt một ký tự là mọi offset phía sau lệch và
phép ghi ngược nhắm sai chỗ. CDATA được coi là đục: script và SQL của FBO đầy dấu so sánh, đọc
một `<!--` trong đó thành comment là nuốt mất phần văn bản thật phía sau.

Quét lại corpus: `Dir/` 646 · `Grid/` 2015 · `Filter/` 2102 file — 0 crash.

### Đã sửa — designer gắn cứng vào file không kéo thả được

`FboDesignerProvider` nghe `ready`, `select`, `reloadAssets`, `assets`, `log` — **không nghe
`edit`**. Webview vẫn gửi, không ai nhận, nên lối mở này chỉ xem được. `PreviewPanel` thì có.
Nay cả hai cùng gọi `handleEdit`; nó vẫn là chỗ duy nhất biết luật sửa, hai lối mở chỉ khác nhau
ở câu hỏi «document nào».

### Đã sửa — thêm control cạnh một field khai ở Include báo «file không có `<fields>`»

Khai báo `<field>` mới được ghi vào file chứa HÀNG, nhưng hàng `<item>` hay nằm trong một
Include dùng chung, còn `<fields>` thì ở controller. Với `Dir/Customer.xml` của HOATP, thêm
control cạnh `ten_kh` báo «file không có &lt;fields&gt; để thêm khai báo vào» trong khi
controller có đủ.

Nay khai báo đi vào file SỞ HỮU `<fields>`, và `applySplice` nhận `extra` ở **file khác** file
chứa hàng — vẫn gộp vào MỘT `WorkspaceEdit` để không bao giờ để lại một file có control trỏ vào
field chưa tồn tại. File đích thứ hai cũng qua đủ chốt `.f` và mã hoá như file thứ nhất.

### Đã thêm — blueprint hiện số cột mỗi control chiếm

`drawSlots` chỉ vẽ ô TRỐNG, nên `colspan` của ô CÓ control chỉ đọc được bằng cách rê chuột chờ
tooltip — mà đó lại đúng là con số cần thấy khi sắp lại layout: một ô trải 3 và một ô trải 1
nhìn y hệt nhau nếu list px của chúng cộng lại bằng nhau. Chỉ vẽ khi trải > 1; nhãn không nhận
chuột, để không nuốt cú bấm chọn ô nằm dưới.

### Đã đổi — lưới cuộn trục NGANG, bỏ trục dọc

Đảo lại quyết định trước đó, theo chủ hệ thống. Trục ngang là thứ lưới thật sự cần: lưới 15–20
cột rộng hơn ô chứa nó, cắt cụt là mất luôn cột. Trục dọc thì không có gì để cuộn — chiều cao
thân lưới đã bị `<field rows>` ghim, và designer chỉ vẽ MỘT hàng mẫu.

### Đã sửa — CSS của extension bị CSS dự án đè

`HOATP` có `FastBusiness.NotifyExtender.NotifyExtender.css` khai `div.ToolbarBackgroundImage`.
Độ đặc hiệu 0-1-1, trong khi base pack khai `.ToolbarBackgroundImage` — 0-1-0. Đặc hiệu cao
thắng bất kể ai nạp trước, nên icon toolbar bị CSS của khách đè, và **đảo thứ tự `<link>` không
cứu được** — đó là chỗ dễ hiểu nhầm nhất của lỗi này.

Nay mọi selector của base pack được gắn tiền tố `#fbo-form` lúc nhúng vào trang, nên
`#fbo-form .ToolbarBackgroundImage` (1-1-0) thắng `div.ToolbarBackgroundImage` (0-1-1).

Không dùng `!important` vì nó thắng cả những chỗ program CỐ Ý vá — `Menu.css` là lớp vá thật
(`padding-right: 1px !important`) và phải còn tác dụng. Nâng đặc hiệu giữ đúng ranh giới: rule
thường của khách thì thua, `!important` của khách vẫn thắng. Không dùng `@layer` vì style KHÔNG
layer luôn thắng style có layer, mà CSS của khách nạp bằng `<link>` nên nó không layer.

Phép biến đổi nằm ở `core/src/css-scope.mjs` để bàn đo dùng chung một bản — `tools/probe-layout.mjs`
từ nay cũng nhúng và gắn scope y hệt webview, thay cho `<link>`. Bắt buộc phải giống: gắn scope
là đổi cascade, nên một bàn đo nạp kiểu khác sẽ đo đúng cái lỗi mà bản chạy thật đã hết.

### Đã sửa — hình học lưới: chiều cao, viền ô, dải nút, cuộn ngang

Năm chỗ, theo số của chủ hệ thống. Mọi con số dưới đây **đo lại trên bàn đo**, không suy.

**`<field rows="N">` = divHeader + divGrid.** Không gồm toolbar, divSplit hay dải cuộn. Phép
cộng đầy đủ cho `<view height="302">` + `<field rows="242">`:

```
toolbar    30   cố định, KHÔNG nằm trong rows
divHeader  30   (60 nếu có dải lọc nhanh)
divGrid   212   = rows − divHeader
divSplit    8
cuộn       22
──────────────
view      302   chiều cao vùng main (thân tab), KHÔNG gồm thanh nhãn tab
```

Bản trước đọc `rows` là «divGrid + divSplit + divFooter» và ra CÙNG 212 cho ca thường
(242−8−22 = 242−30), nên nó trông như đúng suốt. Panel lưới nay mang `data-fbo-block` để so
thẳng với `view@height` từ DOM.

**Viền ô đủ bốn cạnh mà bước hàng vẫn 22px.** Hai yêu cầu này đá nhau nếu vẽ bằng `border`: đo
4 hàng trong bảng `border-collapse: collapse` cho **bước 23px, tổng 93**. `box-sizing: border-box`
không cứu được — chế độ collapse coi viền thuộc về bảng chứ không thuộc ô nên bỏ qua nó. Hai nét
ngang nay vẽ bằng `box-shadow: inset`, thứ không tham gia layout: **bước 22px, tổng 88**. Hai nét
dọc vẫn là `border` thật để bề rộng cột không lệch khỏi `data-fbo-col-widths`. Hàng tiêu đề cùng
cách: 30 là 30 thật, 60 là 60 thật, thay vì 31 và 61.

**Dải nút cố định, menu group không bị cắt.** `overflow:hidden` trên dải nút cắt đúng cái menu xổ
xuống nằm trong `<td>` của nút group — rê chuột vào chỉ thấy một vạch. Bỏ `overflow`, thêm
`position:relative; z-index:5` để menu vẽ đè lên lưới. Runtime không gặp vì nó chèn popup vào
cuối `<body>` bằng JS, thứ ta không chạy.

**Không cuộn ngang.** Thanh cuộn ngang ở `divGrid` ăn thêm chiều cao ở đáy, mà chiều cao đó đã bị
`rows` ghim — nên hàng cuối bị nuốt và cả khối trông cao hơn `view@height`. Cột thừa nay bị cắt.
Trục dọc thì giữ.

Quét lại corpus FBISP24: `Grid/` 2015 file · `Dir/` 646 file · 0 crash.

### Đã sửa — icon nút toolbar theo CSS quy tắc chung, không theo danh sách chép tay

Chín lệnh hiện SAI icon, và tất cả đều hiện CÙNG một icon — icon lệnh «Mới»:
`Export` `Freeze` `Save` `Cancel` `Option` `Page` `Preview` `Aggregate` `GroupToolbarPrint`.

Nguyên nhân là một phép so lệch tầng. `renderToolbar` phát ra class theo công thức
`(có chữ ? "Text" : "") + (group ? "Group" : "") + lệnh`, nhưng lại hỏi «nút này có icon không»
bằng một `Set` 27 **tên lệnh** chép tay. Hai thứ khác nhau ngay ở nút có chữ: lệnh `Export` phát
ra class `TextExport`. `Export` có trong Set nên nút giữ `ToolbarBackgroundImage`, trong khi CSS
chung không khai `.TextExport` — và `.ToolbarBackgroundImage` mặc định cắt sprite tại `0 0`, tức
ô đầu tiên. Đo trên trình duyệt với chính base pack này:

```
.ToolbarBackgroundImage.TextNew      → fbo-toolbar.png @ 0px -44px
.ToolbarBackgroundImage.TextExport   → fbo-toolbar.png @ 0px   0px   ← không có rule
```

Danh sách chép tay sai theo cả hướng ngược lại: `Download` và `ImportData` KHÔNG có trong Set,
nhưng base pack khai đủ cho chúng bằng ảnh riêng (`fbo-download.png`, `fbo-upload.png`).

Và nhánh nút CHỈ ICON thì trước đây không hỏi gì cả — nó dán `ToolbarBackgroundImage` cho mọi
lệnh. `Compose` của `Grid/SOTran.f` là ca thật: `.ToolbarBackgroundImage.Compose` cho
`fbo-toolbar.png @ 0px 0px`, đúng bằng icon «Mới».

Nay theo đúng luật chủ hệ thống đã nói — **dù toolbar khai ở đâu thì icon cũng theo CSS quy tắc
chung**: hỏi thẳng CSS bằng ĐÚNG cái class sắp phát ra, trên cả hai nhánh (có chữ và chỉ icon),
với CSS = base pack + `<css>` riêng của program. `SPRITE_COMMANDS` xoá hẳn, nên không còn chỗ
cho một bản sao trôi khỏi CSS.

Core không chạm đĩa, nên văn bản CSS nền do tầng vỏ truyền vào qua `baseCss` — `render-host.js`
(`readBaseCss`, nhớ theo mtime), `tools/probe-layout.mjs`, và `core/tools/sweep.mjs`. Người gọi
quên truyền thì model mang một cảnh báo đọc được, thay vì im lặng vẽ mọi nút thành chỉ-chữ.

Test đọc CSS nền THẬT từ base pack chứ không chép một danh sách class vào file test — chép là
dựng lại đúng thứ vừa gỡ.

**Quét lại cả 2015 file `Grid/` của FBISP24**: 10.957 nút, 10.565 giữ icon thật, 392 thành
chỉ-chữ vì không CSS nào khai icon cho chúng (`Save`, `Cancel`, `Clear`, `Approve`, `Undo`…);
**không lưới nào mất toàn bộ icon**, 0 crash, 0 cảnh báo. Giữ nguyên thái độ cũ của dự án: thà
thiếu icon còn hơn hiện icon của lệnh khác.

### Đã thêm — lệnh «Khai báo lọc nhanh cho lưới này»

Ô lọc hiện ra trên màn hình chỉ là một nửa. Nửa kia nằm ở database `sys`, bảng
**`sysfilterdeclares`** — nó nói cho runtime biết cột trên màn hình lấy dữ liệu từ bảng nào và
join bằng khoá gì. Thiếu nửa XML thì không có ô để gõ; thiếu nửa database thì gõ xong lọc không
ra gì. Lệnh mới làm cả hai trong một lượt.

Chọn cột trong QuickPick, rồi:

1. **vá XML** — thêm `allowFilter`, `<query>&InsertCommandFilter;</query>`, `%Control.Filter;`
   trong DOCTYPE, và `<query event="Declare">` tạo bảng tạm `#filter`. Cả cụm vào MỘT
   `WorkspaceEdit`: một file có `allowFilter` mà thiếu `%Control.Filter;` là file không phân
   giải được, tức màn hình trắng — Ctrl+Z phải hoàn tác được cả cụm.
2. **sinh script SQL** — mở ra dưới dạng document chưa đặt tên, KHÔNG ghi xuống đĩa. Script
   chạy trên database của khách; cất ở đâu và có chạy hay không là quyết định của người dùng.

Cột nguồn suy từ chính file, không hỏi lại: mệnh đề join trong `<query event="Finding">` cho
`xtable` / `fieldkey` / `joinclause`, `<partition prime="…">` cho `reftable`. Mỗi dòng mang mức
tin cậy, và script đánh dấu `XEM LẠI` ngay đầu file cho dòng nào máy không đọc được nguồn.

**Ba chỗ ngữ nghĩa dễ sai, đọc từ `Include\FilterInitialize.xml` chứ không đoán:**

- `name` lưu `ten_kh%2`, không phải `ten_kh%l` — runtime join bằng `replace(b.name, '%2', '%l')`.
- `conditionalreplace` phải chứa mốc `char(255)`: `isnull(ÿten_kh%2, '')`. `FilterInitialize`
  thay `ÿ<field>` HAI lần — lần đầu bằng chính `conditionalreplace`, lần sau bằng `%[a].<cột>`.
  Viết `isnull(ten_kh%2, '')` trơn là lần thứ hai không có chỗ bám và cột mất tiền tố alias.
- `aliasName` mang hai nghĩa: `"b"` là alias, `"rtrim(e1.so_ct_hddt)"` là BIỂU THỨC. Vế thứ hai
  thành `exname` kèm cờ `char(254)` — cờ ấy bảo runtime đừng ghép thêm `%[a].` vào trước.

Hai ký tự mốc ghép bằng `char(255)`/`char(254)` trong script, không viết thẳng: cả tầng lọc nhận
ra chúng bằng đúng giá trị byte, nên qua một collation khác là lọc thôi chạy — mà script vẫn nạp
thành công, nên không ai biết.

**Giới hạn đo được trên FBISP24**: chỉ 36/2015 controller `Grid/` có câu Finding đọc được; 370
câu nằm trong `<Encrypted>`, số còn lại không có câu Finding nào. Với chúng lệnh vẫn dựng đủ
dòng — `controller` + `name` là cặp khoá, thiếu dòng thì ô lọc không làm gì cả — nhưng cột nguồn
để trống và đánh dấu `XEM LẠI`. Quét cả 2015 file: 15.151 dòng, 0 crash.

**Tên bảng là `sysfilterdeclares`**, không phải `sysfilterdelcare`.

### Đã thêm — dải lọc nhanh dưới tiêu đề cột lưới

`Grid` kiểu `Report` / `List` / `Voucher` có một dải `<div class="FilterPanel">` cao 30px nằm
TRONG mỗi ô tiêu đề — nút toán tử 22×22 cộng một ô nhập. Preview chưa vẽ nó, nên hàng tiêu đề
của mọi lưới danh sách đang hụt đúng 30px so với runtime, và vùng lọc nhanh thì không thấy đâu.

Nay vẽ, và luật bật/tắt **khác nhau theo `<grid type>`**:

| Loại lưới | Có ô lọc khi |
|---|---|
| `Voucher` | `allowFilter="true"` **và** field khai `<query>&InsertCommandFilter;</query>` |
| còn lại (danh mục, `Report`, `List`) | `allowFilter="true"` là đủ |
| `Detail` nhúng trong tab của form | không bao giờ |

Cả hai luật đo trên trang runtime đã lưu, không suy: `Grid/Customer.f` không có `<query>` nào mà
runtime vẫn vẽ đủ 5 ô nhập; ARTran đã customize (`type="Voucher"`) có `allowFilter` nhưng không
field nào khai `<query>`, và runtime dựng đủ 16 dải RỖNG — kể cả cho cột `stt_rec` ẩn.

Dải rỗng ấy phải dựng theo: chỉ dựng cho cột lọc được thì ô tiêu đề của các cột kia hụt 30px và
hàng tiêu đề gãy làm hai tầng cao thấp.

`&InsertCommandFilter;` phân giải thành **chuỗi rỗng** khi `Include\Filter.txt` là `IGNORE` — đó
là công tắc tắt lọc của cả hệ thống. Nên `scanFields` giữ NỘI DUNG `<query>` chứ không quy về cờ
boolean lúc quét; quy sớm là nuốt mất công tắc và preview vẫn vẽ ô lọc trong khi runtime không.

CSS `.FilterPanel*` (18 rule, 15 icon toán tử) trích nguyên văn từ `WebResource(2).axd`. Mọi icon
là `data:` URI nên không nợ tài nguyên nào.

**Giới hạn**: mọi cột đều vẽ nút toán tử số 8. `FilterPanelBackground11`…`15` cũng có trong CSS
runtime và nhiều khả năng là menu của cột số/ngày, nhưng trang đã lưu không có cột nào mở ra ở
đó — chưa đo được thì chưa đoán.

### Đã sửa — `%l` là hậu tố NGÔN NGỮ, không phải một phần của tên field

`ten_kh%l` không phải một cái tên. Nó là `ten_kh` ở bản tiếng Việt và `ten_kh2` ở bản tiếng
Anh — tức `select ten_kh from dmkh` với bản này, `select ten_kh2 from dmkh` với bản kia. Một tên
field trong XML trỏ tới HAI cột database khác nhau tuỳ ngôn ngữ đang xem.

Designer đang cắt tại dấu `%` đầu tiên (`safeId`), nên nó ra `ten_kh` cho MỌI ngôn ngữ — đúng
tình cờ ở bản Việt, sai ở bản Anh. Nay phân giải theo đúng luật, và là phép thay THUẦN không có
ca biên: `ten_kh2%l` ra `ten_kh2` (Việt) và `ten_kh22` (Anh).

**Chỗ lệch đáng ghi**: `DevWorkFlow.Application/Language/InformationSqlBuilder.cs` khai ngược lại
— nó ghi «`ten_kh2%l` KHÔNG thành `ten_kh22`». Bản ở đây theo lời chủ hệ thống; ghi ra để lần sau
không ai «sửa lại cho giống DWF» mà không biết là đang lật một quyết định.

Áp cho `data-field-name` của ô nhập (form lẫn lưới), `id`, và tooltip cột. **Không** áp cho
`data-fbo-column`: nó là khoá tầng edit tra ngược về `<field name="…">` trong XML, phân giải nó
là mọi phép sửa cột tìm không ra field rồi im lặng từ chối. Hai thuộc tính, hai việc.

### Đã sửa — `%l0` là lệnh vị trí, mốc là cột cuối CỦA FILE GRID

`field:%a(x)`, `field:%b(x)`, `field:%l0` — cả ba đều là khai báo vị trí. `%l0` đặt cột sau cột
**cuối cùng khai trong file Grid**: với `Grid/SOTran.f` cột cuối là `ma_nt`, nên `dien_giai:%l0`
xếp `dien_giai` ngay sau `ma_nt`.

Đó KHÔNG phải «nối vào cuối danh sách». Hai cách đọc chỉ trùng nhau khi đúng một cột được chèn
thêm; từ cột thứ hai trở đi là khác. Cột «khai trong file Grid» phân biệt được vì
`mergeGridConfig` đóng dấu nguồn lên mọi cột đến từ `Grid/Config`.

Mốc **tiến dần**: `a:%l0;b:%l0` cho ra `…, ma_nt, a, b`, không phải `…, ma_nt, b, a`. Đứng yên thì
một dãy 11 cột cùng `%l0` — có thật trong `Config/Fields/*.xml` — sẽ hiện theo thứ tự ngược với
thứ tự khai. Và mốc ghim theo ĐỐI TƯỢNG cột chứ không theo chỉ số, nên một luật `%a`/`%b` chạy
trước có dời chính cột mốc thì `%l0` vẫn bám đúng nó.

### Đã sửa — toàn bộ icon toolbar biến mất trong webview

Nguyên nhân không nằm ở CSS mà ở TÊN FILE: `fbo-toolbar.gif` là một file **PNG**. Nó là file duy
nhất trong `base/image` có đuôi nói dối — ba file `.gif` còn lại đúng là GIF thật.

`[Content_Types].xml` khai kiểu theo đuôi, webview phục vụ ảnh với đúng header ấy, nên sprite
được gửi đi là `image/gif` và không vẽ ra gì. Mọi icon đến từ file PNG đặt tên đúng
(`fbo-upload.png`, `fbo-download.png`) hoặc từ data URI của program vẫn hiện bình thường — đó
chính là manh mối, vì nó loại trừ cache, CSP và đường dẫn.

Chỗ khó chịu: **bàn đo không lộ ra**. HTTP thường có content sniffing nên sprite vẫn vẽ đúng ở
`localhost:7391`, đo ra 804×88 và đúng ô. Chỉ webview mới hỏng.

Nay file tên `fbo-toolbar.png`, và bộ đóng gói có thêm chốt chặn: đọc bốn byte đầu của mọi ảnh
trong gói, đuôi không khớp nội dung thì **dừng bản dựng** kèm tên file. Đã thử lại bằng một file
PNG đặt tên `.gif` — bộ đóng gói từ chối.

### Đã sửa — nhãn px của cột lưới trôi dần khỏi cột nó đang đo

Đo trên `Grid/SOTran.f`: nhãn lệch **9px mỗi cột**, tới cột thứ tám là **65px** — nhãn của cột
này rơi vào giữa tên cột kia.

Nhãn đang đặt theo mốc cộng dồn của list px khai trong XML. Đúng với form (`table-layout:fixed`,
bảng rộng đúng tổng px) nhưng sai với lưới: ô lưới rộng `width:Npx` content-box, mà div container
bên trong lại `width:Npx` **cộng** `padding:4px` hai bên, nên ô phình ra N+9.

Nay nhãn của lưới ĐO TỪ Ô THẬT — con số ghi ra vẫn là px khai trong XML, chỉ vị trí mới lấy từ
DOM. Không phá luật «không đo lại từ DOM»: luật ấy có để vạch của form còn tố cáo được khi bảng
không nghe list px; lưới thì không có list px chung nào để mà tố cáo.

Kèm một cái bẫy đã sập: `lay()` tính tỉ lệ zoom bằng `rộng thật / tổng px khai`. Ở lưới hai số ấy
khác nhau ngay cả khi zoom = 1, nên `k` ra 1,078 và mọi nhãn bị co 7% — lệch dần y hệt, chỉ đổi
chiều. Nhãn lưới nay đo tỉ lệ bằng `rect / offsetWidth`, thứ không dính gì tới bề rộng khai.

Đo lại: mọi nhãn dính đúng mép phải cột của nó, lệch **0px** ở 100% và ≤0,02px ở 150%.

### Đã thêm — cột từ CẤU HÌNH ẨN của `Grid/Config`

Hai file KHÔNG được controller nhắc tên nhưng vẫn thêm cột vào nó. Đọc file controller thôi là
thiếu cột, và thiếu im lặng: preview đủ hình dạng, chỉ vắng vài cột mà không có dấu hiệu gì.

- `Grid/Config/Initialize.xml` — `<controller name="SOTran" group="001"/>` → thân `<group id="001">`
- `Grid/Config/Fields/<Tên>.xml` — bản khai riêng cho controller, và mang cả `arrangement`

`Initialize.xml` phải bung entity trước: `<controllers>` của nó gồm toàn `&Control.Field.…;` kéo
từ `Include\Field.ent`. Bộ bung entity sẵn có xử lý được nguyên vẹn — 147 controller, 12 group,
**0 lỗi**.

Đo trên `Grid/SOTran.f`: từ 8 cột lên **11**, ba cột thêm là «Diễn giải», «status», «Trạng thái»
— đúng ba cột màn hình thật có mà file controller không có một chữ nào. Provenance cũng đúng:
Ctrl+bấm vào «Diễn giải» nhảy tới `Include/Voucher.Controller.001`, tức file khai thật, chứ không
phải `Initialize.xml`.

Mỗi mảnh mang `segments` RIÊNG của nó, và dấu nguồn đóng lên **từng field** chứ không suy từ
nguồn của cột: một cột của mảnh A hoàn toàn có thể trỏ vào `<field>` khai trong controller, suy
chéo là quy offset của file này về file kia. Không có `segments` của mảnh thì cột không có
`range` — thà không nhảy được còn hơn nhảy sai. Trùng tên thì bản của controller thắng.

**`arrangement`** — `%a(x)` đứng ngay sau cột x, `%b(x)` ngay trước, `%l0` nối vào cuối. Áp tuần
tự chứ không gom lại sắp một lượt: `b:%l0;c:%a(b)` nghĩa là c đứng sau b *sau khi* b đã dời chỗ.
Một chi tiết dễ sập: tên cột có thể chứa chính ký tự `%` (`ten_kh%l`), nên dấu lệnh phải bóc bằng
neo đầu chuỗi chứ không bằng cách tìm dấu `%` gần nhất. Neo vào cột không tồn tại thì giữ nguyên
chỗ và ghi cảnh báo.

### Đã sửa — lưới KHÔNG khai `type` cũng là màn hình đứng riêng

Lần trước chỉ nhận `Voucher` và `Report`. Nhưng `type` rỗng hoặc không khai là màn hình **danh
mục**, và trong `Grid/` của FBISP24 có **557 file** như thế (`Account.f`,
`AccountDefinition.f`…) — nhiều hơn hẳn 167 file khai `Voucher`. Bỏ sót nhánh này là bỏ sót phần
lớn màn hình danh sách của cả hệ thống. `Inquiry` và `Planned` vẫn để ngoài: chưa đo được runtime
của chúng.

### Đã sửa — ô nhập trong lưới dùng bộ class CỦA LƯỚI, không phải của form

`renderGridHtml` đang dựng ô lưới bằng `renderControl` của form, nên mọi cột ra `.FormInput
.FormTextInput` — bộ class của một cái dialog, không phải của một cái lưới. Nay có hàm riêng
`renderGridControl`, và nó là hàm riêng chứ không phải một cờ vì phần khác nhau quá lớn.

Nguồn: `renderCell` trong `ScriptResource.axd` của runtime, cộng HTML thật của lưới «Hóa đơn bán
hàng». Khuôn runtime chỉ có MỘT dạng — `<input class="CellInput {TextInput|CheckInput} {extra}">`
— và việc đọc nó lôi ra **ba** chỗ bản trước dựng sai, không phải một:

1. **Không có bộ class `Disabled`.** Form đổi hẳn sang `FormInputDisabled`; lưới giữ nguyên
   `CellInput TextInput` và chỉ thêm thuộc tính `readonly` (checkbox thì `disabled`). Cả trang
   runtime không có một `CellInputDisabled` nào.
2. **Không có icon lookup/lịch.** Cả trang runtime có ĐÚNG MỘT `CellDivContainer`, và nó thuộc
   form chứ không thuộc lưới — cột AutoComplete trong lưới là ô chữ trơn, danh sách chọn hiện ra
   bằng menu chuột phải. Ta đang vừa vẽ thêm cái kính lúp, vừa co ô lại 23px để chừa chỗ cho nó.
3. **Không có bề rộng inline.** `.TextInput{width:100%}` cho ô lấp đầy div container, mà div ấy
   đã mang đúng bề rộng cột — ghim thêm px vào ô là hai nguồn cho một con số.

Và lưới KHÔNG có `<select>` lẫn `<textarea>`: runtime dựng MỌI cột bằng `<input>`, kể cả cột khai
`DropDownList` (dropdown là menu chuột phải) hay `rows="3"`. Form thì ngược lại, vẫn dựng cả hai —
có test khẳng định hai đường không lẫn vào nhau, vì sửa cho lưới mà hỏng form là kiểu hỏng không
ai nhìn ra ngay.

`maxlength` theo đúng runtime: có ở cột thường, **bỏ qua** ở cột AutoComplete (ô ấy còn phải chứa
được giá trị người dùng gõ dở trước khi danh sách lọc xong).

Đo lại trên `Grid/BIOADetail.f` (42 ô): mọi ô là `CellInput TextInput` với nền trong suốt,
không viền, cao 13px, font Verdana 11px — đúng rule `.CellInput` của runtime. 26 cột số canh phải
bằng `style="text-align:right;"` inline. Không còn `FormInput` nào, không còn icon lookup nào.
Ô rộng 101px trong container 108px (`padding:4px` mỗi bên + `padding-right:1px` của `.TextInput`),
khớp cách runtime tính.

### Đã sửa — đối chiếu BẰNG MÁY base pack với CSS runtime, theo từng selector

Trước giờ mỗi lần chỉ so một họ rule bằng mắt, và mỗi lần lại lòi ra một chỗ tự chế. Lần này
viết hẳn một phép đối chiếu: bóc mọi rule của `WebResource(2).axd`, bóc mọi rule của cả base
pack, chuẩn hoá selector (`div.TextNew` ≡ `.ToolbarBackgroundImage.TextNew`) rồi so từng khai
báo. Kết quả ban đầu: **63 rule runtime có mà ta không có, 8 rule khai khác nhau**.

Sau khi nhập: còn **5 rule cố ý không chép** (đã ghi lý do ngay trong file) và **7 khác biệt**,
trong đó 4 là nhiễu của bộ đọc (base64 chứa dấu `;`) và 3 là lệch có chủ ý.

Những chỗ SAI THẬT lôi ra được:

- **`.ToolbarTextButton`** sai ba con số: `line-height` 22 thay vì **24** (chữ lệch 2px so với
  icon), màu chữ `#000` thay vì **`#444`**, thiếu `padding-right:6px` (chữ dính mép phải khi bị
  `max-width` cắt) và thiếu `text-overflow:ellipsis` (nhãn dài cụt ngang, không dấu `…`). Thiếu
  luôn `:hover { color:#4682b4 }`.
- **`.ToolbarStyle`** khai lại phần hình học (height/display/width/padding-top) mà runtime đặt
  **inline** — và `renderToolbar` của core cũng đặt inline. Hai nguồn sự thật cho cùng mấy con số.
- **`div.TextPrint`** thiếu hẳn → nút In bản không-group rơi về ô sprite số 0, tức icon «Mới».
- **Cả họ `*Over` và `*Disabled`** thiếu (30 selector) → nút bị vô hiệu hoá hiện icon của lệnh
  khác. Kèm hai nhóm lệch 5px/4px của thanh điều hướng (`-27px`, `-26px`) — số đo được, không
  phải quy luật.

### Đã sửa — nút «Chép dữ liệu» của màn hình danh sách hiện icon «Mới», mất chữ

Cùng LỆNH `Clone` nhưng KHÁC KHOÁ tài nguyên, và đó không phải lỗi chính tả của ai: lưới Detail
trong tab dùng `Toolbar.Clone` («Nhân dòng»), còn màn hình danh sách dùng `Toolbar.Copy` («Chép
dữ liệu»). **109 file** trong FBISP24 dùng khoá này, và ta không có nó.

Chuỗi rơi về nguyên văn `Toolbar.Copy`, mà chuỗi ấy không có dấu `$` nào → nút thành CHỈ ICON,
class `Copy`, và `.Copy` không có ô sprite nào nên nó rơi về ô số 0. Nay ra đúng dòng runtime:
`TextClone ToolbarTextButton` · `max-width:90px` · chữ «Chép dữ liệu».

Rà cả 16 khoá `Toolbar.*` dùng trong corpus: chỉ còn `Aggregate` (68 file) chưa dịch, và nó vẫn
đúng — chuỗi không có `$` nên ra nút chỉ icon, class `Aggregate` có ô sprite thật, tooltip hiện
nguyên văn khoá đúng như luật «thà hiện `Toolbar.Xyz` còn hơn bịa một cái tên».

### Đã sửa — hai nút tải lên / tải xuống hiện icon «Mới»

CSS runtime không khai vị trí cho `ImportData` và `Download`, và sprite chung cũng không có ô
nào cho chúng — nên cả hai rơi về `background-position: 0 0`.

Base pack đã sẵn có `fbo-upload.png` và `fbo-download.png` (22×44 — đúng khuôn hai trạng thái
của một nút 22×22) mà **không rule nào dùng tới**: ảnh đã được trích ra từ trước, chỉ thiếu chỗ
nối. Nay nối theo đúng nghĩa của lệnh, và tooltip runtime xác nhận: `ImportData` = «Lấy dữ liệu
từ tệp...» → tải LÊN; `Download` = «Tải tệp mẫu...» → tải XUỐNG.

### Đã thêm — phần CSS lưới runtime còn thiếu

Chép nốt các class runtime khai mà ta chưa có: `.CellAlignRight` · `.FooterAlignRight` ·
`.RowBottom` · `.HeaderBottom` · `.HiddenBottom` · `.Highlight` · `.SelectCellContainer` ·
`.TextHighlight` · `.Cover` · `.GridHeaderStyle` · `.GridHeaderText` · `.AggregationBackground` ·
`.AggregationLayout` · `.AggregationParentCell` · họ `.GridPager` · và `.GridTabPanel` bản runtime.

Hai chỗ ghi kèm giới hạn còn lại, để lần sửa sau không phải đo lại:

- `.CellInput` / `.TextInput` / `.CheckInput` là ô nhập TRONG LƯỚI, khác hẳn `.FormInput` của
  form (nền trong suốt, không viền, cao 13px). `renderGridHtml` đang dựng ô lưới bằng
  `renderControl` của form nên nó vẫn sinh `.FormInput` — rule chép sẵn, phần sinh HTML thì chưa.
- Họ `.GridPager` là dải «Xem 1-5/5 bản ghi | Làm mới». Designer **không** dựng nó: số bản ghi là
  dữ liệu thật, bịa ra «1-5/5» là nói dối về một thứ người đọc sẽ tin.

Năm rule cố ý KHÔNG chép, ghi lý do ngay trong file: ba mũi tên sắp xếp (ảnh `WebResource.axd`
mà trang đã lưu không tải về → chép vào là ba URL hỏng) và hai rule `position:fixed !important`
của hàng tổng (mẹo ghim do JS runtime điều khiển; không có JS ấy thì nó gỡ ô ra khỏi layout).

Một chỗ **cố ý lệch runtime**, cũng ghi ngay trong file: runtime khai
`.FooterStyle{overflow:scroll}` nên hàng tổng luôn có thanh cuộn ngang riêng — đúng cái thanh
thứ hai đã bị báo là dư. Hàng tổng của ta rỗng, không có gì để cuộn tới, mà thanh ấy vẫn ăn 15px
và nằm chồng ngay dưới thanh của thân lưới.

### Đã sửa — lưới danh sách đứng riêng rộng bằng khung nhìn, không bằng tổng px cột

`<grid type="Voucher">` và `type="Report"` là **màn hình danh sách** — «Hóa đơn bán hàng: thêm,
sửa, xóa…» — chứ không phải một cái dialog. Runtime cho chúng chiếm hết bề ngang cửa sổ rồi cuộn
ngang phần cột thừa; chúng không có bề rộng cố định nào để mà đối chiếu.

Designer thì đang ghim `width: tổng px` cho mọi lưới đứng riêng, giống hệt lưới Detail. Một danh
sách 15 cột vì thế kéo cả trang rộng ra hàng nghìn px, và mọi thứ khác trên trang dài theo.

Nay lưới đứng riêng thuộc hai kiểu ấy rộng đúng bằng vùng hiển thị, và cuộn ngang trong thân
lưới. Đo trên `Grid/AITran.f` (`type="Voucher"`, tổng cột 1224px): panel bám khung nhìn ở cả
1248px lẫn 948px, trang không tràn ngang, và header/footer trượt đúng theo `scrollLeft` của thân.

Phân biệt bằng `@type`, đúng như runtime phân biệt — không phải bằng «có được nhúng hay không»:

| `@type` | số lượng trong FBISP24 | cách vẽ |
|---|---|---|
| `Detail` | 416 | nhúng trong tab; bề rộng do ô chứa quyết |
| `Voucher` · `Report` | 167 · 652 | màn hình danh sách đứng riêng; rộng bằng khung nhìn |
| `Inquiry` · `Planned` | 207 · 1 | **giữ nguyên lối cũ**, ghim theo tổng px |

`Inquiry` và `Planned` cố ý không có trong danh sách: chúng cũng có thể là màn hình đứng riêng,
nhưng chưa đo được runtime của chúng, và thêm vào theo cảm giác là quay lại đúng thói tự chế đã
phải dọn ở `fbo-grid.css`.

Một chi tiết dễ mất công: `width:100%` trên panel một mình KHÔNG nới được gì. `#fbo-stage` (và
`#fbo-zoom`) là `inline-block` để thước blueprint không dài hơn cái form nó đang đo, mà
`inline-block` co theo nội dung — phần trăm sẽ quy về chính bề rộng co ấy. Nên core gắn thêm dấu
`GridFitWidth` và trả cờ `fitWidth`, webview lật hai lớp bọc sang `block` bằng một class trên
`<body>`. Không lật vĩnh viễn: form vẫn cần ôm sát.

Đã kiểm cả hai chiều không đụng nhau: `Detail` đứng riêng vẫn ghim `width:3896px` như cũ, và lưới
nhúng vẫn `max-width:100%` kể cả khi bị khai `type="Voucher"` — bề rộng của lưới nhúng do ô chứa
quyết, cho nó rộng bằng khung nhìn là nó thò ra ngoài tab.

### Đã sửa — pattern LAI: gộp/tách bị chặn khi entity nằm giữa pattern

Hàng thật trong corpus:

```xml
<item value="110&ExtraFields.Master.View.Split;-----101-: [ong_ba].Label, …"/>
```

Pattern GHÉP từ nhiều nguồn: ba ký tự đầu ở controller, mấy ký tự giữa đến từ khai báo
`&ExtraFields.Master.View.Split;` ở một file khác, rồi lại quay về controller. Luật cũ («cả hàng
phải khớp nguyên văn», rồi «pattern phải khớp nguyên văn») chặn sạch mọi hàng như thế, dù phép
sửa chỉ đổi ĐÚNG MỘT ký tự.

Cách làm mới không cần biết hàng có entity hay không:

1. Tính pattern mới bằng chính `setSpan`/`setStart` trên bản đã bung — đó là bản đúng để suy
   luận về cột.
2. So với pattern cũ, cắt bỏ phần đầu và phần đuôi giống hệt nhau → còn lại đúng đoạn đã đổi.
   Gộp/tách chỉ sửa `0`/`-` nên đoạn ấy thường dài một ký tự.
3. Quy đoạn ấy từ toạ độ clearText về toạ độ file nguồn qua `segments`.

Nhờ bước 3, đoạn nằm trong `&…;` thì splice rơi thẳng vào khai báo entity ở đúng file khai nó:
`110&Split;` với `Split = "10"` mà tách một ô thì cái được ghi là `Split = "1-"`, còn ba ký tự
`110` trong controller không bị đụng tới — và tham chiếu `&Split;` còn nguyên. Gộp thì ngược
lại: ký tự cần đổi thuộc controller nên splice rơi vào `<item>`, khai báo entity đứng yên. Cả
hai chiều đều có test đọc-lại-sau-khi-ghi.

Kèm theo, `edit-host` hỏi core file nào phải đọc (`rowEditTargetFile`) thay vì mặc định lấy file
chứa hàng — đọc nhầm file là phép so nguyên văn thấy chữ không khớp rồi từ chối, đúng lối hỏng
mà tầng chiều cao đã mắc một lần.

**MỘT ĐOẠN, MỘT FILE.** Đoạn đã đổi vắt qua ranh giới hai nguồn thì TỪ CHỐI kèm lý do: hai splice
ở hai chỗ trong cùng một lần hoàn tác là thứ tầng vỏ chưa làm được, và ghi một nửa còn tệ hơn
không ghi.

Phụ phẩm: splice của gộp/tách giờ chỉ trùm MẤY KÝ TỰ ĐÃ ĐỔI thay vì cả pattern — ít byte bị
đụng hơn thì ít cách hỏng hơn.

### Đã thêm — kéo cạnh TRÁI, và gộp/tách chỉ khi ô đang được chọn

Hai cạnh đổi hai đại lượng khác nhau, và đây là chỗ dễ nhầm nhất:

- cạnh **phải** → `span` (cột bắt đầu đứng yên, ô dài/ngắn về bên phải) — `setSpan`, đã có
- cạnh **trái** → `col` (cột kết thúc đứng yên, chính ký tự `1` trong pattern dời chỗ) — `setStart`, mới

Quy cạnh trái về «kéo cạnh phải của ô liền trước» thì hỏng ngay ca thường gặp nhất: ô liền trước
gần như luôn là ô TRỐNG, mà ô trống thì không có span để đổi — trong khi nở sang trái vào chỗ
trống lại đúng là việc người ta muốn làm nhất khi túm cạnh trái. Nên `setStart` là phép riêng,
đối xứng với `setSpan` và mang cùng một luật: nở ra chỉ ăn cột trống, đụng ô có control thì từ
chối chứ không nuốt hộ.

Và cả hai cạnh chỉ bắt kéo trên ô **đang được chọn**. Trước đây mọi ô đều bắt, nên chỉ rê chuột
ngang qua form là dễ túm nhầm cạnh của một ô mình không định đụng — ở form dày đặc thì các cạnh
chỉ cách nhau vài px. Hai vạch chỉ chỗ (`bp-grip`) nay vẽ ở cả hai cạnh, và điều kiện vẽ trùng
khít điều kiện kéo được.

Bóng mờ lúc kéo cũng sửa theo: nó bám MỐC CỘT chứ không bám con trỏ. Bóng chạy mượt theo chuột
rồi nhảy về nấc lúc thả tay là hứa một chuyện rồi làm một chuyện khác.

### Đã đổi — thanh lệnh của ô chỉ còn thêm và xoá

Bỏ hai nút `⊣` / `⊢`. Gộp/tách là phép sửa LIÊN TỤC — người ta kéo tới khi vừa mắt, chứ không
bấm từng nấc; mỗi cú bấm lại đi trọn một vòng ghi file rồi vẽ lại. Bề mặt của nó là hai cạnh ô.
Thanh lệnh giữ đúng những phép RỜI RẠC: `+← +→ +↑ +↓` và `×`.

### Đã sửa — mỏ neo và vạch chia hiện con trỏ `move`

Chúng không co giãn cái gì — chúng được DỜI sang một cột khác. `col-resize` (mũi tên hai chiều)
hứa một phép co giãn, và người dùng đi tìm cái mép đang bị kéo ra. Phép kéo cũng dùng lớp riêng
(`fbo-dragging-move`) thay vì dùng chung lớp của gộp/tách.

### Đã sửa — số px của cột bị mờ trên nền xanh

Dải px là thứ đọc nhiều nhất trên lớp blueprint, nhưng nó đang thừa kế cỡ 10px dành cho mấy nhãn
phụ, và chữ cam mảnh trên nền xanh nhạt của panel tab thì tương phản thấp. Nay 12px đậm, màu sẫm
hơn, kèm viền sáng quanh glyph để tách khỏi nền — bằng `text-shadow` chứ không bằng một mảng nền
đè lên form. Dải px trong lưới lên 10px theo.

### Đã sửa — provenance của entity inline trỏ vào `<!ENTITY`, không vào giá trị

Gốc của một lỗi lan rất xa, và lộ ra qua một triệu chứng nghe chẳng liên quan: kéo chiều cao tab
của `Dir/Customer.xml` thì nhận «khai báo height trong file khác bản đã bung — sửa tại file khai
nó», cho một file chẳng có gì sai.

`collect` ghi `valueStart: m.index` — offset của **cả thẻ khai** — nên mọi đoạn văn bản do một
entity inline bung ra đều khai nguồn là ba ký tự `<!E`. Hai hậu quả:

- Ctrl+bấm một hàng viết bằng `&k;` nhảy vào giữa khối DOCTYPE, không tới khai báo thật.
- Mọi phép ghi ngược tự từ chối. `planNumericAttr` so nguyên văn dải sắp ghi đè với giá trị đang
  cầm; dải trỏ vào `<!E` thì không đời nào khớp `302`.

Ca thật: `Dir/Customer.xml` viết `<view height="&BI.Dir.Height;">`, và
`<!ENTITY BI.Dir.Height "302">` nằm ở `Include/BIMode.Customer`.

Nay đo đúng đầu giá trị: nháy ĐÓNG là lần xuất hiện cuối của ký tự nháy trong cả khớp (giá trị
không thể chứa chính ký tự nháy bao nó), lùi lại đúng độ dài giá trị. Không phụ thuộc khoảng
trắng hay `\s*>` ở đuôi, nên nháy đơn và giá trị chứa dấu `>` đều đúng.

Cùng lúc lộ ra một lỗi offset thứ hai đã nằm đó từ đầu: `collect` gần như không bao giờ nhận cả
file — nó nhận **lát** internal subset, hoặc giá trị của một parameter entity — nên `m.index` là
offset trong lát chứ không trong file. Mọi entity khai ở internal subset trỏ lệch đúng bằng vị
trí của `<!DOCTYPE`. Nay `collect` nhận thêm `base`.

### Đã sửa — sửa thuộc tính thì ghi vào FILE KHAI NÓ

Hệ quả trực tiếp của việc trên, và là nửa còn lại của cùng một lỗi: `edit-host` luôn truyền văn
bản của **file đang mở** cho các hàm lập kế hoạch, dù `heightRange` / `rowsRange` /
`anchorRange` có thể trỏ sang một Include. Hai hệ toạ độ khác nhau, phép so nguyên văn thấy chữ
không khớp và từ chối.

Phép so ấy không được bỏ — nó là thứ duy nhất chặn ghi đè nhầm chỗ khi offset lệch. Cái phải sửa
là đưa cho nó đúng văn bản. `planInOwner` giờ mở file sở hữu, lập kế hoạch trên văn bản của
chính file đó, rồi ghi vào đó. Áp cho cả ba: `view@height`, `field@rows`, và `anchor`/`split`.

Và khi file sở hữu khác file đang mở thì **hỏi lại** — sửa `<!ENTITY BI.Dir.Height>` là đổi chiều
cao cho mọi controller dùng entity đó, không riêng màn hình đang nhìn. Dùng lại đúng lời hỏi đã
có cho hàng đến từ Include.

### Đã sửa — hàng tổng của lưới hiện thành một băng xám có vạch chia cột

`fbo-grid.css` mở đầu bằng «Adapt từ …», và chữ *adapt* đó đúng theo nghĩa xấu: nó gộp thêm hai
selector **không có ở runtime** — `.GridTable th` và `.GridTable td` — rồi treo vào đấy một tá
thuộc tính tự nghĩ ra. Vì `.GridTable td` (class + type, đặc hiệu 0-1-1) thắng
`.HeaderCellDefault` và `.FooterCellDefault` (class trần, 0-1-0), nó đè lên cả hai:

| tự thêm | runtime thật | hậu quả |
|---|---|---|
| `.FooterCellDefault` viền trái/phải `#d2d6d9` | viền `transparent` | băng xám có vạch chia cột dưới đáy lưới |
| `.FooterStyle` nền `#f7f9fb` + gạch dưới | `border:0`, không nền | thêm một dải màu không có thật |
| `.GridFooter td` gạch trên `#d2d6d9` | `border:0; background:transparent` | thêm một nét ngang |
| `.SplitStyle` nền `#e8eaed` + viền hai bên | `border:0` + một ảnh tay nắm | thêm một băng xám nữa |
| `.GridTable td/th` padding + `box-sizing` | runtime đặt padding lên div container | ô tổng 109px trong khi ô dữ liệu cùng cột 101 |
| `.GridTable td` `height:22px` | `.HeaderCellDefault{height:30px}` | hàng tiêu đề lưới cao 22 thay vì 30 |

Nay cả nhóm là bản chép từ runtime. Viền `transparent` chứ không `border:0` là chủ ý của
runtime: ô tổng vẫn chiếm đúng bề rộng ô dữ liệu, chỉ không vẽ nét.

Cũng phát hiện hai nét biên trái/phải (thứ của designer, runtime không có) đang treo trên
`.divGrid`. Lưới gồm ba div anh em cuộn cùng nhau, mỗi div một bảng riêng — treo viền lên một
trong ba thì bảng của div ấy bị đẩy vào 1px còn hai bảng kia thì không. Đo được: hàng tổng và
hàng tiêu đề lệch khỏi hàng dữ liệu đúng 1px. Nay viền nằm ở khung ngoài, cả ba bảng cùng mốc.

Đo lại sau khi sửa (`Dir/SVTran.xml`): ba bảng cùng bắt đầu tại x=34, ô tiêu đề/dữ liệu/tổng
cùng rộng 109px, lệch trái 0px, viền hàng tổng `rgba(0,0,0,0)`.

`.SplitStyle` của runtime còn có một ảnh tay nắm đặt tại `25px 0`; ảnh đó chưa trích ra được nên
hiện chỉ có phần hình học. Thiếu một cái tay nắm thì nhìn ra ngay; tự vẽ một băng xám thay vào
chỗ nó thì không.

### Đã sửa — nút toolbar của khách: icon sai đè lên chữ

`.ToolbarBackgroundImage` gắn sprite cho MỌI nút mang class đó, mặc định cắt tại `0 0` — ô đầu
tiên của sprite, tức icon lệnh «Mới». Nút riêng của khách không có ô nào trong sprite, nên nó
hiện icon «Mới» ở bên trái, cộng thêm `text-indent:22px` chừa chỗ cho một icon không tồn tại.

Runtime không gặp chuyện này vì ở đó nút của khách luôn có `<css>` riêng khai icon. Ca thật:
`Grid/CustomerPurchasingDetail.f` khai `<button command="PurOrgDeclaration">` mà bản chuẩn `.f`
không kèm `<css>` nào.

Luật mới: có ô sprite trong base pack **hoặc** có `<css>` của program khai class đó → giữ nút
có icon; không có gì cả → nút **chỉ chữ** (bỏ `ToolbarBackgroundImage`, bỏ luôn phần indent).
Thà thiếu icon còn hơn hiện icon của lệnh khác. `<css>` của controller nay được nối xuống tới
hàm dựng toolbar, kể cả cho lưới nhúng — nút có thể được khai kiểu ở lưới hoặc ở controller chủ.

### Đã sửa — một tab bị dựng hai lần

`Dir/SVTran.xml` khai `<category index="8">`, `"14"`, `"15"` mỗi cái **hai lần** — controller
khai một lần, rồi một Include kéo vào lần nữa. Runtime tra `<category>` theo index như tra từ
điển nên lần hai chỉ ghi đè lần một. Ta thì đẩy từng khai báo thành một region, nên ra hai tab
«Xác thực» cạnh nhau **dùng chung một `id`** — và trùng id thì bấm tab này mở luôn tab kia, cả
hai cùng nhận `DwfActive`.

Nay mỗi index đúng một tab, lần khai đầu thắng (giữ thứ tự đọc trong file), và lần bị bỏ được
nêu trong cảnh báo — hai lần khai có thể mang `columns` khác nhau.

### Đã đổi — render CỤC BỘ khi gộp/tách ô

Gộp/tách đổi đúng phần pattern của MỘT `<item value>`, nên đúng một `<tr>` đổi theo. Dựng lại cả
form cho chuyện đó là ném đi vị trí cuộn, tab đang mở, ô đang chọn và trạng thái cuộn ngang của
mọi lưới nhúng — tất cả đều là thứ người dùng vừa đặt vào đúng chỗ, và đúng lúc họ cần giữ nhất.

Chiều đi của dữ liệu **không đổi**: vẫn là văn bản → core dựng lại model → HTML → webview. Cái
rút ngắn chỉ là phần HTML gửi đi (`patchRow` thay cho `render`). Cho webview tự sửa DOM rồi báo
sau mới là chỗ designer và file XML bắt đầu nói hai chuyện khác nhau, và đó vẫn cấm.

Bản vá đi qua `renderRowHtml`, tức **đúng hàm** đã dựng bảng đầy đủ — hai đường sinh HTML song
song thì trước sau gì cũng trôi khỏi nhau, và triệu chứng sẽ là «gộp ô xong nhìn khác lúc mở lại
file». Có test khẳng định chuỗi một hàng nằm nguyên vẹn trong HTML của cả form.

Mọi phép sửa khác vẫn vẽ lại toàn bộ, vì chúng đổi nhiều hơn một hàng: thêm/xoá control (số hàng
đổi, `data-fbo-item` phía sau chạy hết), chiều cao (panel đổi, lưới bên trong tính lại), bề rộng
(list px của cả vùng đổi). Sửa bị từ chối thì cờ được dọn ngay — không thì lần render sau, rất
có thể do người dùng gõ tay vào XML, bị gửi đi dưới dạng bản vá một hàng và nuốt mất phần còn lại.

### Đã sửa — kéo chiều cao tab: không có dấu hiệu, và trông như đang kéo footer của lưới

Chỗ kéo trước đây là «dải 6px sát mép dưới panel», không vẽ ra gì cả. Mà mép dưới panel của một
tab có lưới lại nằm ngay dưới dải footer của lưới, nên thao tác duy nhất tìm được bằng mắt là
«kéo cái footer lên» — trông như đang kéo lưới, trong khi con số bị sửa là chiều cao TAB.

Nay dải ấy được vẽ ra: một thanh 6px màu cam ở đáy tab đang mở, `cursor: row-resize`, tooltip nói
thẳng nó sửa thuộc tính nào. Mỗi tab một tay cầm riêng, và tooltip phân biệt hai nguồn con số —
`rows của [x]` (riêng tab đó, tab có lưới) so với `view@height` (dùng chung cho mọi tab không có
lưới) — vì kéo nhầm loại thứ hai là mọi tab khác cùng co lại theo. Hình thức lấy theo bản DWF
(`BlueprintTheme.Splitter`) để hai công cụ nhìn giống nhau ở cùng một thao tác.

### Đã sửa — hàng tổng và cột STT của lưới: chọn được nhưng bấm vào không ra gì

Runtime **có** hàng tổng thật (đo trên trang đã lưu: một `FooterCellDefault` cho mỗi cột,
`AggregationLayout`, cao 22px), nên bỏ nó đi là lưới hụt 22px và mọi phép tính chiều cao `rows`
lệch theo. Cái sai không phải sự tồn tại của nó, mà là ta gắn `data-fbo-col` / `data-fbo-column`
lên từng ô: `wireSelection` bám vào, và người dùng bấm được một ô rỗng — có viền chọn, không có
thanh lệnh, và không nhảy tới XML được (hàng tổng không có `data-fbo-src-start` để mà nhảy).

Một vùng trông như bấm được mà bấm không ra gì thì tệ hơn một vùng rõ ràng là trang trí. Nay
hàng tổng và cột STT giữ nguyên hình học nhưng không mang `data-fbo-*` nào — chúng là chrome do
runtime tự chèn, không có `<field>` nào khai để mà sửa.

### Đã thêm lại — mỏ neo `view@anchor` và vạch chia `view@split`

Cả hai là CHỈ SỐ CỘT tính từ 1, không phải px, và không đổi cách bảng được vẽ — nên nếu blueprint
không vẽ thì chúng vô hình hoàn toàn: phải mở XML mới biết form có khai hay không.

Cách vẽ và cả hai công thức chỉ số chép từ bản DWF (`DesignWebViewHost.xaml.cs`,
`splitAndAnchor`), kể cả chỗ hai bên đánh chỉ số **lệch nhau một nấc**:

- `split` → vạch đỏ tại `offsets[split]`, tức ranh giới nằm SAU cột đó
- `anchor` → mỏ neo `⚓` tại `offsets[anchor] − 14`, tức nép vào mép phải của CHÍNH cột đó

Đọc lướt thì trông như cùng một phép tính, nhưng một cái nói về ranh giới còn cái kia nói về bản
thân cột — lấy nhầm là marker lệch đúng một cột, sai kiểu nhìn không ra. Đo lại trên
`Dir/AITran.xml` (`anchor="9" split="10"`): vạch chia rơi đúng mép trái thật của cột 11, sai
lệch 0px.

Cả hai **kéo được**, và thả ra thì ghi thẳng vào file. Kéo ra CHỈ SỐ CỘT chứ không ra px: hai
thuộc tính này là số thứ tự cột, nên con trỏ nằm đâu thì bám vào mốc cột gần nhất ở đó — cho kéo
tự do theo px là hứa một thứ định dạng không có.

Ghi vào ĐÚNG thẻ đã khai vùng đó, và đây là chỗ dễ sai nhất: dải header lấy hai con số từ
`<view>`, còn mỗi tab lấy từ `<category index="n">` của chính nó. Ghi nhầm sang `<view>` khi
người dùng kéo marker trong một tab là đổi anchor của cả form, và mọi tab khác lệch theo mà không
ai chạm vào chúng. `planRegionMetadata` chọn thẻ từ `region.writeback` do core gắn sẵn, nên
webview chỉ gửi id vùng chứ không tự đoán. `0` là giá trị hợp lệ và có nghĩa «không neo / không
chia» — runtime coi `0` như chưa khai; chỉ số âm và số vượt quá số cột của vùng mới bị từ chối,
vì một marker nằm ngoài bảng thì vừa không vẽ ra được vừa không kéo lại được bằng chuột.

Vạch chia vẽ 2px nhưng vùng bắt chuột rộng 7px (cùng con số DWF dùng): kéo một đường 2px bằng
chuột là việc gần như không làm được.

### Đã sửa — bật blueprint làm nhạt chữ tiêu đề lưới

Dải px của lưới đang tô một mảng trắng 72% lên mép dưới ô tiêu đề, và mảng ấy phủ lên phần chân
chữ của chính tên cột. Blueprint thì không được đổi màu chữ của form.

Bỏ hẳn nền, hạ dải xuống 9px, và tách con số khỏi nền bằng viền sáng quanh glyph
(`text-shadow`) thay vì bằng một mảng nền — cách đó chỉ đụng tới con số của chính nó.

### Đã đổi — ẩn ô check Debug

Nó là công cụ chẩn đoán tài nguyên (stylesheet/ảnh), không phải thứ dùng hằng ngày. Phần máy móc
giữ nguyên, chỉ không hiện ra. Lưu ý cho lần sau: `hidden` một mình không đủ — `.fbo-toggle` khai
`display:flex`, và class thì đặc hiệu hơn rule `[hidden]{display:none}` của trình duyệt, nên phải
khai `.fbo-toggle[hidden]{display:none}`.

### Đã sửa — nút toolbar group: sai icon, sai bề rộng, mất mũi tên

Triệu chứng: nút «Lấy dữ liệu» hiện icon của nút «Sửa». Ba nguyên nhân chồng lên nhau, và cả ba
chỉ lộ ra khi đọc `renderToolbarButton` trong `ScriptResource.axd` của runtime:

- `<menuItems>` bị bỏ qua hoàn toàn. Runtime lấy đúng sự có mặt của nó để quyết nút là **group**,
  và group đổi tên class từ `TextRetrieve` sang `TextGroupRetrieve` — hai ô sprite khác nhau.
  `TextRetrieve` thì CSS viết tay của base pack lại gán vào ô của `Edit`, nên ra cái bút chì.
- Nhãn bị chẻ theo `$$`, nhưng runtime chẻ theo **một** dấu `$`: `tooltip$nhãn$bềRộng`. Cả ba
  dạng đều có thật trong FBISP24 — `Bỏ duyệt$$75`, `Chọn kỳ$Chọn...`, `Đồ thị$` — và dạng giữa
  làm chữ `$` lọt thẳng lên mặt nút. Hệ quả kéo theo: title KHÔNG có `$` nào nghĩa là nút **chỉ
  icon** (`Tải tệp mẫu...`, `Khóa cột`), thứ trước đây phải liệt kê tay mới biết.
- `.ToolbarWidthButton{max-width:60px}` thiếu hẳn trong base pack, nên nút không khai bề rộng
  thì giãn hết cỡ theo chữ.

Nay `<div>` sinh ra trùng **nguyên văn** dòng của runtime (trừ `id` và hai handler
`onmouseover/onmouseout` — thứ designer cố ý không dựng), và có test so cả dòng.

Cùng gốc, sửa luôn: mọi rule `*OverGreen` viết tay dùng `background-position` đầy đủ nên **ghi
đè cả trục X** — rê chuột vào bất kỳ nút nào trong họ ấy là icon nhảy sang lệnh khác. Runtime chỉ
dịch trục Y (`background-position-y: -22px` / `-66px`); nay chép đúng hai rule đó. Khối sprite
viết tay ở giữa file bị gỡ hẳn: runtime chỉ có **một** rule gắn ảnh cho mọi nút, phần vị trí để
khối nhập từ runtime lo.

`<menuItems>` giờ vẽ ra danh sách xổ khi rê chuột (`.ToolbarGroupMenu` đã có sẵn trong CSS mà
chưa ai dùng) — với một designer, «nút này lấy được số liệu từ những nguồn nào» mới là thông tin.

### Đã sửa — lưới: ba thanh cuộn chồng nhau, và ba hàng mẫu rỗng

Một dãy cột mà có ba thanh cuộn ngang xếp chồng, kéo cái này thì cái kia đứng yên. Hai trong ba
là tai nạn:

- `divFooter` khai `overflow-y:hidden` mà bỏ trống trục x. Theo CSS, một trục khác `visible` thì
  trục còn lại **tự tính thành `auto`** — nó mọc ra một thanh cuộn không ai gọi.
- panel của tab cũng `overflow:auto`, trong khi lưới nhúng đã tự giới hạn `max-width:100%` rồi tự
  cho `divGrid` cuộn phần cột thừa.

Nay mỗi tab nhiều nhất **một** thanh, và chỉ hiện khi cột chưa đủ chỗ: tab có lưới thì thanh ấy
thuộc về `divGrid` (panel `overflow-x:hidden`); tab không có lưới thì thuộc về panel, vì bảng của
vùng rộng đúng bằng `<category columns>` và có thể rộng hơn form.

Hàng mẫu rút từ 3 xuống **1**. Hàng mẫu trả lời đúng một câu hỏi — «cột này là ô nhập kiểu gì» —
và hàng đầu đã trả lời xong; hai hàng sau là bản sao rỗng chiếm mất chiều cao phần cuộn và đẩy
footer khuất xuống dưới trong tab đã bị ghim chiều cao.

### Đã sửa — chọn một ô là mất luôn khả năng gộp/tách

Báo cáo là «khi focus thì chỉ còn add + del; merge + split chỉ chạy khi chưa focus». Nguyên nhân
không nằm ở logic kéo mà ở hình học: nút `+` bên phải là hình tròn 16px đặt tại `left + w`, tức
**đúng giữa cạnh phải** — chồng khít lên dải 6px bắt kéo của `wireResize`. Chọn ô xong là cái nút
chiếm luôn chỗ đó và chuột không bao giờ chạm tới `#fbo-form` nữa.

Bố cục mới có một luật: **không nút nào được đặt trên cạnh ô**. Năm nút rải quanh bốn cạnh gom
thành một thanh lệnh nổi phía trên ô, chia ba nhóm ngăn bằng vạch dọc — chèn (`+← +→ +↑ +↓`),
bề rộng (`⊣` tách · `⊢` gộp), xoá (`×`). Bốn cạnh trả lại hết cho thao tác kéo, và cạnh phải có
thêm một vạch chỉ chỗ (`pointer-events:none`, để nó không cướp đúng thao tác nó đang quảng cáo).

Gộp/tách nay có **nút** chứ không chỉ có kéo: kéo cạnh là thao tác phải đoán ra mới biết là có.
Kéo vẫn giữ nguyên cho ai muốn nhắm thẳng tới một cột xa. Nút mờ đi thay vì biến mất khi không
dùng được (`⊣` ở span 1, `×` trên ô trống) — thanh lệnh mà đổi số nút theo từng ô thì vị trí các
nút còn lại nhảy. Tay cầm của cột lưới sửa y hệt, cùng lý do.

### Đã đổi — bấm ô không còn tự nhảy tới XML

Bấm = **chọn**. Nhảy tới khai báo cần **Ctrl+bấm** hoặc **bấm đúp** (thêm `Alt` để ở lại file
đang mở thay vì mở file Include).

Chọn là thao tác dùng liên tục — chọn để xem thông số, để mở thanh lệnh, để nhắm trước khi
gộp/tách. Nhảy tới nguồn thì có thể **mở một file khác** và cuốn con trỏ trong editor đi chỗ
khác. Buộc hai thứ vào một cú bấm nghĩa là mỗi lần muốn chọn lại phải trả giá bằng một lần editor
nhảy, và không có cách nào chọn mà không nhảy.

### Đã thêm lại — dải px từng cột, và gạch chéo ô chưa dùng

Hai thứ này từng bị gỡ cùng lúc với khung ô, vì cả cụm phủ kín form. Nay trả lại đúng phần có
ích, bỏ phần gây nhiễu:

- **Dải px**: con số khai trong XML viết ngay trên đầu cột của nó, cho cả form lẫn lưới. Số là px
  KHAI TRONG XML, không nhân theo nút Tỉ lệ — chỉ vị trí mới nhân.
- **Gạch chéo**: chỉ ô **trống**, không phải mọi ô. Ô đã có control thì mép của nó nhìn thấy được
  rồi; thứ không nhìn thấy được là một ô trống lọt giữa hai control, vì nó trông hệt khoảng đệm.

**Lưới không còn vạch cam.** Khác biệt này theo đúng chỗ con số nằm trong XML: form khai một list
px **chung**, ô bám vào mốc cộng dồn bằng `colspan`, nên vạch dọc là cách duy nhất thấy được ô bắt
đầu ở mốc nào — và vạch lệch mép ô là một tín hiệu thật. Lưới thì mỗi cột mang bề rộng **riêng** ở
`<field width="N">`, không có mốc chung nào để so; vạch ở đó chỉ vẽ lại mép ô mà mắt đã thấy, mà
lại cắt ngang cả tiêu đề lẫn hàng mẫu. Cái lưới cần là con số, và dải px lo phần đó.

Dải px của lưới nằm ở mép dưới hàng tiêu đề chứ không phía trên bảng: phía trên bảng lưới là dải
nút toolbar cao 26px và kín đặc. Nó cũng tự **cắt theo khung lưới** — lớp blueprint là
`position:absolute` nên không khung nào cắt hộ, và bảng tiêu đề của lưới 42 cột thò hẳn ra ngoài
vùng cuộn. Đo lại trên `Dir/BIOATran.f` (lưới 3938px trong tab 767px): ở mọi vị trí cuộn chỉ 8–11
nhãn được vẽ, không nhãn nào tràn ra ngoài lưới.

### Đã sửa — icon Lookup hiện sai hình (không phải cache)

Triệu chứng nhìn ra là "trình duyệt giữ hình cũ". Nguyên nhân thật thì khác hẳn: `adornment()`
trỏ `src` của thẻ `<img>` vào `<program>\Images\Lookup.png`.

- `Images\Lookup.png` là **sprite 22×44 hai trạng thái**, bị nén vào hộp 15×11 rồi **vẽ đè**
  lên sprite thật mà `.CellImage` đang vẽ làm nền.
- `Images\Calendar.png` **không tồn tại** trong program, nên ô lịch ra thẳng ảnh vỡ.

Runtime không làm thế: icon là **nền** (`.CellImage` lấy sprite `fbo-cell-icons.gif`,
`.CellImgLookup` dịch `-16px 0` và ghim hộp 15×11), còn `src` chỉ là ảnh 1×1 trong suốt. Nay
`src` là data URI 1×1 — không phụ thuộc file nào nên không hỏng được và cũng không cache được.
Tham số `imageBase` đi theo đó bị gỡ khỏi cả `core` lẫn `extension`.

Bài học ghi lại kẻo lặp: `<program>\Images` là thư mục khách tự bỏ ảnh vào. Tên file trùng với
tên icon của runtime **không có nghĩa là cùng một thứ**.

### Đã sửa — webview giữ CSS và ảnh cũ trong cache

Có thật, chỉ không phải nguyên nhân của cái icon trên. URI do `asWebviewUri` sinh ra cố định
theo đường dẫn, nên sửa CSS rồi cài lại `.vsix` thì webview vẫn dùng bản cũ.

- Mọi `<link>` / `<script>` giờ mang `?v=<mtime>` — đổi khi và chỉ khi file đổi.
- **Base pack nhúng thẳng vào trang**, với mọi `url()` viết lại thành URI có dấu phiên bản.
  `?v=` trên thẻ `<link>` chỉ ép tải lại file CSS; ảnh mà CSS trỏ tới bằng đường dẫn tương đối
  thì trình duyệt tự ghép URL không query nên vẫn lấy từ cache — sprite icon đổi mà vẫn thấy
  hình cũ là đúng chỗ này. Chỉ làm với base pack (nhỏ, của ta, biết chắc mỗi `url()` đi đâu);
  CSS của program giữ `<link>`.

### Đã thêm — debug mode

Bật bằng ô **Debug** trên thanh trên. Nó trả lời đúng câu hỏi đã phải đoán ở trên — *icon sai
là do trỏ nhầm file hay do cache?*

- **Bảng Stylesheet**: từng file, nhúng thẳng hay qua URL nào, nạp được hay không.
- **Bảng Ảnh đang dùng**: mọi URL ảnh thật sự đang vẽ (cả `src` lẫn `background-image` của mọi
  phần tử), kèm **cỡ file thật** (tải riêng để đo, vì `<img>` bị CSS ép cỡ nên nhìn không ra),
  cỡ ô đang vẽ, và nhận xét. Ảnh nền thì hiện `cắt tại <position> · <repeat>` — với sprite,
  đó mới là thông tin cần; ảnh qua `src` lệch cỡ thì báo thẳng «bị CSS ép cỡ».
- **Bảng Ô đang chọn**: token, cột/trải/px, class, file gốc, offset, HTML nguyên văn.
- Nút **Nạp lại tài nguyên**: dựng lại shell với dấu phiên bản mới trên mọi URL — lối thoát
  khi nghi cache mà `mtime` không đổi (chép file bằng công cụ giữ nguyên timestamp).

### Đã thêm — nút Tỉ lệ, và câu trả lời cho "sao nhìn nhỏ hơn trên web"

Form dựng đúng **573px CSS**, bằng đúng con số runtime đặt inline — đã đo cả hai bên. CSS
runtime cũng không có `zoom`, không có `<meta viewport>`, không có rule `body` nào đổi cỡ chữ.
Nên chênh lệch không nằm ở layout mà ở **tỉ lệ vẽ một px CSS**:

- Cursor/VS Code áp `window.zoomLevel` lên cả webview — `Ctrl -` để nhét vừa hai cột thì form
  thu nhỏ theo, cùng lúc với chữ trong editor.
- Trình duyệt có mức zoom riêng, nhớ theo từng site.
- Windows scaling (125%/150%) áp cho cả hai, nhưng có thể khác nhau nếu hai cửa sổ nằm ở hai
  màn hình có tỉ lệ khác nhau.

Hai thứ được thêm để chuyện này đo được thay vì cảm giác:

- **Nút Tỉ lệ** (100–300%) phóng to riêng vùng form, không phải zoom cả cửa sổ Cursor. Dùng
  `zoom` chứ không `transform: scale` để vùng cuộn biết form chiếm bao nhiêu chỗ.
- **Dòng tỉ lệ ở thanh dưới**: `Tỉ lệ nhìn: N% · 1 px CSS = M px màn hình`. So `M` với
  `devicePixelRatio` gõ trong F12 của trình duyệt — lệch nhau là biết ngay hai bên đang zoom
  khác nhau.

Blueprint giữ nguyên sự thật khi phóng to: **chữ trên thước luôn là px khai trong XML**, chỉ
vị trí mới nhân. Chỗ này có một cái bẫy đã sập một lần và giờ có test đo: khi tổ tiên có
`zoom`, `getBoundingClientRect()` trả toạ độ ĐÃ nhân, còn `style.left` ghi vào phần tử bên
trong lại là px LAYOUT rồi bị nhân lần nữa — lấy số từ rect ghi thẳng vào style là vạch trôi
gấp đôi. Nay mọi số quy về một hệ bằng tỉ lệ đo lại từ chính cái bảng; sai lệch vạch/slot đo
được ở 100/125/150/200/300% đều ≤ 0,02px.

### Đã sửa — bàn đo dùng chung shell với webview thật

`tools/probe-layout.mjs` từng giữ bản sao thân shell, và nó trôi ngay ở lần đổi đầu tiên (thêm
nút Tỉ lệ thì bàn đo vẫn dựng shell cũ, đo ra một trang không có nút nào). Thân shell nay nằm
ở `extension/media/shell.html`, cả webview lẫn bàn đo cùng đọc một file.

Bộ đóng gói cũng chặt thêm hai chỗ đã suýt lọt: khai thiếu file trong `CONTENT` (đã lọt
`render-host.js`, `preview-panel.js`, `grid.mjs`), và `[Content_Types].xml` thiếu đuôi file —
cả hai giờ dừng bản dựng thay vì chết lúc cài trên máy khách.

### Đã sửa — base pack giờ là CSS runtime THẬT, không còn bản mô phỏng

Tìm ra bản CSS runtime đã lưu: `DevWorkFlow/.temp/Danh mục khách hàng_files/WebResource(2).axd`
— thứ trình duyệt tải về khi mở `Dir/Customer` trên FSD_Dev. `fbo-form.css` và `fbo-lookup.css`
giờ là **bản chép nguyên văn** từ đó, và mọi số đo được kiểm bằng cách mở chính trang đã lưu ấy.

Cái mà việc đối chiếu lôi ra — tất cả đều là rule **tự thêm** ở bản trước:

| Tự thêm | Runtime thật | Hậu quả |
|---|---|---|
| `.FormCell:first-child { text-align: right }` | không có rule nào; `textAlign: start` | nhãn canh phải, sai |
| `.FormContainer { display: inline-block }` | `display: block` | hàng Lookup cao 25,8 thay vì 24 |
| `line-height: 0` ở ô + container | không có | chỉ để bù cho cái inline-block ở trên |
| `.FormContainerInputDisabled { border-bottom }` | KHÔNG có rule | ô readOnly bị vẽ thừa gạch chân |
| `.FormInputDisabled { color: #666 }` | dùng chung rule với `.FormInput`, `#000` | ô readOnly bị làm xám |
| `.FormCheckInput { width:auto; height:auto }` | `13px × 13px; margin: 0` | hàng checkbox cao 30 |
| `.CellDivContainer { inline-block; margin-left:2px }` | không có rule; `<a>` inline trần | hàng Lookup cao thêm |
| `.CellImgLookup { width: 14px !important }` | `15px`, không `!important` | icon hụt 1px, và khoá luôn CSS program |
| `.UpdateDlgBorder { padding: 3px }` | `border-left/right: 1px`, `border-bottom: 1px` | nội dung hụt 3px bề rộng |

Kết quả sau khi chép nguyên văn, đo lại: panel 575 ngoài · chuỗi bọc 573 → 570 · Content 570
· bảng 550 · mọi hàng 24px · ô nhập 13px · container 16px · ô Lookup 77px — **trùng runtime**.
Ba hàng lệch còn lại của `Site.f` (checkbox 26, textarea 40, `status` 23) đều là hệ quả đúng
của rule runtime, không phải sai lệch.

Cũng vì thế `Menu.css` của program mới lại có tác dụng: rule
`… .FormContainerInput input[type="text"] { padding: 0 !important }` của khách gỡ nốt 2px
padding mặc định của trình duyệt, đưa ô Lookup từ 79 về đúng 77px.

### Đã sửa — thanh tiêu đề: thiếu icon, gradient sai

`.UpdateDlgTitle` dùng ảnh gradient lặp ngang, `.UpdateDlgTitleText` dùng ảnh icon ở
`background-position: 0 0` cộng `padding-left: 20px` — bản trước thay cả hai bằng một
`linear-gradient` tự chế và bỏ hẳn icon, nên `padding-left: 20px` chừa ra một khoảng trống
không có gì.

Trang runtime đã lưu KHÔNG chứa hai ảnh đó (chúng đi qua `WebResource.axd?d=…`, trình duyệt
không lưu ảnh nền). Chúng được trích từ tài nguyên nhúng của
`FBISP24\bin\FastBusiness.ReportExtender.dll` — assembly duy nhất chứa chuỗi
`UpdateDlgTitleText`. Dải gradient nhận ra được vì nó chứa đúng `#eef6fc`, tức
`background-color` mà chính rule đó khai làm màu dự phòng.

### Đã bỏ — dải nút đáy dialog

Nút nào hiện (Mới / Sửa / Lưu / Hủy / Đóng) là do runtime quyết theo ngữ cảnh, `<view>` không
khai gì về chúng — vẽ một bộ đoán được là bịa ra thứ file không nói, mà designer lại không sửa
được nút. Preview vì thế thấp hơn dialog thật ~52px; ai cần đối chiếu chiều cao thì cộng thêm
phần đáy (padding 10px trên, 14px dưới, nút cao 24px).

### Đã sửa — form ra sai kích thước cả hai chiều

Đối chiếu với HTML runtime thật của `Dir/Site.xml` (dialog «Thêm kho hàng»). Mốc: bảng **550px**
(120+25+5+70+330), panel `style="width: 573px"`, ô Lookup `style="width: 77px"`, ô nhập cao 13px.

- **Thiếu cả khung dialog.** Preview chỉ vẽ cái bảng. Runtime bọc nó trong bảy lớp div
  (`UpdateDlgPanel → Border → Floor → Container → Frame → UpdateTaskDialog → UpdateDlgContent`),
  cộng một thanh tiêu đề và một dải nút ở đáy. Bảy lớp đó ăn **23px bề rộng** và ~55px chiều
  cao. Nay dựng đủ; chuỗi CSS cộng đúng 573 → 550 nên bảng không bị cắt, không dôi.
- **Ô không có `FormContainer` bọc.** Runtime gói mọi nội dung ô trong
  `<div class="FormContainer …" style="width:100%;max-height:13px;…">`, và chính cái
  `max-height` đó ghim chiều cao 13px của nhãn. Thiếu div là mất luôn hình học của hàng.
- **Bề rộng ô Lookup lấy nhầm nguồn.** Runtime tính từ **bề rộng Ô** (tổng px các cột ô trải
  qua) trừ 23px chỗ đeo icon, không từ `field@width` — field của `Dir/` hầu như không khai
  `@width`. `ma_dvcs` trải 25+5+70 = 100 → 77px, khớp runtime.
- **Ô readOnly cộng dồn class.** Runtime **thay** `FormInput FormTextInput` bằng
  `FormInputDisabled FormTextInputDisabled`, không cộng thêm. Cộng thêm là ô disabled ăn cả
  rule của ô thường, thắng thua tuỳ thứ tự trong CSS program.
- **`designer.css` đè lên hình học của runtime**: `.FormCell { padding: 2px 4px }`,
  `.FormInput { min-height: 1.4em; padding: 1px 3px; border: 1px }`. Đây chính là "vùng input
  có size khác thực tế". Nay `designer.css` không còn chạm `width/padding/border/height/display`
  của bất kỳ class `Form*` / `Grid*` / `UpdateDlg*` nào; mọi dấu của designer chuyển sang lớp
  blueprint vẽ đè.
- Ba nguồn cao dôi trong base pack, mỗi hàng 1–6px, cộng dồn cả form: strut của line box ở ô
  và ở `.CellDivContainer`, và margin mặc định của checkbox. Sau khi sửa, mọi hàng của
  `Site.f` cao đúng **24px** (hàng textarea 40px) thay vì 24/25,8/30 lẫn lộn.

Đo lại bằng `node tools/probe-layout.mjs --serve` — bàn đo dựng bản sao shell của webview
thành trang tĩnh chạy được trong trình duyệt thường.

### Đã thêm — Grid render ra lưới Detail

`core/src/grid.mjs`. `<grid>` không dùng đại số `item value` chút nào: view của nó là một dãy
`<field name="x"/>`, mỗi cái một cột, bề rộng lấy từ `<fields><field width="N">`, thứ tự khai
là thứ tự cột. Chọn kiểu render theo **gốc tài liệu** (`scanRoot`) chứ không theo thư mục —
`Filter/` cũng là `<dir>` nên cũng ra Form.

Cột `hidden="true"` (`stt_rec`, `stt_rec0`, `line_nbr`) là khoá kỹ thuật, runtime không vẽ.
`freezeColumns` đánh dấu cột khoá. Sweep 2015 file `Grid/`: 2014 render được, 0 cảnh báo, 0 crash.

Kèm một lỗi im lặng phải sửa trước: `scanFields` nhặt luôn `<field name>` nằm **trong** view.
Bản trần đó ghi đè bản khai đầy đủ ở `<fields>` (Map lấy bản sau), nên mọi cột Grid mất nhãn
lẫn bề rộng.

### Đã thêm — panel bám theo file đang mở

`extension/src/preview-panel.js`. `CustomTextEditorProvider` gắn cứng vào một document: mở ba
controller là ba tab designer, và tab nào cũng vẽ file của riêng nó kể cả khi đã chuyển sang
sửa file khác. Panel mới chỉ có **một**, luôn vẽ đúng file đang gõ, và tab sang file không
nằm trong `App_Data\Controllers` thì nói thẳng là không có gì để vẽ thay vì giữ form cũ.

`FBO Designer: Mở panel bám theo file đang mở` là lệnh mặc định; muốn gắn cứng vào một file
thì dùng `Mở designer gắn cứng vào file này`. Phần chung của hai lối nằm ở `render-host.js`.

### Đã sửa — bấm vào một hàng không còn mở thêm file

Trước: luôn `showTextDocument(…, ViewColumn.Beside)` — thêm tab, đổi bố cục. Nay theo thứ tự:
file sở hữu đang mở sẵn thì nhảy **ngay tại editor đó**; hàng đến từ Include mà file Include
chưa mở thì nhảy về dải `&Name;` **trong chính file đang xem** (`hostRefAt`) — đó mới là chỗ
sửa được và nó ở ngay trước mắt; chỉ khi bí (hoặc Alt-click để đòi) mới mở file mới.

### Đã thêm — blueprint overlay

Bật/tắt bằng ô «Blueprint» trên thanh trên. Thước px, vạch kẻ thẳng xuống tại từng mốc cột, và
khung slot cho mọi ô kể cả ô trống. Vạch lấy từ **mốc cộng dồn của list px khai ở `views > item`
dòng 1**, KHÔNG đo lại từ DOM — nhờ vậy vạch lệch mép ô là một tín hiệu thật (bảng không nghe
list px), chứ không phải lúc nào cũng trùng. Toàn bộ lớp này `position:absolute` +
`pointer-events:none`: tắt đi thì DOM của form không đổi một thuộc tính nào.


### Đã thêm — phân giải entity (P1)

`core/src/entities.mjs`. Cơ chế lấy theo `EntitySymbolBinder.cs` của DevWorkFlow, viết lại
bằng Node. Bốn thứ phải đúng, thiếu một cái là ra kết quả sai mà vẫn chạy:

- **Parameter entity** `<!ENTITY % X SYSTEM "…">` + `%X;` — kéo cả file khai báo vào subset.
- **Marked section** `<![%X;[ … ]]>` — công tắc bật/tắt cả mảng khai báo, trạng thái đọc từ
  giá trị parameter entity. Đây là cách BI mode bật/tắt.
- **First-wins.** FBO dựa hẳn vào luật này: `<![%Cond;[ <!ENTITY E "có"> ]]> <!ENTITY E "">`
  — section bật thì E là "có", tắt thì rơi xuống bản dự phòng. Last-wins là lộn ngược mọi công tắc.
- **Không bịa.** Entity không tìm ra thì giữ nguyên `&Name;` kèm diagnostic.

Kèm **provenance**: mỗi đoạn trong `clearText` biết đến từ file nào, offset nào (`mapToSource`).
Nhờ đó hàng đến từ Include được đánh dấu khoá, và bấm vào nó thì mở đúng file Include ở đúng
chỗ thay vì trỏ vào một vị trí không tồn tại trong controller.

Đo trên corpus FBISP24 (646 file `Dir/`): cảnh báo **1.279 → 584**, riêng "token trỏ vào field
không tồn tại" **839 → 1**; 5 file trước không thấy `<view>` nào giờ render được — view của
chúng nằm trong entity.

### Đã thêm — control thật và CSS thật

- `core/src/control.mjs`: checkbox, select, textarea, input, ô Lookup/Calendar có icon. Tên
  class là tên của runtime FBO (`FormTextInput`, `FormCheckInput`, `CellImgLookup`…) — đặt tên
  khác là tự cắt mình khỏi CSS thật.
- `core/src/program.mjs`: suy thư mục program từ chính file đang mở
  (`<program>\App_Data\Controllers\…`) rồi lấy `Css`, `Images`, `ClientScript` từ đó. Không còn
  setting nào để khai, nên cũng không còn gì để khai nhầm sang program của khách khác.
- Base pack ở `extension/media/base/` — chép từ `DevWorkFlow.UI/Config`. Xem README ở đó: đây
  là nhánh sẽ trôi, trả nợ bằng cách trích CSS runtime thật.
- Thứ tự nạp: khung → base → CSS program. `Menu.css` của program là lớp **vá**
  (`padding-right: 1px !important`), đảo thứ tự là vô hiệu hoá đúng thứ khách đã chỉnh.

### Đã sửa

- **Backreference sai nhóm trong regex khai báo entity** (`\5` thay vì `\6`). Nhóm 5 không
  tham gia nhánh inline nên backreference khớp chuỗi rỗng: mọi giá trị entity nuốt luôn dấu
  nháy đóng, và giá trị nào chứa `>` thì bị cắt ngang. Hỏng âm thầm — test đơn vị dùng
  `includes()` vẫn xanh, chỉ có sweep trên corpus mới lôi ra. Test đã siết sang so nguyên văn.
- **Regex `g` dùng chung trong hàm đệ quy.** `collect`/`expand` đệ quy mà xài chung một đối
  tượng regex: lần gọi trong giẫm lên `lastIndex` của lần gọi ngoài → vòng lặp vô tận. Mỗi lần
  gọi giờ tạo regex riêng.
- **`<footer>` không được đọc**, nên ô `.Description` hiện lại chính cái nhãn thay vì phần chú
  thích. Thấy được vì so ảnh chụp giao diện thật.
- **UTF-16 không được nhận diện.** `Include\BIMode.txt` — file một chữ INCLUDE/IGNORE bật tắt
  cả nhánh BI mode — là UTF-16LE. Đọc bằng 1258 ra `I\0N\0C\0…`, so với "INCLUDE" không khớp,
  công tắc đọc sai mà không báo gì.
- **Entry ZIP đặt tên bằng `\`.** `ZipFile::CreateFromDirectory` trên Windows PowerShell 5.1
  dùng `\`, spec ZIP đòi `/`. Gói vẫn mở được bằng Explorer nên nhìn tưởng xong, chỉ chết lúc
  cài. Bộ đóng gói giờ tự đọc lại central directory của chính nó để kiểm.

## [0.0.1] — P0

Khung: `core/` zero-dependency (encoding Windows-1258 hai chiều, span/offset + splice, đại số
`item value`, render model → HTML) và `extension/` JavaScript trần không bundler. Bộ đóng gói
`.vsix` tự viết, không dùng `vsce`. Hai câu hỏi spike ghi ở `docs/P0-QUESTIONS.md`.
