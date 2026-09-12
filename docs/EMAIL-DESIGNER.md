# Email Designer — Phase 0 (baseline) và Phase 2 (kiến trúc)

> Trạng thái: **Phase 0 · 2 · 3 (MVP) · 4 (Component) · 5 (Thêm/xoá/di chuyển) · 6 (Biến) · 7 (Code ↔ Designer) xong** — xem các mục cuối file. Ghi ngày
> 2026-09-11. Hợp đồng dạng mã: [`core/src/mail-design-contract.mjs`](../core/src/mail-design-contract.mjs),
> test: [`core/test/test-mail-design-contract.mjs`](../core/test/test-mail-design-contract.mjs).

Email Designer **không** phải một editor HTML chung. Mẫu mail của FBO nằm trong
`App_Data\Controllers\Options\Message.xml`, không phải file `.html` rời, và biến viết là
`{!field}`, không phải `{{var}}` (corpus FBISP24: 1463 token `{!…}`, 0 lần `{{`). Mọi quyết định
dưới đây đứng trên cấu trúc thật đó.

---

## Phase 0 — Baseline

### Trạng thái repository

Nhánh `master`, HEAD `94b682513a61` (2026-09-10). Không commit, không reset, không stash. Ba cụm
thay đổi chưa commit, **tách được theo file** (không file nào lẫn hai cụm):

| Cụm | File | Thuộc Email Designer? |
| --- | --- | --- |
| **A — "Xem mail"** | mới: `core/src/mail-template.mjs` (703 dòng), `core/test/test-mail-template.mjs`, `extension/src/mail-preview-host.js` (949), `extension/test/test-mail-preview-host.mjs` · sửa: `core/src/index.mjs` (+4), `core/test/run.mjs` (+1), `extension/src/extension.js` (+8), `extension/package.json` (+9), `extension/package.nls.json` (+1), `extension/test/run.mjs` (+27/−10, import tuần tự chống xen kẽ), `extension/test/fake-vscode.mjs` (+17/−1), `tools/package-vsix.mjs` (+2) | **Có — nền phát triển** |
| **B — designer form** | `extension/media/designer.js` (+152/−16), `extension/media/designer.css` (+7/−3): dấu `+` thêm cột vùng form, kéo cạnh ngay trên dải px, rAF khi kéo | Không |
| **C — lấy dữ liệu mẫu** | `core/src/grid-sample.mjs` (+1/−1) | Không — gây 3 FAIL |

Phase 2 thêm (chưa commit): `core/src/mail-design-contract.mjs`, `core/test/test-mail-design-contract.mjs`,
`docs/EMAIL-DESIGNER.md`, và một dòng import trong `core/test/run.mjs`.

### Dấu vân tay baseline (`git hash-object`, trước Phase 2)

| blob | file |
| --- | --- |
| `6fda57bc` | core/src/mail-template.mjs |
| `3b521c6e` | core/test/test-mail-template.mjs |
| `49cbcc48` | extension/src/mail-preview-host.js |
| `94ad137f` | extension/test/test-mail-preview-host.mjs |
| `1a6bd637` | core/src/index.mjs |
| `c5a29de8` | core/test/run.mjs |
| `428bb7a6` | extension/src/extension.js |
| `314e65cc` | extension/package.json |
| `c984b58b` | extension/package.nls.json |
| `e990e5b2` | extension/test/run.mjs |
| `dc71dfca` | extension/test/fake-vscode.mjs |
| `876dce06` | tools/package-vsix.mjs |
| `c78eda3c` / `0ccfa126` | extension/media/designer.js / designer.css (cụm B) |
| `d1bc6bc1` | core/src/grid-sample.mjs (cụm C) |

Test baseline: core **2042/2044**, extension **291/292**. Cả 3 FAIL thuộc cụm C; mọi test của
"Xem mail" PASS.

### `grid-sample.mjs` — cụm C

Thay đổi duy nhất, ở `detailKeyClause` (dòng 859):

```diff
-  return `a.${column} = ${quote(key)}`;
+  return `${column} = ${quote(key)}`;
```

1. **Thuộc tính năng nào:** «Xem dữ liệu thật trên lưới» (`Ctrl+Alt+D`), nhánh lưới chi tiết — mẩu
   SQL thay cho `@@whereClause` sau khi câu dò bước 1 lấy được khoá chứng từ.
2. **Không phục vụ Email Designer.** Không file mail nào gọi `grid-sample.mjs`. Nó chỉ trùng phiên
   làm việc (mtime 13:35, giữa `mail-template.mjs` 13:31 và `mail-preview-host.js` 13:39).
3. **Test phụ thuộc:** `core/test/test-grid-sample.mjs:318` và `:335`, `extension/test/test-sample-host.mjs:302`
   — cả ba chờ `where a.stt_rec = '…'`.
4. **Trạng thái:** WIP lạc, không liên quan. Nó còn **mâu thuẫn với chính lời dẫn** ngay trên hàm
   (dòng 845: «Ghép `a.` bằng CÙNG alias gốc mà `@@fieldExternal` đã dùng»), và bản `a.` mới vào
   từ commit `33bffea` (2026-09-08).

Nguyên nhân phải phân tích trước khi chọn sửa test hay hoàn tác: corpus FBISP24 có 12 lưới
`type="Detail"` dùng `@@whereClause` — **cả 12 đặt alias bảng gốc là `a`**
(`from @@prime$partition$current a …`). Nhiều câu còn join thêm bảng
(`left join dmtk b`, `]]>&GridDetailQueryLoadingJoin;<![CDATA[`), và mẫu cùng họ `SPDetail.xml`
join `m25$…m on a.stt_rec = m.stt_rec`. Tức là `stt_rec` trần **có thể mơ hồ** ("Ambiguous column
name") ở đúng những lưới có join tới bảng chứng từ, còn `a.stt_rec` thì không.

**Quyết định (người dùng, 2026-09-11): GIỮ `stt_rec =` không alias** — đã kiểm trên chính program
thật (`where stt_rec = 'ZZZ'`). Phân tích alias trên corpus FBISP24 ở trên không thay được phép chạy
thật. Đã cập nhật lời dẫn `detailKeyClause` và 3 test theo; baseline xanh lại (core 2136/2136,
extension 292/292 trước khi thêm Phase 3).

### "Xem mail" — cụm A

Chưa có commit nào; là change-set chưa commit liệt kê ở bảng trên. Đó là **baseline phát triển
Email Designer**. Những điều ghi nhận về nó, dùng lại ở Phase 3:

- `renderMailPreview` đã có tiền lệ đánh dấu CHỈ lúc vẽ (`blueprint:true` → `data-fbo-col`).
- `applyMailTablePlan` đã giải đúng bẫy quy toạ độ: điểm CHÈN phải đi `mapToSource`, không đi
  `sourceRange` (hàm này đệm tối thiểu 1 ký tự → ăn mất `<` của thẻ kế tiếp).
- Test khoá quyết định **điều hướng nằm trong panel, không QuickPick**
  (`extension/test/test-mail-preview-host.mjs:203-209`).
- Lời dẫn đầu `mail-preview-host.js` («Không có kênh sửa nào») đã cũ — panel giờ có ghi.
- `renderMailPreview` giải mã entity XML trên CẢ nội dung CDATA. Corpus hiện 0 chỗ bị ảnh hưởng
  (`&amp;`/`&lt;` trong CDATA: 0), nhưng mô hình mảnh ở Phase 3 giải mã đúng: chỉ nút chữ XML.
- `lastSelection` là một biến toàn cục cho mọi file, không theo từng file.

### Commit baseline

Cụm A đã commit: **`e28bd2e`** «mail: xem mẫu mail trong Options/Message.xml», trên nhánh
**`feat/email-designer`** (tách từ `master` `94b6825`). `core/test/run.mjs` chỉ stage đúng dòng import
của cụm A — dòng import test hợp đồng Phase 2 để ngoài commit. Kiểm trong worktree tạm tại chính
commit đó: core 2044/2044, extension 292/292.

---

## Phase 2 — Kiến trúc

### Cấu trúc mẫu mail thật (đo trên `FBISP24/…/Options/Message.xml`)

```xml
<message xmlns="urn:schemas-fast-com:data-message">
  <mail><template>
    <action id="PurchaseRequisition" v="…" e="…">
      <fields><field name="h_so_ct"><header v="Số phiếu" e="Number"/></field>…</fields>
      <body>                                   <!-- body2…: biến thể -->
        <header><text><![CDATA[<html>]]>&CssClass;<![CDATA[<body><table>…<tr>…]]></text></header>
        <detail><text><![CDATA[<tr><td>{!ma_vt}</td></tr>]]></text></detail>   <!-- dòng mẫu lặp -->
        <footer><text><![CDATA[</table></body></html>]]></text></footer>
```

Số đo (probe tạm, không phải mã dự án):

| | |
| --- | --- |
| action mail / biến thể / part | 21 / 39 / 117 |
| phần tử HTML | 1874 — `td` 976, `tr` 367, `a` 118, `table` 105, `br` 63, `i` 47, `div` 36, `p` 16, `span` 12 |
| phần tử mở ở part này, đóng ở part khác | **97** — `html` 32, `body` 32, `table` 29 |
| gốc của `<detail>` | `tr` — 29/29 |
| thẻ mở bị **cắt đôi bởi entity** | **178** — `<td style="width:100px;]]>&HeaderColor;<![CDATA[">` |
| thẻ mở nằm trong nút chữ XML (entity) | 64 — `&CssClass;` bung ra `<head><style>` |
| mảnh CDATA đến từ file Include | 89 / 327 |
| `{!token}` trong thuộc tính / trong chữ | 445 (`style="display:{!slink}"`, `href="{!alink}&n=1"`) / 951 |
| thuộc tính không nháy · đóng ngầm `p` · thẻ đóng lạc · thẻ không đóng | 58 · 4 · 2 · 2 |
| `script`/`iframe`/`on*`/`javascript:` | 0 (vẫn phải chặn — khách tự viết mẫu) |
| đủ điều kiện xoá/di chuyển (tính chặt) · sửa chữ · sửa style | 1078 (58%) · 620/1042 · 533/895 |

### Hạ tầng dùng lại

| Nhu cầu | Dùng lại |
| --- | --- |
| Custom editor, dirty/save, split view XML | khuôn `designer-editor.js` (`registerCustomEditorProvider`) |
| Bung entity + quy về file nguồn | `expandEntities`, `mapToSource` (chèn), `sourceRange` (thay) |
| Vỏ Message.xml | `mail-template.mjs`: `maskRanges`, `findElement`, `locateMailSection`, `scanMailActions`, `scanFieldLabels`, `renderMailPreview`, plan cột/dòng |
| Ghi file | `edit-host.js#applySplice` |
| Hoàn tác | `edit-history.js#history` |
| Chống vòng lặp | chốt `editing` / `renderSoon` 40ms / `finishEdit` |
| Hỏi xác nhận | `dialogs().ask` (DialogService), `confirmForeign` qua `applySplice` |
| Phím Delete từ host | `designer-webview.js#trackDesignerWebview` + `postToActiveDesigner` |
| Đọc file có nhớ | `render-host.js#cachedReadFile` |
| License | `ensureLicense` / `withLicense` |
| i18n | `core/config/messages.json` + `t()` / `toast()` |
| Test | `core/test/harness.mjs`, `extension/test/fake-vscode.mjs` |

Không có trong repo, và không thêm dependency để có: HTML parser (core zero-dep, ADR-0002).

### Module mới

| File | Phase | Việc |
| --- | --- | --- |
| `core/src/mail-design-contract.mjs` | **2 (đã có)** | hằng, vai trò, bảng op, whitelist style/thuộc tính, `validateMailMessage` |
| `core/src/mail-html.mjs` | 3 | dòng HTML từ ba part (mô hình mảnh), tokenizer theo span, chỉ mục phần tử, `caps`, bản vẽ có `data-fbo-el` + làm sạch |
| `core/src/mail-edit.mjs` | 3→5 | `planMailText`, `planMailStyle` (3), `planMailAttr` (4), `planMailRemove`/`Move`/`Insert` (5) |
| `extension/src/mail-apply.js` | 3 | tách `applyMailTablePlan` khỏi `mail-preview-host.js` — một chỗ quy toạ độ cho cả panel lẫn editor |
| `extension/src/mail-designer-editor.js` | 3 | `CustomTextEditorProvider` `fboDesigner.mail` |
| `extension/media/mail-designer.{js,css}`, `mail-shell.html` | 3 | webview: toolbar (combobox của "Xem mail"), khung iframe, lớp phủ chọn, bảng thuộc tính tối thiểu |

### Mô hình phần tử

**Dòng HTML của một (action, body)** = nội dung `<text>` của `header` + `detail` + `footer` nối
liền, dựng từ các **mảnh** (`MailPiece`):

- `cdata` — nguyên văn giữa `<![CDATA[` và `]]>`: toạ độ HTML ↔ `clearText` là **dịch tuyến tính**.
- `text` — nút chữ XML ngoài CDATA (thực tế: chỗ một `&Name;` bung ra), đã giải mã `&lt;`… —
  toạ độ **không** tuyến tính. Designer đọc được, **không ghi vào**.

Mỗi mảnh mang `part`, `file` (có thể là Include) và `fromEntity`.

**Phần tử** (`MailElement`, chỉ ở host): `id`, `tag`, `role`, `part`, `parentId`, bốn mốc
`openStart/openEnd/closeStart/closeEnd` theo dòng HTML, `fingerprint`, `caps` (op → `true` hoặc
**lý do** không làm được). Webview chỉ nhận `MailElementWire` — không mốc toạ độ nào.

Tokenizer (Phase 3, tự viết, không dependency): comment, `<!…>`, thẻ mở với thuộc tính có/không
nháy (tôn trọng `>` trong nháy), thẻ đóng, void element, raw-text (`style`/`title`), đóng ngầm
`p`/`td`/`th`/`tr`/`li`. Thẻ đóng lạc → bỏ qua + cảnh báo; phần tử không tìm được thẻ đóng →
`caps` mọi op sửa cấu trúc = lý do. Không đoán — cùng thái độ `canEditRow`.

### Chiến lược id

- `eN` = số thứ tự (từ 1) theo thứ tự thẻ mở trong dòng HTML của (action, body), đếm cả frame.
- Host đếm **`rev`** tăng mỗi lần vẽ (không dùng `document.version`: dòng HTML còn phụ thuộc
  Include, sửa Include không đổi version của Message.xml). Host giữ `{rev, id → fingerprint}` của
  lần vẽ **gần nhất**.
- Nhận `select`/`edit`: `rev` khác lần vẽ gần nhất → từ chối (bản vẽ cũ), vẽ lại. Cùng `rev` → dựng
  lại chỉ mục **từ văn bản hiện tại**, lấy phần tử `eN`, so `fingerprint` (`part|tag|thẻ mở nguyên
  văn`). Lệch → từ chối + vẽ lại.
- Id không bao giờ ghi xuống nguồn. Sau một phép sửa, id có thể dồn số; host gửi `selectId` trong
  bản vẽ kế tiếp để webview chọn lại đúng phần tử.

### Chiến lược dải nguồn

```text
elementId ──(chỉ mục dựng lại)──► mốc trong dòng HTML
          ──(mảnh cdata: dịch tuyến tính)──► dải clearText
          ──(entities.mjs)──► {file, start, end} trong file nguồn
```

Luật:

1. Mọi dải bị sửa phải nằm **trọn trong mảnh `cdata`**, cùng **một file**. Chạm mảnh `text` →
   từ chối, lý do nêu tên entity (`&HeaderColor;` dùng chung cho mọi action).
2. Thay (`start < end`) → `sourceRange`, kèm kiểm độ dài dải nguồn = độ dài dải `clearText`
   (không entity nào lọt giữa). Chèn (`start === end`) → `mapToSource`. Đúng như `applyMailTablePlan`.
3. Điểm chèn nằm ở biên mảnh: "sau phần tử" lấy mảnh chứa ký tự CUỐI của phần tử, "trước phần
   tử" lấy mảnh chứa ký tự ĐẦU.
4. Chữ ghi vào `cdata` không được chứa `]]>` — plan kiểm lại dù đã HTML-escape (`>` → `&gt;`).
5. File đích ≠ Message.xml (action tiêm từ Include) → `applySplice` hỏi qua `confirmForeign`.
6. Không serialize lại HTML; chỉ splice đúng dải. Kế hoạch là
   `{ok, edits:[{start,end,text}] (toạ độ clearText), notes?, label}` — cùng khuôn
   `planResizeMailColumn`.

### Bảng phép sửa

Mọi phép sửa đi chung **một** hình dạng hiện có của designer: `{type:'edit', op, …}`.

| op | Input (ngoài `rev`) | Hiệu ứng lên nguồn | Hoàn tác | Phase |
| --- | --- | --- | --- | --- |
| *(select)* | `elementId`, `reveal?` | không; `reveal` mở XML đúng dải | không | 3 |
| `setText` | `elementId`, `value` | thay dải nội dung `[openEnd, closeStart)` bằng chữ đã HTML-escape; `{!token}` giữ nguyên | 1 mục | 3 |
| `setStyle` | `elementId`, `property`, `value` (`''` = xoá) | thay/xoá MỘT khai báo trong `style="…"`, hoặc chèn ` style="p:v"` trước `>`; không bao giờ sửa class dùng chung | 1 mục | 3 |
| `setAttr` | `elementId`, `name`, `value` | thay giá trị thuộc tính / chèn thuộc tính | 1 mục | 4 |
| `removeElement` | `elementId` | xoá `[openStart, closeEnd)` (+ dòng trống còn lại) | 1 mục | 5 |
| `moveElement` | `elementId`, `up`/`down` | MỘT splice thay `[a.openStart, b.closeEnd)` bằng bản đã đổi chỗ, chữ ở giữa giữ nguyên | 1 mục | 5 |
| `insertComponent` | `elementId`, `before`/`after`/`append`, `component` | chèn mảnh HTML do bộ sinh của core tạo | 1 mục | 5 |
| `resizeColumn` / `addColumn` / `addRow` | `columnIndex`, `width` / `columnIndex` / `part`, `rowIndex` | plan có sẵn của "Xem mail" | 1 mục | 0 → chuyển vào `edit` ở 3 |

Phép sửa không mang `actionId`/`body`: host áp lên đúng (action, body) nó đang vẽ; `rev` bảo đảm
hai bên đang nói về cùng một bản.

### Giao thức thông điệp

Kế thừa, không tạo bus mới: `postMessage` thô có `type`, sửa đi `edit` + `op` như
`designer.js`; tên của panel "Xem mail" (`selection`, `gotoSource`) giữ nguyên. Mọi thông điệp
webview → host đi qua `validateMailMessage` (sau `OverlayDialogs.handleMessage` nếu có), và nhánh
xử lý chỉ đọc bản đã lọc.

**Webview → host**

| type | Trường | Nguồn gốc |
| --- | --- | --- |
| `ready` | — | designer |
| `selection` | `actionId`, `body`, `lang` | "Xem mail" |
| `select` | `rev`, `elementId`, `reveal` | designer (`select`) |
| `edit` | `op`, `rev`, … (bảng trên) | designer (`edit`) |
| `undo` / `redo` | — | designer |
| `gotoSource` | `section` | "Xem mail" |
| `log` | `text` | designer |

**Host → webview**

| type | Trường | Ghi chú |
| --- | --- | --- |
| `render` | `rev`, `template`, `actions`, `html`, `elements`, `selectId`, `warnings` | `rev` = "document-state"; `selectId` = "selection-changed" do host chủ động |
| `error` / `idle` | `message` | như designer |
| `hotkey` | `key`, `shiftKey` | Delete bắt ở host |

### Ranh giới part / phần tử

```text
Message.xml
└─ action (mẫu)                  ← chọn ở toolbar
   └─ body | bodyN (biến thể)    ← chọn ở toolbar
      ├─ header ┐
      ├─ detail ├─ PART — ranh giới cứng: không chèn/xoá/di chuyển xuyên qua
      └─ footer ┘
         └─ dòng HTML
            ├─ FRAME      html/head/style/body + mọi phần tử mở/đóng ở hai part khác nhau
            ├─ STRUCTURE  table/tbody/tr/td/th… — sửa chữ/style ô; cấu trúc qua phép cột/dòng
            │             (<detail> = đúng MỘT <tr> mẫu lặp theo dữ liệu)
            ├─ BLOCK      p, div, h1–h6, hr, center, ul/ol/li…, và table lồng TRỌN trong một part
            ├─ INLINE     a, span, b/strong, i/em, u, font, img, br…
            └─ UNKNOWN    thẻ lạ (VML Outlook) — chỉ chọn và sửa style
```

Không dùng chữ "Entity" cho phần tử: trong repo này entity là `<!ENTITY>`/`&Name;`.

| Khả năng | Vai trò | Điều kiện thêm |
| --- | --- | --- |
| chọn | mọi vai trò | — |
| `setText` | block, inline, ô `td`/`th` | không có phần tử con (chỉ chữ, `{!token}`, tham chiếu ký tự); dải nội dung trọn trong `cdata` |
| `setStyle` | mọi vai trò trừ frame | giá trị `style` trọn trong MỘT mảnh `cdata` (loại 178 thẻ bị `&HeaderColor;` cắt đôi); khai báo đang chứa `{!token}` thì không sửa khai báo đó |
| `setAttr` | theo `ATTRIBUTES[tag]` | giá trị thuộc tính trọn trong một mảnh `cdata` |
| `removeElement`, `moveElement` | block, inline | có thẻ đóng thật; trọn một part; trọn `cdata` cùng file; `move` chỉ đổi với phần tử anh em cùng cha |
| `insertComponent` | quanh block/inline; `append` vào `td`/`div`/`center` | điểm chèn trong `cdata`; `append` cần `closeStart` của khung cùng part (không `append` vào `body` — nó đóng ở footer) |

### Tích hợp custom editor

- `extension/package.json` → `customEditors`: `viewType: "fboDesigner.mail"`,
  `selector: [{ "filenamePattern": "**/Options/Message.xml" }]`, `priority: "option"` (XML vẫn mở
  mặc định; mở bằng *Open With…* hoặc lệnh). Kích hoạt `onCustomEditor:*` VS Code tự sinh
  (engine `^1.85`).
- `MailDesignerProvider.register(context, core, output)` gọi trong `activate` ngay sau
  `FboDesignerProvider.register`; `retainContextWhenHidden: true`, `supportsMultipleEditorsPerDocument: true`.
- `resolveCustomTextEditor`: `ensureLicense` im lặng → khoá; `isMailTemplateDoc` sai → `idle`;
  `trackDesignerWebview(panel.webview, panel)`; shell riêng (`mail-shell.html` +
  `mail-designer.{js,css}`, CSP nonce) dùng `nonce`/`assetUri` của `render-host.js` — hai hàm này
  hiện CHƯA xuất, Phase 3 xuất thêm (không đổi hành vi).
- Nghe `onDidChangeTextDocument` của chính document **và** mọi file trong `segments` (Include cung
  cấp action), qua chốt `editing`/`renderSoon`/`finishEdit`.
- `keybindings` Delete: thêm `|| activeCustomEditorId == 'fboDesigner.mail'` vào `when`.
- `fboDesigner.viewMail`: Phase 3 chưa đổi. Khi editor đủ các chức năng của panel (so sánh biến
  thể, cột/dòng), lệnh chuyển sang `vscode.openWith(uri, 'fboDesigner.mail')` và panel cũ gỡ —
  mốc quyết định ghi ở Phase 7.

### Hộp thoại

- **Chọn action/body: toolbar trong editor**, không phải hộp thoại. Message.xml có 21 mẫu × nhiều
  biến thể, người dùng đổi liên tục; "Xem mail" đã chốt điều hướng trong panel và test khoá điều
  đó. Mở editor → vẽ lựa chọn gần nhất **của file đó** (hoặc action/body đầu) → đổi ở combobox →
  `selection` → host vẽ lại. Tương đương luồng Open → Action → Body → Designer, không thêm cú bấm.
- **Xác nhận** (file dùng chung, xoá khối): `dialogs().ask` / `confirmForeign`. Phase 3 dùng
  `DialogService` (panel riêng), vì phần vẽ `OverlayDialogs` đang nằm trong `designer.js`
  (`showDialog`, `dialogBlock`) mà webview mail không nạp. Tách phần vẽ ấy ra file dùng chung là
  refactor code cũ → chỉ làm khi được duyệt (ứng viên Phase 8).
- Không tạo framework hộp thoại thứ hai.

### Lịch sử hoàn tác

- `applySplice(plan, hostDocument, output, label)` ghi `history(output).record(label, frames)` —
  **một phép = một WorkspaceEdit = một mục**, kể cả `moveElement` (một splice) và phép chạm hai
  file.
- Webview gửi `undo`/`redo` → `history(output).undo()/redo()` trong chốt `editing`, y hệt
  `designer-editor.js`. Chồng dùng chung với designer form — không chồng thứ hai.
- `label` có dạng `mail: sửa chữ <h2>`, `mail: style font-size <td>` — hiện lại khi hoàn tác.
- Gõ tay trong XML (split view) vẫn là undo của VS Code; `edit-history` tự từ chối nếu file đã
  đổi sau thao tác.

### `applySplice`

```text
core.planMail*(clearText, index, msg) ─► {ok, edits(clearText), label}
mail-apply.js: mỗi edit ─► mapToSource | sourceRange ─► {file, start, end, text}
              file ≠ host ─► warning = file
applySplice({edits, warning}, hostDocument, output, label)
   ├─ chặn .f, chặn mã hoá ≠ UTF-8
   ├─ confirmForeign(warning)
   ├─ MỘT WorkspaceEdit ─► history.record ─► save nền
   └─ onDidChangeTextDocument ─► renderSoon (đang hoãn vì editing) ─► finishEdit ─► render
```

Không có đường ghi file thứ hai.

### Bảo mật

HTML mẫu mail là **dữ liệu không tin cậy**.

1. **Bản vẽ ≠ nguồn.** Core dựng một BẢN SAO để vẽ: bỏ `script`/`iframe`/`object`/`embed`/
   `frame(set)`/`applet`/`base`/`form`/`meta http-equiv=refresh`/`link` ngoài; bỏ mọi `on*`, `srcdoc`;
   URL `javascript:`/`vbscript:`/`data:` không phải ảnh → `#`; bỏ mọi `data-fbo-*` có sẵn **trước**
   khi gắn `data-fbo-el` (chống giả id). Nguồn không bị đụng.
2. **Iframe cô lập:** `iframe.srcdoc` với `sandbox="allow-same-origin"` — không `allow-scripts`,
   `allow-forms`, `allow-popups`, `allow-top-navigation` (giữ lựa chọn của "Xem mail"). Srcdoc kế
   thừa CSP của trang cha. Trang cha đọc DOM con để vẽ lớp phủ, chặn mọi `click` (capture +
   `preventDefault`) nên link trong mail không điều hướng.
3. **CSP trang cha:** `default-src 'none'; script-src 'nonce-…'; style-src ${cspSource} 'unsafe-inline';
   img-src ${cspSource} https: http: data:; font-src ${cspSource}; frame-src 'self'; child-src 'self'`.
   Ảnh `http:` giữ như "Xem mail" (logo trong mẫu thật).
4. **Không tin webview:** `validateMailMessage` lọc theo whitelist, bỏ trường lạ; webview không bao
   giờ gửi toạ độ; host tự quy id → dải. CSS qua `isSafeCssValue`, URL qua `isSafeUrl`, thuộc tính
   theo `ATTRIBUTES`.
5. **Ghi an toàn:** chữ HTML-escape, thuộc tính attribute-escape, chặn `]]>`, không ghi vào mảnh
   nút chữ XML; `{!token}` không bị escape (không chứa `&<>"`).
6. HTML đi vào webview chỉ qua `srcdoc` của iframe sandbox, không bao giờ `innerHTML` trang cha.
   Dữ liệu nhúng dùng `embedJson` (escape `<`).

### Hover / chọn / outline / click (hợp đồng webview, Phase 3)

| Sự kiện | Hành vi |
| --- | --- |
| rê chuột | `closest('[data-fbo-el]')` trong DOM con → khung nét đứt 1px + nhãn tên thẻ, vẽ ở lớp phủ trang cha |
| click | chặn điều hướng; chọn → khung liền 2px; gửi `select {rev, elementId}`; bảng thuộc tính đọc `elements[id]` |
| Ctrl+click / double click | như click + `reveal: true` → host mở XML đúng dải |
| Esc | bỏ chọn |
| frame | rê/chọn được, bảng thuộc tính ghi rõ vì sao không sửa (`caps`) |
| bản vẽ mới | chọn lại `selectId` nếu có, không thì giữ id đang chọn nếu còn tồn tại |

Lớp phủ nằm ở trang cha, không chèn gì vào DOM của mẫu mail.

### Luồng dữ liệu

```text
Message.xml (TextDocument) + Include
      │ expandEntities → clearText + segments
      ▼
mail-template.mjs: action/body → header/detail/footer
      │
      ▼
mail-html.mjs: mảnh (cdata|text) → dòng HTML → tokenizer → chỉ mục phần tử (id, vai trò, caps, fingerprint)
      │
      ├───────────────────────────────┐
      ▼                               ▼
Extension host                     Webview (mail-designer.js)
 giữ {rev, id→fingerprint}          render: iframe srcdoc (bản sao đã làm sạch + data-fbo-el)
                                    lớp phủ hover/chọn, bảng thuộc tính
      │                               │ thao tác người dùng
      ◄──────── postMessage ──────────┘  {type:'edit', op, rev, elementId, …}
      │
validateMailMessage → dựng lại chỉ mục từ văn bản hiện tại → so rev + fingerprint
      │
      ▼
mail-edit.mjs: planMail* → {edits (clearText)}
      │
      ▼
mail-apply.js: mapToSource / sourceRange → applySplice → WorkspaceEdit
      │                                        │
      ▼                                        ▼
edit-history.record                     TextDocument đổi
                                               │ onDidChangeTextDocument (hoãn khi editing)
                                               ▼
                                        renderSoon → render(rev+1)
```

### Chống vòng lặp

Designer → HTML → sự kiện document → designer **không** tạo vòng: webview không tự sửa DOM rồi
báo, nó chỉ gửi ý định; host ghi; sự kiện đổi document chỉ dẫn tới **vẽ lại**, không dẫn tới ghi.
Chốt `editing` gộp mọi nhịp của một phép sửa thành một lượt vẽ; debounce 40ms gộp gõ tay.

### Test Phase 3 phải có

- core: dòng HTML từ fixture có `]]>&Entity;<![CDATA[` cắt giữa thẻ; id ổn định cho cùng văn bản;
  fingerprint lệch khi thứ tự đổi; `setText` giữ `{!token}` và từ chối phần tử có con; `setStyle`
  thêm/sửa/xoá khai báo, từ chối thẻ bị entity cắt đôi; bản vẽ không còn `on*`/`script`, id giả bị
  bỏ; áp splice → quét lại → HTML ngoài dải sửa giữ nguyên từng byte.
- extension: mở editor → `render` có `rev`; `edit` với `rev` cũ bị từ chối; `edit` hợp lệ gọi
  `applySplice` đúng file/dải + `label`; `undo` gọi `history`; đổi document → đúng một lượt vẽ.
- toàn bộ: `node core/test/run.mjs`, `node extension/test/run.mjs`.

### Quyết định còn mở (không chặn Phase 3)

1. ~~Cụm C (`grid-sample.mjs`)~~ — giữ, xem Phase 0.
2. ~~Commit cụm A~~ — `e28bd2e`.
3. Mốc gỡ panel "Xem mail" (dự kiến Phase 7).
4. Tách phần vẽ `OverlayDialogs` khỏi `designer.js` (dự kiến Phase 8, cần duyệt).

---

## Phase 3 — MVP

### Đã làm

| Việc | Ở đâu |
| --- | --- |
| Mở Email Designer | *Open With… → FBO Email Designer* (`customEditors` `fboDesigner.mail`, `**/Options/Message.xml`, `priority: option`), lệnh `fboDesigner.openMailDesigner` (menu FBO Designer + Command Palette) |
| Đọc + dựng dòng HTML | `core/src/mail-html.mjs#buildMailView` (mảnh cdata/text, cắt ở ranh giới đoạn nguồn) |
| Tokenizer + chỉ mục + `caps` | `indexMailElements` |
| Vẽ | `renderMailDesign` (làm sạch + `data-fbo-el` + nhãn `{!h_…}`) → `iframe.srcdoc` sandbox không script |
| Chọn, hover, outline, breadcrumb | `extension/media/mail-designer.js` — lớp phủ `#md-hit` + `elementFromPoint` |
| Sửa chữ | `core/src/mail-edit.mjs#planMailText` |
| Sửa style inline | `planMailStyle` — đặt/đổi/xoá một khai báo; xoá khai báo cuối thì bỏ luôn `style` |
| Ghi + hoàn tác | `mail-apply.js#toSourcePlan` → `applySplice` → `edit-history` (Ctrl+Z / Ctrl+Y trong webview) |
| Đi tới XML | Ctrl+click / bấm đúp phần tử (thẻ mở), hoặc chọn part ở thanh công cụ |
| Code ↔ Designer | custom text editor: split view cùng document; đổi document/Include → vẽ lại một lần (debounce 40ms + chốt `editing`) |

### Lệch khỏi kiến trúc Phase 2 (và vì sao)

1. **`mapMailEdits` nằm ở core**, không ở host: quy edit về nguồn là phép thuần, test được headless.
   `mail-apply.js` chỉ còn cộng file ngoài Message.xml vào `warning` và mở XML.
2. **`applyMailTablePlan` của «Xem mail» dùng chung `mapMailEdits`**; `revealSpan` chuyển sang
   `mail-apply.js`. Dải THAY giờ phải nằm trọn trong một đoạn nguồn — chặt hơn `sourceRange` cũ
   (bản cũ có thể trải qua entity), còn điểm chèn giữ đúng hành vi cũ.
3. **Webview không gắn listener vào DOM iframe.** Iframe sandbox không `allow-scripts` — trang cha
   bắt chuột ở lớp phủ rồi hỏi `elementFromPoint`. Hệ quả: không bôi chọn chữ trong mẫu được; bánh
   xe được chuyển hộ để cuộn.
4. **Đọc Include ưu tiên TextDocument đang mở** (`liveReadFile`): `applySplice` lưu nền SAU khi vẽ
   lại, đọc đĩa lúc ấy là đọc bản cũ.
5. **`render` gửi kèm `file` và `styleProperties`** (bổ sung vào typedef hợp đồng).
6. **Lựa chọn (action, body, ngôn ngữ) nhớ theo từng file**, không toàn cục như «Xem mail».
7. **Chưa thêm `when` cho phím Delete** — chưa có phép xoá (Phase 5).

### Kiểm chứng

- `node core/test/run.mjs` **2221/2221** · `node extension/test/run.mjs` **342/342**.
- Test mới: hợp đồng (91), `test-mail-html.mjs` + `test-mail-edit.mjs` (sửa khứ hồi: áp edit vào văn
  bản nguồn → dựng lại → đọc lại; ngoài dải sửa không đổi byte nào), `test-mail-designer-editor.mjs`
  (50: license, CSP, rev cũ, `applySplice` đúng file/dải/nhãn, noop, undo, nhớ lựa chọn, vẽ lại một
  lần khi document đổi, mở XML, lệnh mở).
- Corpus `FBISP24/…/Options/Message.xml`: 39/39 biến thể dựng được, 1874 phần tử, không lệch số dấu
  `data-fbo-el`; sửa khứ hồi chữ **68/68**, style **68/68** (36 edit rơi vào file Include) — 2.7s.
- Webview chạy trong trình duyệt với bản vẽ thật (`PurchaseRequisition`): 61 dấu, 0 thuộc tính `on*`,
  hover/chọn khớp khung phần tử, bảng thuộc tính + breadcrumb, gửi đúng `setText`/`setStyle`/
  `select{reveal}`/`undo`, Esc bỏ chọn, bánh xe cuộn được.
- `tools/package-vsix.mjs`: 78 mục khai, không thiếu file, không sót `.js`/`.mjs`/media (kiểm bằng
  script đọc `CONTENT`, không đóng gói).

### Giới hạn còn lại

- Chưa chạy trong VS Code thật (Extension Host) — cần mở tay một lần: CSP của webview, `openWith`,
  split view.
- Sửa chữ chỉ cho phần tử không có con (`<p>Chữ <b>đậm</b></p>` phải chọn từng phần tử con).
- Không sửa được style/chữ nằm trong phần do entity sinh ra (vd 178 `<td>` bị `&HeaderColor;` cắt
  ngang trên corpus) — có lý do hiện ở bảng thuộc tính.
- Hộp thoại xác nhận file dùng chung dùng `DialogService` (panel riêng), chưa vẽ đè trong designer.
- Chưa có: ~~thuộc tính HTML (Phase 4)~~ — xem dưới; thêm/xoá/di chuyển (Phase 5), biến + dữ liệu
  mẫu (Phase 6), xem theo bề rộng/validation (Phase 8).

Commit: **`255eddd`** trên `feat/email-designer` (Phase 2 + 3; kiểm trong worktree tạm: core 2220/2220,
extension 342/342).

---

## Phase 4 — Component

### Đã làm

Bảng thuộc tính đổi theo LOẠI component, và thêm phép `setAttr`.

| Loại | Nhận ra khi | Ô thuộc tính HTML | Style inline |
| --- | --- | --- | --- |
| Ảnh | `<img>` | `src`, `alt`, `width`, `height`, `align`, `border`, `title` + **link = `href` của `<a>` bao ngoài** | `width`, `height`, `border` |
| Nút | `<a>` có nền / đệm / viền / `display:inline-block` | `href`, `target`, `title` + **căn lề = `align` của khối chứa** | màu, nền, cỡ chữ, đậm, đệm, viền, bo góc, canh chữ, gạch chân |
| Liên kết | `<a>` còn lại | như nút | màu, cỡ chữ, đậm, gạch chân |
| Đường kẻ | `<hr>`; khối rỗng có `border-top`/`border-bottom`; khối rỗng cao ≤ 4px có nền | `width`, `size`, `align`, `color` (`<hr>`), `height` (ô) | `border-top`, `border-bottom`, `height`, `background-color`, `margin`, `width` |
| Khoảng trống | `div`/`td`/`th`/`p` rỗng (kể cả chỉ `&nbsp;`) có `height` hoặc `line-height` | `height` (ô) | `height`, `line-height`, `font-size` |
| Khung chứa | `table`/`tr`/`td`/`th`/`div`/`center` | `width`, `height`, `align`, `valign`, `bgcolor`, `border`, `cellpadding`, `cellspacing` (theo thẻ) | `width`, `padding`, `background-color`, `border`, `text-align`, `vertical-align` |
| Chữ | còn lại | `align` (`p`) | font, cỡ, đậm, nghiêng, màu, canh, dòng, đệm, lề |

- `core/src/mail-components.mjs` — `componentKindOf` + `COMPONENT_PANELS` (Phase 5 thêm bộ sinh HTML vào đây).
- `core/src/mail-design-contract.mjs` — `ATTRIBUTES` mở rộng (`tr`, `hr`, `div`, `p`, `td@height`, `img@border`),
  nhóm style `divider`/`spacer`, `ATTRIBUTE_ENUMS`, `isValidAttrValue` (độ dài `\d{1,4}%?`, màu, liệt kê,
  URL; `''` = xoá).
- `core/src/mail-html.mjs` — `caps.setAttr`, `attrLocks` (thuộc tính do entity sinh ra → lý do), `kind`.
- `core/src/mail-edit.mjs` — `planMailAttr`; gom phần splice chung với `planMailStyle`.
- Webview — mục «Thuộc tính HTML», ô liệt kê là ô chọn, ô màu có bảng màu; ô dùng chung một hàm dựng
  và không gửi lại cùng một giá trị hai lần (Enter rồi rời ô).

### Quyết định

1. **Loại SUY RA, không khai.** Mẫu mail chỉ là HTML. Suy sai chỉ làm hiện nhầm nhóm ô; phép ghi vẫn
   đi qua whitelist theo THẺ — không có đường ghi thuộc tính lạ.
2. **Link của ảnh và căn lề của nút sửa ở THẺ CHA** — đó là chỗ HTML mail thật khai chúng. Ảnh chưa
   bọc `<a>` thì chưa thêm link được: cần chèn phần tử (Phase 5).
3. **Kiểm theo kiểu**, không chỉ theo ký tự: `width="600px"` hợp lệ về HTML nhưng Outlook bỏ qua.
4. **Giá trị thuộc tính ghi nguyên văn, không escape `&`**: `href="{!alink}&n=1"` phải khứ hồi y hệt.
   An toàn nhờ bộ kiểm (`"<>`, URL chạy mã, tham chiếu ký tự trong URL đều bị chặn).
5. Thuộc tính không nháy (`width=600`) ghi lại thành nháy kép; xoá thuộc tính kéo theo khoảng trắng đứng trước.

### Kiểm chứng

- `node core/test/run.mjs` **2303/2303** · `node extension/test/run.mjs` **350/350**.
- Test mới: `test-mail-components.mjs` (suy loại, gồm `display:{!token}`, ô trống không khai cao, khối chỉ
  `&nbsp;`); `setAttr` khứ hồi trong `test-mail-edit.mjs` (không nháy, thêm, xoá, `href` giữ `&`, link
  thẻ cha, căn lề thẻ cha, ô có style bị entity cắt, action từ Include, khoá do entity); host: dữ liệu
  `render` mới, `applySplice` đúng nhãn, giá trị sai kiểu chặn ở cửa vào.
- Corpus FBISP24: phân loại 1874 phần tử — khung chứa 1454, khung tài liệu 163, chữ 138, liên kết 118,
  đường kẻ 1; `setAttr` khứ hồi **102/102** (27 edit vào file Include); 0 thuộc tính bị khoá.
- Webview trong trình duyệt (fixture có ảnh/nút/đường kẻ/khoảng trống): mỗi loại hiện đúng nhóm ô,
  ảnh có ô link thẻ cha, nút có ô căn lề thẻ cha (ô chọn), Enter + rời ô gửi đúng một `setAttr`.

### Giới hạn

- Corpus FBISP24 là mail duyệt chứng từ (bảng) — hầu như không có ảnh/nút/khoảng trống; ba loại đó mới
  kiểm trên fixture.
- Nút dựng bằng `<td bgcolor>` + `<a>` trơn được nhận là **liên kết** (vẫn sửa được `href` và căn lề ô).
- ~~Ảnh chưa bọc link không thêm link được~~ — `wrapLink` ở Phase 5.
- Chưa chạy trong VS Code thật.

Commit: **`1a664c6`** trên `feat/email-designer` (kiểm trong worktree tạm: core 2302/2302, extension 350/350).

---

## Phase 5 — Thêm / xoá / di chuyển

### Đã làm

| Thao tác | Trên webview | Kế hoạch (core) | Ghi |
| --- | --- | --- | --- |
| Xoá | nút **Xoá**, phím **Delete** | `planMailRemove` — trọn cây; phần tử đứng một mình trên dòng thì bỏ cả dòng | 1 edit · hỏi xác nhận theo `fboDesigner.confirmDelete` |
| Lên / xuống | nút **▲ Lên** / **▼ Xuống** | `planMailMove {direction}` — đổi chỗ với anh em liền kề, chữ ở giữa đứng yên | 1 splice |
| Kéo thả phần tử | nhấn giữ phần tử ĐANG CHỌN, rê > 5px, vạch chỉ chỗ thả | `planMailMove {targetId, position}` | 2 edit, 1 mục hoàn tác |
| Chèn component | palette bên trái (kéo thả hoặc bấm) + ô chọn «Chèn … trước/sau/vào cuối» | `planMailInsert` + `componentHtml` | 1 edit |
| Bọc liên kết cho ảnh | ô href + **Bọc liên kết** | `planMailWrapLink` | 2 điểm chèn |

Mọi kế hoạch cấu trúc trả thêm **`selectId`** — id MỚI của phần tử người dùng đang cầm (id là số thứ
tự thẻ mở, chèn/xoá/di chuyển làm dồn số). Host đưa nó vào bản vẽ kế tiếp nên khung chọn đi theo đúng
phần tử: xoá → anh em đứng trước (không có thì cha), chèn → phần tử vừa chèn, di chuyển → chính nó,
bọc liên kết → chính ảnh.

Caps mới do core tính, webview chỉ đọc: `caps.removeElement`/`moveElement`/`insertComponent`/`wrapLink`,
`moveTargets {up, down}`, `insertPositions {before, after, append}` (mỗi ô `true` hoặc lý do).

### Component chèn được (`core/src/mail-components.mjs`)

| Loại | HTML sinh ra |
| --- | --- |
| Chữ / Tiêu đề | `<p>` / `<h2>` style inline (font, cỡ, dòng, màu, lề) |
| Ảnh | `<img src="" alt width style="display:block;border:0;">` |
| Liên kết | `<a href="#" style>` |
| Nút | «bulletproof button»: `<table role="presentation"><tr><td align bgcolor style="border-radius"><a style="display:inline-block;padding">` |
| Đường kẻ | `<hr style="border:0;border-top:1px solid">` |
| Khoảng trống | `<div style="height;line-height;font-size:0">&#160;</div>` |
| Khung chứa / Phần | bảng layout một ô có đệm / có nền |
| Hai cột | bảng layout hai ô `width="50%" valign="top"` |
| Bảng | bảng dữ liệu 2×2 `border-collapse` |

`variable`, `condition`, `dynamicTable` khai trong hợp đồng nhưng CHƯA có bộ sinh — chèn bị từ chối (Phase 6+).

### Quyết định

1. **`<table>` nằm trọn trong một part là KHỐI** (trước: chỉ khi lồng trong ô/khối). Khối người dùng
   vừa chèn — nút kiểu bảng, hai cột — phải xoá/di chuyển được; hàng/ô bên trong vẫn là cấu trúc.
2. **Chỗ chèn:** trước/sau chỉ quanh khối và nội tuyến (không cạnh `tr`/`td`); vào cuối chỉ `td`,
   `th`, `div`, `center`, `li` — không `p` (khối trong `<p>` là HTML sai); thẻ đóng phải cùng part.
3. **Kéo thả không vượt part** và **không giữa hai file nguồn** (Message.xml ↔ Include) — cả hai là
   ranh giới của mẫu; muốn thì cắt dán trong XML.
4. **Đích kéo thả cũng được so dấu vân tay** ở host, không riêng phần tử bị kéo.
5. **Phím Delete:** `when` của `fboDesigner.deleteSelection` thêm `fboDesigner.mail`. Phím tắt ấy chặn
   Delete cả trong ô nhập của bảng thuộc tính, nên webview đang focus ô chữ thì tự xoá ký tự thay vì
   xoá phần tử.
6. **Mảnh HTML dùng `&#160;`**, không `&nbsp;` (bộ bung entity báo `&nbsp;` trong CDATA là chưa khai);
   không mảnh nào chứa `]]>`.
7. Phép bảng của «Xem mail» (`addColumn`/`resizeColumn`/`addRow`) CHƯA nối vào designer — báo chưa hỗ trợ.

### Kiểm chứng

- `node core/test/run.mjs` **2376/2376** · `node extension/test/run.mjs` **365/365**.
- `core/test/test-mail-structure.mjs` (sửa khứ hồi): xoá (cả cây, không dòng trắng, ô bảng/khung/entity
  bị chặn, action từ Include), lên/xuống (`selectId` tính cả cây anh em), kéo thả (trước h2, vào cuối ô,
  vào chính nó / sang part khác / cạnh ô bị chặn, đúng chỗ cũ → noop), chèn đủ 11 component (dựng lại
  sạch, chọn đúng gốc), bọc liên kết. Host: hỏi/huỷ/tắt xác nhận xoá, `selectId`, chèn, kéo thả hai
  edit, đích cũ bị chặn.
- Corpus FBISP24 (39 biến thể): khứ hồi xoá **68/68**, lên **64/64**, chèn chữ vào cuối **68/68**, chèn nút
  **34/34**, kéo thả vào cuối **31/31**. Một ca xoá đổi số cảnh báo tokenizer 1 → 0 — đúng: khối bị xoá
  chính là chỗ chứa HTML sai `<p><div></div></p>` sinh ra cảnh báo.
- Webview trong trình duyệt: palette 11 mục; nút Lên/Xuống/Xoá bật/tắt theo caps; ô vị trí tự chọn
  «vào cuối» khi chọn ô bảng; Delete trong ô nhập xoá ký tự (`abc` → `ac`), ngoài ô nhập gửi
  `removeElement`; kéo từ palette vào ô hiện «vào cuối `<td>`» rồi gửi `insertComponent`; kéo `<hr>`
  lên h2 hiện «trước `<h2>`» rồi gửi `moveElement`; cú click ngay sau khi kéo bị bỏ qua.

### Giới hạn

- Chỉ kéo được phần tử ĐANG CHỌN, một phần tử mỗi lần.
- Mảnh chèn và phần tử di chuyển không tự xuống dòng/thụt lề — XML nguồn nối liền trên dòng đích.
- Ảnh mới chèn có `src=""` — đặt ảnh ở ô `src`.
- Chưa chạy trong VS Code thật: phím Delete qua keybinding, kéo thả HTML5 trong webview thật.

Commit: **`0f8a00b`** trên `feat/email-designer` (kiểm trong worktree tạm: core 2375/2375, extension 365/365).

---

## Phase 6 — Biến và dữ liệu mẫu

### Đã làm

**Ba chế độ hiện biến** (thanh công cụ «Biến: …») — CHỈ đổi bản vẽ, nguồn giữ nguyên `{!tên}`:

| Chế độ | `{!h_so_ct}` (khai trong `<fields>`) | `{!so_ct}` (dữ liệu lúc gửi) |
| --- | --- | --- |
| nhãn (mặc định) | chữ «Số phiếu» — như runtime | chip `{!so_ct}` |
| `{!tên}` | chip `{!h_so_ct}` | chip `{!so_ct}` |
| dữ liệu mẫu | chữ «Số phiếu» | giá trị mẫu; thiếu thì chip, ghi rõ «chưa có trong dữ liệu mẫu» |

- **Chip** là `<span data-fbo-var>` style inline, KHÔNG mang `data-fbo-el` — bấm chip là chọn phần tử
  chứa nó; rê chuột thấy nhãn hoặc nguồn của biến.
- **Theo ngữ cảnh** (`scanMailTokens`): token trong chữ → chip hoặc chữ đã escape; trong thuộc tính
  (`href="{!alink}&n=1"`, `style="display:{!slink}"`) → chỉ chữ đã escape, không bao giờ chip; trong
  `<style>`/`<title>` → chỉ chữ không mang `<>`. Token nằm trong phần bị gỡ khi làm sạch (`on*`, URL chạy
  mã) bị bỏ qua.
- **«Biến trong mẫu»**: mọi biến của (action, body) đang vẽ — nhãn hay dữ liệu, bao nhiêu lần, ở chữ hay
  thuộc tính. Bấm để chèn `{!tên}` vào ô đang soạn: Chữ, `href`, `src`, `alt`, `title` (không `width`/
  `height` — bộ kiểm theo kiểu chặn token ở đó). Ghi vẫn đi qua «Ghi chữ» / `setAttr` → một mục hoàn tác.
- **Dữ liệu mẫu**: JSON `{ "so_ct": "PN0001", "t_tien": 12500000, "detail": [ { "ma_vt": "VT01" } ] }`.
  «Tạo khung từ biến» ghép mọi biến dữ liệu còn thiếu, giữ giá trị đã gõ; «Áp dụng & xem» lưu và
  chuyển sang chế độ dữ liệu mẫu; JSON sai → lý do hiện ngay dưới ô, bản vẽ mới không đè lên chữ đang gõ.
- **Lấy từ chứng từ**: ô `stt_rec` + `contactID` → hỏi xác nhận → ghi tạm `dmxn` → dò bảng → chạy
  `master` rồi `footer`/`detail` (có `@@language` từ `d_language`) → áp mặt nạ từ bảng format
  cuối của detail/footer → nếu mẫu có `{!in_words}` thì `ReadCurrency` → đổ JSON mẫu
  (xem `mail-sample.mjs` / `mail-sample-host.js`). Lỗi SQL hiện dialog overlay.
- `core/src/mail-variables.mjs` — `scanMailTokens`, `mailVariables`, `parseMailSample`, `formatSampleScalar`,
  `sampleValueOf`, `sampleSkeleton`, `tokenPatches`. Hợp đồng: `PREVIEW_MODES`, `setPreview`,
  `setSampleData`, `loadMailSample`, `sampleError`.

### Quyết định

1. **Dữ liệu mẫu sống ở `workspaceState`** của VS Code, theo file × action — không vào Message.xml, và
   không thành file cạnh nó (một file lạ trong `Options\` là thứ dễ theo bản triển khai sang máy khách).
2. **Object phẳng**: tên biến FBO là `\w+`, không có đường dẫn `a.b`.
3. **Dòng lặp `<detail>`** đọc `detail[0]`: bản vẽ designer chỉ có một dòng mẫu — nhân dòng là nhân id
   phần tử, khung chọn không còn biết trỏ vào bản nào. Xem nhiều dòng thuộc bản xem trước (Phase 8).
4. **Nhãn thắng dữ liệu mẫu trùng tên** — runtime cũng thay `<fields>` trước.
5. **Số hiện có phân nhóm nghìn** (`12500000` → `12,500,000`): mail không mang mặt nạ định dạng field như
   Dir/Grid, nên đây là quy ước của bản xem.
6. **Chèn biến là việc của ô soạn**, không phải một phép sửa mới. Component `variable` vẫn không có bộ
   sinh: biến luôn nằm trong chữ hoặc thuộc tính của một phần tử khác.
7. Chèn biến lấy ô ĐANG focus trước, rồi ô focus gần nhất — không dựa riêng vào sự kiện `focusin` (khung
   webview chưa có focus hệ thống thì sự kiện không nổ; đo được khi kiểm trong trình duyệt).
8. Không làm engine điều kiện/bảng động: mail FBO dùng `display:{!slink}` và `<detail>` cho việc đó — cả hai
   đã hiện dưới dạng biến dữ liệu.

### Kiểm chứng

- `node core/test/run.mjs` **2426/2426** · `node extension/test/run.mjs` **378/378**.
- `core/test/test-mail-variables.mjs`: ngữ cảnh chữ/thuộc tính/raw; nhãn vs dữ liệu; từ chối JSON sai
  kèm lý do (JSON hỏng, mảng, giá trị lồng, tên sai, detail sai hình dạng, quá số dòng); định dạng số;
  `detail[0]`; khung; ba chế độ (số dấu phần tử không đổi); giá trị mẫu không thoát khỏi thuộc tính;
  `<title>`; token trong `onclick` bị gỡ không làm vỡ patch; nguồn giữ nguyên. Host: `setPreview`, JSON hỏng
  → `sampleError` không vẽ lại, JSON đúng → chuyển chế độ + escape, không một phép ghi nào, nhớ chế độ và
  dữ liệu khi mở lại, xoá dữ liệu mẫu.
- Corpus FBISP24 (39 biến thể): 1528 biến (546 nhãn, 982 dữ liệu; 1273 trong chữ, 255 trong thuộc tính);
  ba chế độ không lệch số dấu `data-fbo-el` ở biến thể nào; chế độ nhãn 737 chip; điền đủ khung dữ liệu
  mẫu → 0 chip còn lại.
- Webview trong trình duyệt: danh sách 8 biến (nhãn/dữ liệu, part), 4 chip dữ liệu trong bản vẽ, bấm chip
  chọn `<h2>` chứa nó, đổi chế độ gửi `setPreview`, «Tạo khung» giữ giá trị đã gõ và thêm `detail`,
  «Áp dụng» gửi `setSampleData`, `sampleError` hiện lý do, bản vẽ mới không đè ô đang gõ dở; bấm biến
  chèn `{!so_ct}` vào ô Chữ đúng vị trí con trỏ (giữ focus) và `{!order_url}` vào đầu `href`, rồi gửi đúng
  `setText`/`setAttr`; ô `width` không nhận biến. Lần kiểm đầu lộ lỗi chèn khi khung chưa có focus hệ
  thống — sửa bằng quyết định 7 ở trên, kiểm lại đạt.

### Giới hạn

- Không xem nhiều dòng `<detail>` cùng lúc trên bản vẽ thiết kế (bản «Xem trước: dữ liệu mẫu» thì nhân
  dòng theo `detail[]`).
- Lấy dữ liệu thật cần program có connection string + `sqlcmd`, action có `<query id="report">`, và
  người dùng xác nhận ghi tạm `dmxn`.
- Chưa chạy trong VS Code thật trên mọi corpus.

Commit: **`1c28e7b`** trên `feat/email-designer` (kiểm trong worktree tạm: core 2425/2425, extension 378/378).

---

## Phase 7 — Code ↔ Designer

### Đã làm

Sửa hai chiều đã có từ Phase 3 (custom text editor dùng CHUNG một TextDocument). Phase 7 bổ sung
những đường VS Code không tự lo, và nối nốt các phép bảng còn nằm riêng ở «Xem mail».

| Chiều | Cơ chế | Chống vòng lặp |
| --- | --- | --- |
| Designer → XML (sửa) | kế hoạch → `applySplice` → TextDocument | chốt `editing` + debounce 40ms; đổi document chỉ dẫn tới VẼ LẠI, không bao giờ tới ghi |
| XML → Designer (sửa) | `onDidChangeTextDocument` của Message.xml và mọi Include đang mở → vẽ lại | lượt vẽ không ghi gì |
| Include đổi trên đĩa (không mở) | **FileSystemWatcher** theo từng file góp nội dung vào bản vẽ → vẽ lại | file đang mở thì bỏ sự kiện watcher (thay đổi đã tới qua document); Message.xml không cần watcher |
| Designer → XML (chọn, «Bám XML») | chọn phần tử → vùng chọn của XML ĐANG MỞ, nhìn thấy được, nhảy tới thẻ mở — không lấy focus, không mở tab | cờ `syncingEditor` bỏ sự kiện đổi vùng chọn do chính phép đặt sinh ra |
| XML → Designer (chọn) | con trỏ XML (debounce 80ms) → phần tử SÂU NHẤT chứa nó → `reveal` | webview chọn mà KHÔNG gửi `select` ngược; trúng phần tử đang chọn thì không gửi; văn bản đã đổi mà chưa vẽ lại thì bỏ qua |

**Mục «Bảng»** trong bảng thuộc tính — nối các phép có sẵn của «Xem mail» qua vai trò bảng của phần tử
(`mailTableContext`): đổi bề rộng cột (chỉ khi cột khai `width:Npx` ngay trên ô tiêu đề), nhân bản cột
(ô tiêu đề + ô dòng mẫu, tăng `colspan` footer nếu có), nhân bản dòng header/footer. Ghi chú của plan
(vd footer không có `colspan`) hiện sau khi ghi.

- Core: `mail-html.mjs#mailElementAtSource`, `mail-structure.mjs#mailTableContext`.
- Hợp đồng: `setFollow`; host → webview `reveal`; `render.follow`; phần tử mang `table`.
- Webview: công tắc «Bám XML» trên thanh công cụ, mục «Bảng».

### Quyết định

1. **Không thêm kênh đồng bộ sửa mới** — hai phía đã chung một TextDocument; chỉ bù phần VS Code không
   báo (Include trên đĩa) và phần nó không biết (vùng chọn ↔ phần tử).
2. **Hai chốt độc lập** cho vùng chọn (cờ + so id), không dựa riêng vào thời gian: một chốt lỡ nhịp thì
   chốt kia vẫn chặn.
3. **Bám không giành chỗ**: chỉ di chuyển XML đang nhìn thấy, không mở tab, không lấy focus khỏi designer.
4. Vị trí nguồn nằm trong giá trị `<!ENTITY>` bung ở nhiều chỗ → lấy lần đầu rơi vào bản vẽ hiện tại.
5. **Phép bảng dùng lại nguyên plan của «Xem mail»** — luật cột theo `<detail>`, chỉ `width` trực tiếp,
   không nhân dòng detail; không viết phép bảng thứ hai.
6. **Panel «Xem mail» giữ nguyên.** Nó còn so sánh hai biến thể cạnh nhau và kéo giãn cột bằng tay cầm
   — hai việc designer chưa có. Hai lối ghi cấu trúc bảng qua CÙNG plan và cùng `mail-apply.js` nên không
   thể lệch luật, nhưng là hai giao diện cho một việc — **cần chốt**: bỏ phần sửa bảng khỏi panel (chỉ còn
   xem/so sánh), hay giữ cả hai.

### Kiểm chứng

- `node core/test/run.mjs` **2446/2446** · `node extension/test/run.mjs` **405/405**.
- `core/test/test-mail-sync.mjs`: con trỏ → phần tử (chữ, thẻ mở, lồng sâu, chữ ngay sau thẻ đóng con,
  ô tiêu đề, dòng mẫu, `<fields>` → null, giá trị ENTITY trong DOCTYPE, đường dẫn khác kiểu gạch/hoa, Include
  của action khác); vai trò bảng (`width` trực tiếp dù style bị entity cắt, cột không `width`, dòng mẫu,
  hàng header, dòng detail không nhân bản, mẫu không có bảng).
- Host: phép bảng (nhãn, chỉ thay đúng chữ số, hai edit khi nhân bản cột, note `colspan`, dòng không có);
  bám XML hai chiều (reveal một lần, không gửi lại, `<fields>` không đổi lựa chọn, designer → XML đặt
  vùng chọn vào `<td`, sự kiện tự sinh không dội, người dùng đổi con trỏ thì theo, tắt bám, văn bản đã đổi
  thì không đoán); watcher (hai nhịp → một lần vẽ, bỏ khi Include đang mở, gỡ khi đóng editor); sửa từ
  designer với hai nhịp đổi document → đúng một lượt vẽ, không lượt vẽ hay phép ghi nào tự sinh thêm.
- Corpus FBISP24 (39 biến thể): 356 ô mang vai trò cột (đều có `width` trực tiếp), 338 dòng nhân bản được;
  khứ hồi nguồn → phần tử **1810/1810** với phần tử nằm trong CDATA (519 trong file Include); phần tử sinh
  từ CHỮ của entity (`&CssClass;` → `<head><style>`) 32/64 — giới hạn có chủ ý, xem dưới.
- Webview trong trình duyệt: công tắc gửi `setFollow`; ô tiêu đề hiện «Cột 1 · 100px» + «Dòng 1 (header)»;
  Enter + rời ô gửi đúng một `resizeColumn`; «+ Cột», «+ Dòng» gửi đúng số thứ tự; ô không `width` khoá ô
  nhập kèm lý do; ô dòng mẫu hiện «(dòng mẫu)», không có «+ Dòng»; h2 không có mục «Bảng»; `reveal` chọn
  phần tử mà không gửi `select` ngược, `rev` cũ bị bỏ qua.

### Giới hạn

- Con trỏ trong phần do CHỮ của entity sinh ra (mảnh text) trỏ về đầu mảnh — không phân biệt được các
  thẻ bên trong một `&CssClass;`.
- Con trỏ XML ở mẫu/biến thể KHÁC cái đang vẽ không tự đổi mẫu trên designer.
- Chưa chạy trong VS Code thật: sự kiện vùng chọn và watcher thật.

Commit: **`2598d60`** trên `feat/email-designer` (kiểm trong worktree tạm: core 2445/2445, extension 405/405).

---

## Phase 8 — Hoàn thiện

### Đã làm

| Việc | Chỗ | Ghi chú |
| --- | --- | --- |
| **Xem trước đầy đủ** | `mail-html.mjs#renderMailFullPreview`, công tắc «Xem trước» | dòng mẫu `<detail>` nhân theo `sample.detail` (không có dữ liệu mẫu → một dòng); header/footer một lần; không dấu `data-fbo-el`, không phần tử → chỉ đọc; host từ chối mọi `edit` khi đang bật |
| **Kiểm tra mẫu** | `mail-lint.mjs#lintMailHtml`, mục «Kiểm tra mẫu» + huy hiệu trên thanh công cụ | lỗi HTML, thẻ bị chặn, `on*`, ảnh thiếu `src`/`alt`/`width`, liên kết rỗng/`#`, CSS mail client không đỡ (`flex`/`grid`, `position`, `float`, `url(`), vượt ngưỡng cắt thư của Gmail (102KB); bấm một vấn đề → chọn phần tử |
| **Bề rộng khung xem** | chọn «vừa cửa sổ / 600px / 375px» | nhớ bằng `vscode.setState` của webview, không qua host |
| **Phím tắt** | `Alt+↑/↓` lên/xuống · `Ctrl+Shift+↑/↓` chọn cha/con · `F2` sửa chữ | Alt+↑/↓ đọc `moveTargets` như nút ▲/▼; không bắt khi đang gõ |
| **Nhớ kết quả bung entity** | `MailDesignSession#expandCached` | khoá = văn bản Message.xml + dấu mọi Include lần trước đọc (đang mở: `version`; trên đĩa: `mtime`+`size`) |
| **Chịu lỗi** | `render` / `onMessage` | lỗi lúc vẽ → khung báo lỗi + Output; lỗi khi xử lý thông điệp → cảnh báo trỏ tới Output, không ném; lỗi JS của webview (`error`, `unhandledrejection`) → `log`; lượt vẽ > 300ms → ghi «vẽ chậm» ra Output |

- Hợp đồng: `setFullPreview { on }`; `render.fullPreview`, `render.issues`.
- `designPatches` tách khỏi `applyPatches` để bản xem trước dùng lại đúng patch của bản vẽ (nhãn,
  chip, dữ liệu mẫu, khử độc) theo từng khoảng part — không có đường vẽ thứ hai.

### Quyết định

1. **Xem trước là một chế độ của CÙNG bản vẽ, không phải panel mới** — cùng iframe sandbox không script,
   cùng patch khử độc; chỉ bỏ dấu phần tử và nhân khoảng `<detail>`.
2. **Chỉ đọc ở cả hai phía**: webview không nhận phần tử nào để chọn; host vẫn chặn `edit` (một thông điệp
   bắn trước khi bản vẽ mới tới vẫn mang id của bản vẽ cũ).
3. **Luật kiểm tra ở core, chỉ báo** — không tự sửa mẫu. Mức: `error` (không an toàn / hỏng),
   `warning` (mail client hiển thị sai), `info` (nên có). Không kiểm theo từng client cụ thể.
4. **Nhớ theo nội dung chứ không theo thời gian** — không có TTL, không có nút xoá; mọi đường đổi nội
   dung (sửa, hoàn tác, Include trên đĩa) đổi khoá.
5. Bề rộng khung là tuỳ chọn XEM của từng webview → `setState`, không vào `workspaceState`, không vào mẫu.

### Kiểm chứng

- `node core/test/run.mjs` **2474/2474** · `node extension/test/run.mjs` **421/421**.
- `core/test/test-mail-polish.mjs`: từng luật trên fixture và biến thể (script, `onclick`, ảnh thiếu
  `alt`/`width`/`src`, bốn luật CSS, `href="#"`, thẻ đóng lạc, chú thích > 102KB); xem trước 3 dòng
  VT01–VT03, header/footer một lần, khử độc, chip theo từng dòng, không dữ liệu mẫu → một dòng, bản vẽ
  thiết kế vẫn một dòng; `sampleValueOf` dòng 2 / dòng ngoài mảng.
- Host: `issues` trong render; bật xem trước → không phần tử, không dấu, `<detail>` nhân 2; `edit` khi xem
  trước bị từ chối kèm lý do; tắt → phần tử trở lại. Bung entity: đổi chế độ / biến thể / xem trước không
  bung lại; đổi Message.xml bung lại; Include đổi trên đĩa bung lại và thấy nội dung mới. Lỗi lúc vẽ → khung
  báo lỗi + Output; lỗi khi xử lý `select` không ném, báo người dùng.
- Corpus FBISP24 (39 biến thể, 238KB): bung entity 15ms; dựng + vẽ tối đa 10ms, trung bình 5ms; xem trước
  tối đa 1ms, 39/39 đúng số dòng detail, 0 dấu `data-fbo-el` lọt; kiểm tra mẫu: **5** `mail.html-structure`
  (cảnh báo HTML có sẵn từ Phase 3), không luật mail client nào khác bắn.
- Webview trong trình duyệt: huy hiệu «⚠ 4» đỏ khi có lỗi, bốn vấn đề theo thứ tự lỗi → cảnh báo → gợi ý,
  bấm vấn đề ảnh → chọn `<img>` và gửi đúng một `select`; khung 600px / 375px đúng bề rộng, 600px nằm giữa,
  «vừa cửa sổ» trả về bề rộng cũ, `setState` nhớ lựa chọn; bật «Xem trước» gửi `setFullPreview`, bản vẽ
  không dấu, 3 dòng detail, bảng thuộc tính ẩn kèm lời nhắc chỉ đọc, bấm canvas / Delete không gửi gì;
  tắt → dấu phần tử và lời nhắc cũ trở lại; `Alt+↓` gửi `moveElement down`, không bắt khi đang gõ trong ô
  Chữ; `Ctrl+Shift+↑` → `<body>`, `Ctrl+Shift+↓` → con đầu; `F2` nhận phím khi phần tử có chữ; lỗi JS → `log`.

### Giới hạn

- Luật kiểm tra là tập tối thiểu, tĩnh — không mô phỏng từng mail client, không đo ảnh, không kiểm link sống.
- Chưa có nút **gửi thử** — gửi thư ra ngoài là việc của runtime FBO, designer không giữ thông tin SMTP.
- Tắt «Xem trước» thì bỏ chọn (bản xem trước không mang phần tử); `Ctrl+Shift+↓` luôn chọn con ĐẦU.
- Trình duyệt thử chạy ở pane ẩn nên không đo được việc `F2` thực sự đặt focus — chỉ khẳng định phím được
  nhận; chưa chạy trong VS Code thật.

### Rút gọn giao diện (theo yêu cầu)

Sau Phase 8, theo yêu cầu người dùng, bốn phần bị bỏ khỏi webview:

| Bỏ | Còn lối nào |
| --- | --- |
| Palette bên trái (`Thêm` / `Nội dung` / `Bố cục`) | **Không còn** — chèn component mất lối vào giao diện |
| Nút «Hoàn tác», «Làm lại» | `Ctrl+Z` / `Ctrl+Y` |
| Ô «Đi tới XML…» | `Ctrl+click` hoặc bấm đúp lên phần tử |
| Mục «Cấu trúc» (▲ Lên, ▼ Xuống, Xoá, Chèn, Bọc liên kết) | `Alt+↑/↓` và kéo thả để di chuyển; `Del` để xoá. **Chèn** và **bọc liên kết** không còn lối vào |
| Mục «Biến trong mẫu» | Ba chế độ hiện biến trên thanh công cụ vẫn còn; **bấm để chèn `{!tên}`** không còn |
| Mục «Bảng» (bề rộng cột, + Cột, + Dòng) | **Không còn** — phép cột/dòng chỉ còn ở panel «Xem mail» |
| Mục «Chữ» (ô soạn + «Ghi chữ», `F2`) | **Không còn** — sửa nội dung chữ phải làm trong XML |
| Hai mục «Thuộc tính HTML» + «Style inline» | Gộp thành **một** mục «Định dạng» — không mất ô nào |

Chỉ cắt ở webview. Core và host giữ nguyên mọi phép (`insertComponent`, `wrapLink`, `moveElement`), nên
`components` và `variables` vẫn đi trong payload `render` — mở lại giao diện cho chúng là việc thêm HTML,
không phải viết lại luật.

---

## Phase 9 — Bám XML theo mẫu, chế độ xem trước, và hai luật sai

### Luật biến CÓ VÙNG (sửa lỗi)

`<fields>` chỉ áp cho `<header>`/`<footer>`. Trong `<detail>`, cùng một tên là GIÁ TRỊ của dòng, không
phải nhãn cột. Mẫu thật dùng đúng cặp đó: `{!so_luong}` ở header là tiêu đề cột "Số lượng", ở detail là
số lượng của từng dòng. Trước Phase 9 designer thay nhãn ở cả hai chỗ, nên dòng dữ liệu hiện ra một dãy
tiêu đề cột. Corpus FBISP24 có **22 chỗ** như vậy (PurchaseRequisition, PQApproval, BIOAApproval…).

- `mail-variables.mjs#mailTokenKind(name, part, labels)` — một chỗ duy nhất quyết định vai.
- `mailVariables` vì thế trả HAI mục cho một tên có mặt ở cả hai vùng (nhãn ở header, dữ liệu ở detail),
  và khung dữ liệu mẫu xin cột cho dòng detail.
- DWF không có phần render mail (đã tìm: không có file C# nào chạm `data-message`), nên luật này lấy từ
  chính Message.xml của corpus — ghi lại ngay trong `mail-variables.mjs`.

### Bấm trúng `{!biến}` thì con trỏ XML vào ĐÚNG token (sửa lỗi)

Trước đây bấm vào chữ "Số phiếu" trên bản vẽ thì XML nhảy tới thẻ `<td>` chứa nó. Nay bản vẽ bọc mỗi
biến trong `<span data-fbo-var data-fbo-tok="i">` — kể cả khi token ĐÃ được thay bằng nhãn hay giá trị
mẫu — nên webview gửi kèm `tokenIndex`, host quy về dải nguồn bằng `mail-html.mjs#mailTokenClearRange`.
Bản xem trước đầy đủ không mang dấu ấy (nó là bản mail thật).

### Bám XML theo MẪU (hai chiều)

| Chiều | Cư xử |
| --- | --- |
| XML → Designer | Con trỏ nhảy sang `<action>` (hoặc biến thể) khác thì designer ĐỔI MẪU theo rồi chọn phần tử dưới con trỏ. Trước Phase 9 nó im lặng bỏ qua — giới hạn đã ghi ở Phase 7 |
| Designer → XML | Chọn mẫu khác trên thanh công cụ thì XML đang mở nhảy tới thẻ mở `<action id="…">` ấy. Chỉ khi ĐỔI MẪU — đổi ngôn ngữ hay biến thể không kéo XML đi |

- `mail-template.mjs#mailLocationAt` / `#mailLocationAtSource` — vị trí → (action, body); action tiêm từ
  file Include cũng ra đúng.
- `scanMailActions` nay trả thêm toạ độ tuyệt đối (`start`, `end`, `bodyRanges`).

### Chế độ xem trước gộp vào ô chọn biến

Bỏ tick «Xem trước». Ô chế độ còn ba lựa chọn, trong đó **«Xem trước: dữ liệu mẫu»** chính là bản xem
trước đầy đủ — nhân dòng detail, bỏ dấu phần tử, chỉ đọc. Gõ dữ liệu mẫu rồi «Áp dụng & xem» cũng vào
thẳng chế độ ấy. Thông điệp `setFullPreview` đã bỏ khỏi hợp đồng.

### Combobox mẫu mail có nút sổ

Thêm nút `▾`: sổ TOÀN BỘ danh sách bất kể ô đang gõ gì (bấm lần nữa để đóng), vẫn gõ để tìm theo tên
hoặc id như cũ.

### Kiểm chứng

- `node core/test/run.mjs` **2500/2500** · `node extension/test/run.mjs` **435/435**.
- Core: luật vùng (hai mục cho một tên, nhãn không lọt xuống dòng mẫu, khung dữ liệu mẫu xin cột detail);
  con trỏ nguồn → mẫu (trong body, trong `<fields>`, trên thẻ mở, file Include, ngoài `<template>`, file lạ);
  dải nguồn của token (chữ, dòng mẫu, trong `href`, số thứ tự không có).
- Host: con trỏ XML sang mẫu khác → đổi mẫu + chọn đúng phần tử; sang biến thể khác của mẫu khác → đổi cả
  hai; đổi mẫu trên designer → XML nhảy tới `<action id="Alert" …>`; đổi ngôn ngữ thì không; `tokenIndex`
  → XML đúng `{!h_so_ct}`, không có thì vẫn là thẻ `<td>`, số thứ tự rác không ném; ba chế độ hiện biến
  (sample = chỉ đọc, label/token = sửa được).
- Corpus FBISP24 (39 biến thể): **22** token trong `<detail>` đổi vai từ nhãn sang dữ liệu; khứ hồi token →
  nguồn **1750/1750**; vị trí token → đúng (action, body) **1750/1750**; vẽ tối đa 1ms.
- Trình duyệt: nút `▾` sổ cả danh sách rồi đóng lại, gõ tên/id vẫn lọc đúng một mục, không khớp thì ẩn;
  bấm vào chữ của biến gửi `tokenIndex` đúng, bấm chỗ khác gửi `null`; chọn «Xem trước: dữ liệu mẫu» →
  chỉ đọc, ba dòng detail, không còn dấu token; về «Biến: nhãn» → sửa lại được. Không lỗi JS.

### Giới hạn

- Đổi mẫu theo con trỏ XML LÀM MẤT lựa chọn phần tử cũ (bản vẽ mới, id khác).
- `<footer>` dùng chung luật nhãn với `<header>`; nếu có mẫu nào đặt dữ liệu dòng ở footer thì luật này
  hiện nhãn — chưa gặp trên corpus.

---

**«Thuộc tính HTML» và «Style inline» KHÔNG trùng nhau** — đó là lý do gộp chứ không bỏ. Chỉ 6 tên chồng
nhau (`width`, `height`, `border`, `align`↔`text-align`, `valign`↔`vertical-align`, `bgcolor`↔`background-color`);
`href`/`src`/`alt`/`target`/`cellpadding` chỉ có ở thuộc tính, còn font/màu chữ/padding/margin/bo góc chỉ có ở
style. Trong mail hai cách viết cũng không thay nhau được — chính `mail.img-width` cảnh báo ảnh thiếu THUỘC
TÍNH `width` vì Outlook không đọc CSS ở chỗ đó.

Bảng thuộc tính sau khi rút gọn: **Định dạng · Kiểm tra mẫu · Dữ liệu mẫu**.

Kiểm (lúc rút gọn): core 2474/2474, extension 421/421; trong trình duyệt không còn id nào của phần đã bỏ, phím tắt
(`Ctrl+Z`, `Ctrl+Shift+↑/↓`, `Alt+↓`, `Del`) vẫn gửi đúng thông điệp, chọn và kéo trên canvas vẫn chạy,
không lỗi JS.
