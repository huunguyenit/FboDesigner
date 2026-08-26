# Changelog

Định dạng dựa trên [Keep a Changelog](https://keepachangelog.com/).

## [Chưa phát hành]

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
