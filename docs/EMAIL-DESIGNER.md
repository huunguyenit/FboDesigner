# Email Designer — Phase 0 (baseline) và Phase 2 (kiến trúc)

> Trạng thái: **Phase 0 · 2 · 3 (MVP) · 4 (Component) xong** — xem hai mục cuối file. Ghi ngày
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
- Ảnh chưa bọc link không thêm link được (Phase 5).
- Chưa chạy trong VS Code thật.
