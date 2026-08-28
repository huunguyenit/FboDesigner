# Tiện ích đang thảo luận

Ghi lại phần thảo luận bắt đầu ngày 2026-08-28. Đây là ý tưởng và khảo sát kiến trúc, **không
phải kế hoạch đã chốt** cho tới khi có dòng "ĐÃ THỰC THI" ngay trong mục đó. Thứ tự ưu tiên do
người dùng đặt; phần "khảo sát" là những gì đã đọc được trong codebase hiện tại để đánh giá độ
khó. Mục #2 (v2) và #5 đã thực thi (xem bên dưới); #1, #3, #4, #6, #7 còn ở dạng thảo luận.

---

## Rào cản chung — cần một tầng SQL mà dự án đang cố tình không có

`core/src/filter-declare.mjs:43` ghi rõ luật của core: *"thuần, không chạm đĩa, không nối
database"*. `extension/package.json` có `dependencies: {}` — README bán điểm này là tính năng
("Không phụ thuộc vào npm install"). Thêm driver `mssql` là phá luật đó.

Hướng khả thi: dùng **`sqlcmd`** qua `child_process` (đã có sẵn trên máy tại
`C:\Program Files\Microsoft SQL Server\Client SDK\ODBC\170\Tools\Binn\SQLCMD.EXE`) — zero npm
dep, giữ nguyên kiến trúc "core sinh text SQL, extension mới là bên chạy" — đúng mô hình
`filter-declare.mjs` → `filter-host.js` đã có. Cả bốn mục bên dưới đều cần tầng này, trừ nhịp 1
của mục 4.

Hai điểm cắm đã có sẵn, không cần sửa renderer:

- `renderControl` (`core/src/control.mjs:192`) gắn `data-field-name="<tên cột đã phân giải %l>"`
  lên **mọi** input — chỗ để bơm giá trị mẫu vào (#1) hoặc đọc giá trị debug ra (#3).
- `scanRoot` (`core/src/spans.mjs:260`) đã trả về `attrs`, tức `attrs.database` cho mục #2 lấy
  được ngay từ `<dir>`/`<grid database="Sys">`.

---

## 1. Preview theo dữ liệu mẫu

Việc thật: `select top N * from <bảng>`, cho chọn dòng, bơm giá trị vào input theo
`data-field-name`.

Cái khó là **xác định bảng nguồn**, khác nhau theo loại file:

| Loại | Nguồn bảng | Độ chắc |
|---|---|---|
| `Dir/` (danh mục) | câu query trong controller | đọc được |
| `Grid` Voucher | `<partition table="c21$000000">` | đọc được |
| `Grid` khác | câu `Finding` | **370/401 file trong FBISP24 là `<Encrypted>`** — xem `filter-declare.mjs:92` |

→ Phạm vi v1 nên là **Dir trước**, Grid mã hoá thì hỏi tay tên bảng, không đoán.

## 2. Sinh code add column

Khi dev thêm `<field>` vào file nhưng cột chưa có trên database. Xác định database dựa vào
`dir|grid@database="Sys"` (mặc định `app`), tự xác định field vừa thêm và sinh script.

**ĐÃ THỰC THI v2 (2026-08-28).** Logic thuần nằm ở
[`core/src/add-column.mjs`](../core/src/add-column.mjs) +
[`core/src/sql-config.mjs`](../core/src/sql-config.mjs) (test:
[`test-add-column.mjs`](../core/test/test-add-column.mjs),
[`test-sql-config.mjs`](../core/test/test-sql-config.mjs)); lệnh VS Code
`FBO Designer: Sinh script thêm cột cho field mới` nằm ở
[`extension/src/add-column-host.js`](../extension/src/add-column-host.js), tầng chạy `sqlcmd` ở
[`extension/src/sql-host.js`](../extension/src/sql-host.js) — ĐÂY LÀ `extension/src/sql-host.js`
mà mục "Rào cản chung" đầu tài liệu nói tới, dùng chung được cho #1/#3/#4.

v1 (không nối DB) → v2 (nối DB, dò tự động, hỏi tay chỉ khi dò không ra) sau khi người dùng cho
biết cách giải `%Database` — xem "Giải `%Database`" bên dưới. Mọi lỗi kết nối (không có Web.config,
sai connectionString, `sqlcmd` không có trên máy, server không tới được…) đều rơi về đúng hành vi
v1: hiện hết field bảng chính, hỏi tay hết — KHÔNG BAO GIỜ chặn cả lệnh vì một bước dò tự động
thất bại. `core/test/test-sql-config.mjs` test được phần thuần (parse connection string, giải
placeholder, sinh SQL); phần chạy `sqlcmd` thật trong `sql-host.js` CHƯA test được trên SQL Server
thật trong phiên làm việc này (không có server nào tới được từ máy đang code) — cần người dùng tự
thử và báo lại nếu `sqlcmd` không parse đúng, hoặc encrypt/certificate không như DWF.

Phần dưới đây là log thảo luận dẫn tới bản v1/v2 — giữ lại vì còn quyết định kiến trúc (bảng chia
kỳ thật vs thẻ `<partition>` tĩnh, độ dài cột chữ, giải `%Database`) mà code đã áp dụng.

### Xác định field cần tạo cột

**"Field vừa thêm" xác định bằng cách đối chiếu với DB** (`sys.columns` của bảng đích so với
danh sách `<field>` trong file), không phải bằng lịch sử sửa — bắt được cả field người khác thêm
hoặc thêm ngoài designer. Trong số field lệch đó, chỉ field nào **vừa `external` vắng mặt hoặc
`="false"`, vừa `aliasName` vắng mặt hoặc `="a"`** mới là cột thật của bảng chính — soi corpus
FBISP24 xác nhận:

- `external="true"` luôn đi kèm `%l` cuối tên (`ten_tk_me%l`, `ten_nt%l` trong `Account.f`) — cột
  hiển thị lấy qua join, KHÔNG phải cột của bảng chính. Loại.
- `aliasName="a"` (`ma_vt_ncc`, `stt_rec` trong `BIPurchasingInfoRecordAdjustment.f`,
  `hrAMPerformanceInfor.f`) hoặc field trần không khai `aliasName` — cột thật của bảng chính `a`.
  Nhận.
- `aliasName` khác (`"fromDate"`, `"Period"`, `"Year"`, `"date"`…) là bí danh tham số/join khác,
  không phải cột bảng chính. Loại.

### Xác định bảng

`dir|grid@table="xxx"` — thuộc tính `table` ngay trên gốc tài liệu (`<dir table="pxdc" …>`,
`<grid table="…">`), không phải suy ra. `scanRoot` (`core/src/spans.mjs:256`) đã trả về
`attrs.table` sẵn, không cần sửa gì ở tầng scan.

### Bảng chia kỳ → script khác

Có thêm thẻ con `<partition table="pxdc" prime="pxdc" …/>` bên trong `<dir>`/`<grid>` (ví dụ
`AdjustmentIssueTran.f:92`) thì bảng đó CHIA KỲ — cột phải thêm vào MỌI `pxdc$000000`,
`pxdc$202401`, … Không có `<partition>` thì là bảng thường, chỉ cần kiểm tra đúng bảng rồi phát
một câu `ALTER TABLE ... ADD ...` đơn.

`database="Sys"` → `sysConnectionString`, mặc định → `appConnectionString`; `scanSysDatabaseName`
đã nhận tham số `name` nên tái dùng được (`filter-declare.mjs:732`).

### Bảng ánh xạ kiểu FBO → kiểu cột SQL

| FIELD_KINDS id | SQL type | Nguồn |
|---|---|---|
| `datetime` | `smalldatetime` | chốt |
| `numeric` | `numeric(19,4)` | chốt |
| `checkbox` | `bit` | chốt |
| `textbox` (string) | `varchar(N)` | `N` KHÔNG lấy từ `field@maxLength` — xem "Độ dài N" dưới |

**`varchar`, không phải `nvarchar`.** `filter-declare.mjs:528` đã ghi rõ quy ước dự án: cột chữ
của FBO là `varchar` dưới collation tiếng Việt (không phải Unicode) — dấu tiếng Việt bỏ vào
`nvarchar` sai layout, mất dấu theo hướng khác. Sinh cột string luôn là `varchar(N)`.

**Độ dài N — chốt 2026-08-28, sửa lại cùng ngày sau khi người dùng đính chính:**

`field@maxLength` **CHỈ áp dụng cho cột `external`** — người dùng xác nhận trực tiếp, và đối
chiếu corpus khớp: 61 field `external="true"` mang `maxLength` trong `Dir/Grid` của FBISP24, so
với đúng 1 field `aliasName="a"` (không `external`) mang nó — một ngoại lệ hiếm, không đủ để tin
cậy. Tiện ích #2 chỉ tạo cột cho **bảng chính** (field `external` vắng/`false`), nên
`field@maxLength` **KHÔNG dùng ở đây nữa** — bỏ hẳn bậc dùng trực tiếp XML. Còn hai bậc:

1. **Dò `sys.columns`/`sys.types` trong database, tìm cột CÙNG TÊN đã tồn tại ở bảng khác**
   (`stringColumnLengthSql` trong `sql-config.mjs`) — **ĐÃ NỐI ĐƯỢC (v2)**, xem "Giải `%Database`"
   dưới. Nhiều tên field là "field hệ thống" dùng lặp lại xuyên bảng với định dạng đã thống nhất
   từ trước — ví dụ `ma_kh` (mã khách hàng) chắc chắn đã có cột cùng tên ở nhiều bảng khác, dò ra
   được độ dài chuẩn mà không cần hỏi. Dò ra NHIỀU độ dài khác nhau (mơ hồ) thì KHÔNG tự chọn một
   trong số đó — rơi xuống bậc 2, kèm liệt kê các độ dài dò được để người dùng tham khảo.
2. **Không tìm thấy ở bậc 1 (không có dòng nào, nhiều độ dài khác nhau, hoặc DB không nối được)
   → nhiệm vụ của NSD (người sử dụng) tự xác định.** Tool dừng lại hỏi tay độ dài cho đúng field
   đó lúc sinh script — không tự bịa một con số mặc định.

**Giải `%Database`.** `appConnectionString` của FBISP24 khai `Initial Catalog=%Database` — một
`sys` phục vụ nhiều `app` (nhiều khách/tenant dùng chung server), placeholder này KHÔNG có nguồn
tĩnh nào trong `Web.config` nói ra tên thật. Người dùng chỉ dẫn (2026-08-28): tên database app
thật nằm ở CHÍNH database `sys`, bảng `entity`, cột `cdata` — lấy DÒNG ĐẦU. Đối chiếu DevWorkFlow
khớp hoàn toàn: `DevWorkFlow.Infrastructure/Services/EntityRepository.cs` chạy đúng câu
`SELECT RTRIM(code), RTRIM(cname), RTRIM(cdata) FROM entity WHERE NULLIF(RTRIM(cdata),'') IS NOT
NULL ORDER BY code`, và `DevWorkFlow.Application/Shell/AppConnectionResolver.cs` cũng mặc định
lấy DÒNG ĐẦU (`databases[0]`) khi tự chọn — `code` là khoá sắp, không phải suy đoán tuỳ tiện.
`sql-config.mjs::ENTITY_APP_DATABASE_SQL` sinh đúng câu này; `sql-host.js::resolveAppDatabase`
chạy nó trên `sysConnectionString` rồi thay `%Database` (và `%UserID`, nếu cần) vào
`appConnectionString` — `resolvePlaceholders`, cùng thuật toán
`AppConnectionResolver.ReplacePlaceholders`. `-N -C` (encrypt + trust server certificate) LUÔN
bật khi gọi `sqlcmd`, mirror `SqlConnectionSettings.EnsureConnectionSettings` của DevWorkFlow —
cần cho SQL Server cũ không cert hợp lệ (mẫu Web.config của FBISP24 trỏ `SQL2008`). Mật khẩu đi
qua biến môi trường `SQLCMDPASSWORD` của tiến trình `sqlcmd`, KHÔNG qua argv `-P` — argv của một
tiến trình có thể lộ ra process list của hệ điều hành.

### Script cho bảng chia kỳ

Cấu trúc mẫu người dùng đưa (rút gọn, `loai_hd CHAR(2)` minh hoạ):

```sql
DECLARE @ngay_ct1 smalldatetime, @ngay_ct2 smalldatetime
SELECT @ngay_ct1 = ngay_gh1, @ngay_ct2 = ngay_gh2 from dmstt

IF NOT EXISTS(SELECT 1 FROM syscolumns WHERE id IN (SELECT id FROM sysobjects WHERE name = 'm81$000000') AND name = 'loai_hd')
BEGIN
	ALTER TABLE m81$000000 ADD loai_hd CHAR(2)
	DECLARE @strsql NVARCHAR(4000)
	SET @strsql = 'alter table m81$%Partition add loai_hd CHAR(2)'
	EXEC FastBusiness$Partition$Execute @strsql, '', 'ngay_ct', @ngay_ct1, @ngay_ct2, 1, 1
	SET @strsql = 'update m81$%Partition set loai_hd = '''' where %[loai_hd is null]%'
	EXEC FastBusiness$Partition$Execute @strsql, '', 'ngay_ct', @ngay_ct1, @ngay_ct2, 1, 1
END
```

**ĐÃ THỰC THI.** Yêu cầu "script này phải tùy chỉnh được bởi người dùng" giải quyết bằng hai lớp:

- `core.DEFAULT_PARTITION_TEMPLATE` (`add-column.mjs`) là mẫu mặc định, viết bằng placeholder
  `{{primeMaster}}` `{{primePattern}}` `{{partitionField}}` `{{column}}` `{{sqlType}}`
  `{{backfill}}` — `renderAddColumnSql(defs, {..., template})` chỉ ĐIỀN tham số vào template
  truyền vào, không hard-code cấu trúc script.
- Setting `fboDesigner.addColumnPartitionTemplate` (đường dẫn file `.sql`) cho người dùng tự viết
  template riêng mà không đụng `core/` — `add-column-host.js` đọc file này nếu có khai, rơi về
  mặc định kèm cảnh báo nếu đọc lỗi.

**Phát hiện thêm khi cài (không có trong bản thảo gốc): không phải mọi `<partition>` đều CHIA KỲ
THẬT.** Đối chiếu toàn bộ FBISP24: `prime` KẾT THÚC BẰNG `$` cộng `increase` khác rỗng
(`dateadd(month, 1, {0})`) mới là bảng thật sự xoay theo kỳ — 457/461 dòng khớp cặp này. `prime`
không kết thúc `$` (VD `pxdc`, `bigia01`, hay đã là tên bảng đủ như `bid02$000000`) là bảng TĨNH
dù có thẻ `<partition>` — `isRotatingPartition()` trong `add-column.mjs` phân biệt hai ca này;
bảng tĩnh chạy script THƯỜNG (một `ALTER TABLE` mỗi cột), không lặp
`FastBusiness$Partition$Execute`.

## 3. Nhập liệu debug ngay trên form

Chỉ áp dụng Filter rồi Danh mục. Dùng lại tầng bơm giá trị của #1, đảo chiều: đọc từ input thay
vì ghi vào.

Khoảng trống chưa lấp: **file Filter không nói nó chạy proc nào** — tên proc và thứ tự tham số
nằm ở `Main/` hoặc khai báo report. Cần điều tra một màn hình Filter thật trước khi dựng được
câu `exec`.

Ràng buộc đặt từ đầu: dữ liệu nhập chỉ đi vào tham số SELECT/EXEC, **không bao giờ ghi ngược
DB**. Designer là công cụ đọc.

## 4. Sao chép source từ dự án khác

Kế thừa tính năng có sẵn từ dự án khác: copy danh mục (gồm menu `wcommand`/`command` ở sys, file
Dir/Grid/Filter/Main), một số trường hợp cần thêm Include/Css/ClientScripts/bin, table, proc,
function, data khai báo.

Cái khó không phải chép file — là **bao đóng phụ thuộc**. Dự án đã có sẵn nửa lời giải:
`expandEntities` trả về `segments` biết từng entity đến từ Include nào, `scanCss` biết file cần
CSS nào — bao đóng ở tầng file lấy được tự động.

Ba nhịp đề xuất, nhịp 1 tự nó đã có ích dù không chép gì:

1. **Chẩn đoán** — liệt kê đủ bao đóng của một danh mục ở dự án nguồn (4 file controller, mọi
   Include nó bung, CSS/ClientScript nó gọi), đối chiếu dự án đích thiếu cái gì.
2. **Chép phần file** — theo checklist ở nhịp 1, có xác nhận từng nhóm; giữ nguyên encoding
   Windows-1258 + CRLF + BOM (dùng lại `readSource`/`encodingBlocks` đã có).
3. **Phần SQL** — sinh script cho `wcommand`/`command`, table, proc, function, data khai báo; để
   người đọc rồi tự chạy, không tự chạy.

## 5. Split cột, merge cột (FORM)

Bổ sung ngày 2026-08-28, ý người dùng góp.

**ĐÃ THỰC THI (2026-08-28), hướng (b).** Người dùng chốt: "cột" là DANH SÁCH BIÊN dùng chung của
vùng, không phải span của control. Đại số thuần ở [`core/src/columns.mjs`](../core/src/columns.mjs)
(`splitPatternAt`, `mergePatternAt`, `splitWidthsAt`, `mergeWidthsAt`); phần quy về file nguồn ở
`planRegionColumns`/`regionColumnFiles` trong [`core/src/edit.mjs`](../core/src/edit.mjs); test ở
[`core/test/test-columns.mjs`](../core/test/test-columns.mjs). Tầng vỏ: `handleRegionColumns`
trong [`extension/src/edit-host.js`](../extension/src/edit-host.js), UI là thanh
`Tách`/`Gộp◄`/`Gộp►` bấm ra từ con số px trên dải thước blueprint
([`designer.js::drawColumnEdgeBar`](../extension/media/designer.js)).

Phần dưới đây là log thảo luận dẫn tới bản đã cài — giữ lại vì còn ghi lý do chọn hướng.

Hai đọc hiểu khác hẳn nhau về chữ "cột" ở đây, và README lúc đó đã mô tả một tính năng gần giống
nhưng KHÔNG PHẢI cùng thứ:

- **Gộp/tách Ở CẤP CONTROL đã có sẵn.** README ghi: *"Tay cầm xanh ở mép ô: kéo để gộp/tách hoặc
  đổi biên độ của control."* — đây là `setSpan` (`core/src/item-value.mjs:367`, gọi qua
  `op.kind === 'resize'` trong `planRowEdit`, `core/src/edit.mjs:225`). Nó đổi SỐ CỘT một control
  đang trải, trong DANH SÁCH BIÊN CỘT (`widths`) có sẵn của hàng — không đụng tới bản thân danh
  sách biên đó, và chỉ ảnh hưởng MỘT hàng (`<item>`).
- **Cái CHƯA có: đổi chính danh sách biên cột (`widths`) của cả vùng/panel** — chèn thêm một biên
  mới (chia đôi một cột hiện có thành hai, mọi hàng trong panel đó đều bị ảnh hưởng vì chúng dùng
  chung MỘT `widths`) hoặc xoá một biên (gộp hai cột liền kề thành một, cũng ảnh hưởng cả panel).
  Đây là thao tác nặng hơn hẳn `setSpan`: sửa `widths` mà không sửa lại `pattern`/`tokens` của
  MỌI hàng dùng chung nó là gãy toạ độ hàng loạt.

`parseWidths` (`core/src/item-value.mjs:25`) là chỗ đọc danh sách biên hiện tại; chưa có hàm
tương ứng để ghi lại một danh sách đã sửa kèm dồn lại pattern của từng hàng phụ thuộc.

**Đã hỏi và đã chốt (2026-08-28):** hướng (b) — sửa danh sách biên cột dùng chung của vùng.
Hướng (a) (mở gộp/tách sang GRID) bị loại vì lưới xếp cột bằng THỨ TỰ `<field>` chứ không bằng
pattern: nó không có span nào để gộp hay tách, và thêm/xoá cột lưới thì `planInsertColumn`/
`planRemoveColumn` đã làm xong từ trước.

### Những gì phát sinh khi cài, không có trong bản thảo gốc

1. **`parseWidths` không phải chỗ duy nhất phải sửa — `anchor` và `split` cũng đếm cột.** Chèn
   hay bỏ một biên mà không dời hai con số ấy là chúng lặng lẽ trỏ sang cột khác. Và chúng đếm
   HAI THỨ khác nhau: `anchor = j` là "cột thứ j được neo" (đếm CỘT), `split = k` là "chia làm
   hai SAU cột thứ k" (đếm VẠCH) — nên hai công thức dời khác nhau, xem `shiftMarker`. Gộp trúng
   đúng cái vạch mà `split` đang trỏ tới là ca DUY NHẤT không có câu trả lời đúng → từ chối.

2. **Phạm vi "mọi hàng dùng chung" rộng hơn "mọi hàng của vùng đang bấm".** Tab không khai
   `<category columns>` rơi về list px của view, cùng với dải header và dải footer — nên bấm
   trong một tab có thể viết lại hàng của ba vùng khác. `widthsOwnerKey` bám đúng luật của
   `regionWidths` trong `buildViewModel`; lệch nhau là sửa một list px nhưng dồn pattern của
   những hàng đọc list px khác.

3. **Phép sửa là ĐA FILE, và không biết trước là file nào.** Ký tự pattern thật sự đổi có thể
   nằm gọn trong khai báo của một `&Split;` ở file thứ ba. Gỡ bằng cùng mẹo của
   `rowEditTargetFile`: `regionColumnFiles` tính xong dải mà không cần đọc file nào, tầng vỏ mở
   đúng bấy nhiêu file rồi mới gọi `planRegionColumns`.

4. **Hai hàng cùng bung ra từ một entity thì quy về CÙNG một dải nguồn.** Trùng khít và cùng nội
   dung → gộp làm một splice (đó chính là điều đúng: sửa khai báo entity một lần là cả hai hàng
   cùng đổi). Trùng mà khác nội dung, hoặc chồng một phần → từ chối. Xem `mergePatches`.

5. **Bất biến giữ cho phép sửa an toàn: số ký tự `1` không đổi.** Tách chỉ chèn `0`/`-`, gộp chỉ
   bỏ một ký tự không phải `1`. Nhờ đó danh sách token không phải đụng tới ở bất kỳ hàng nào, và
   phép sửa chỉ vá mấy ký tự pattern — cùng đường với `patternPlan`, nên hàng viết bằng entity
   vẫn sống sót nguyên vẹn.

### Còn thiếu, chưa làm

Đổi bề rộng MỘT cột form đã có sẵn bằng chuột. Px của cột form nằm ở list px dùng chung nên nó
không phải thao tác của một ô — chưa có `op` nào cho nó. Đường vòng hiện có: `Tách` thành
`<bề rộng mới>, 0` rồi `Gộp►`, cho ra đúng bề rộng mới và pattern trở lại y như trước.

## 6. Swap control

Bổ sung ngày 2026-08-28, ý người dùng góp. Đây LÀ tính năng mới thật — không trùng gì đã có.

**ĐÃ THỰC THI 2026-08-28** — chốt ở bản HẸP: chỉ cùng span. Phần dưới giữ nguyên như lúc khảo
sát; mục «Đã chốt và đã làm» ở cuối tiết này ghi cái thực sự được viết.

`moveCell` (`core/src/item-value.mjs:293`) là phép dời control gần nhất hiện có, nhưng nó **TỪ
CHỐI có chủ ý** nếu cột đích đang có control khác:

> `cột ${c + 1} đang có control — bỏ nó trước rồi mới dời được`

Tức đổi chỗ hai control cho nhau hiện phải làm bằng tay qua hai bước (xoá rồi thêm lại, hoặc dời
sang ô trống trung gian) — không có đường trực tiếp. `swap` sẽ là một `op.kind` mới trong
`planRowEdit` (`core/src/edit.mjs:225`), gần `moveCell` nhất về hình dạng: nhận hai `cellIndex`,
hoán token giữa hai ô nếu **cùng span** (khác span thì không đơn giản là hoán — control span 3
tráo với control span 1 sẽ đè lên control thứ ba ở giữa, cần quyết định là từ chối hay dồn lại
toàn hàng).

~~**Điểm cần chốt trước khi code:** swap có cho phép khác span hay chỉ cho phép cùng span?~~ —
chốt: **chỉ cùng span**, khác span từ chối kèm cả hai con số và đường ra.

### Đã chốt và đã làm

`swapCells` (`core/src/item-value.mjs`), nhánh `swap` của `planRowEdit` (`core/src/edit.mjs`).

Điều đáng ghi lại là **giới hạn cùng-span không phải một sự nhân nhượng, nó là thứ làm phép này
gần như không có rủi ro.** Hai ô cùng span thì cột bắt đầu và số cột chiếm của cả hai đều giữ
nguyên, nên PATTERN KHÔNG ĐỔI MỘT KÝ TỰ NÀO — chỉ có hai token hoán vị. Hệ quả:

- Splice chỉ chạm phần token. Không có bất biến pattern nào phải giữ, khác hẳn `moveCell` (phải
  xoá vùng nguồn trước rồi mới kiểm vùng đích) và khác hẳn tách/gộp cột (phải giữ số ký tự `1`).
- Token đi qua bằng `t.raw` nên hàng viết bằng entity sống nguyên vẹn, cùng luật với `move`.
  (Pattern viết bằng entity vẫn do `sourceRow` chặn chung với ba phép kia — không có ngoại lệ.)
- Chỉ số ô của cả hàng đứng yên, nên `patchRow` vá cục bộ được. Chỉ một chỗ phải nhớ: chọn lại ô
  `other` chứ không phải ô `cell` — control người dùng vừa kéo nay nằm ở slot kia.

Bề mặt: kéo thả lên chính control kia (bóng mờ có màu thứ ba, tím vạch đứt), và hai nút `⇄←`/`⇄→`
trên thanh lệnh — nút mờ đi kèm lý do khi control bên cạnh khác bề rộng, tức webview nói cùng một
luật với core thay vì để người dùng bấm rồi mới nhận câu từ chối.

Nhặt được một lỗi cũ trên đường: phép kiểm «cột đích có trống không» của bóng mờ quét cả BẢNG
trong khi phép sửa chỉ tính trên HÀNG, nên bóng báo đỏ ở rất nhiều chỗ thả xuống vẫn chạy được.
Nay cả hai cùng quét trong `tr.FormRow`.

## 7. Options khi sửa design: Lưu ngay / Tự lưu

Bổ sung ngày 2026-08-28, ý người dùng góp. Đây LÀ hành vi mới — hiện tại **không có lựa chọn nào
khác ngoài lưu ngay**, và điều đó đang được viết thẳng vào code ở ba chỗ, không phải một cấu
hình:

- `applySplice` (`extension/src/edit-host.js:166`): *"Lưu luôn. `applyEdit` mới chỉ đổi document
  trong bộ nhớ; chưa lưu thì file trên đĩa vẫn là bản cũ… Lưu xong `onDidChangeTextDocument` cũng
  đã bắn, nên preview tự vẽ lại"* — comment ngay trong code giải thích lý do lưu ngay: đồng bộ
  preview với đĩa.
- `EditHistory.step` (`extension/src/edit-history.js:62`, dùng cho cả Undo lẫn Redo): `await
  doc.save()` ngay sau `applyEdit`, không điều kiện.
- `patchXml` trong `filter-host.js:192`: cùng một `await document.save()` không điều kiện.

Ba chỗ này phải cùng đổi nếu thêm option, không phải một. **Rủi ro thật của "tự lưu" (không lưu
ngay mỗi thao tác):** `EditHistory.step` so nguyên văn file với snapshot đã ghi (`frame[expect]`)
trước khi cho Undo/Redo chạy — nếu bật "tự lưu" mà gộp nhiều thao tác thành một lần lưu trễ, cần
xem lại Undo có còn đúng từng bước hay bị gộp theo, và `confirmForeignEdit`/`patchXml` đang hỏi
xác nhận NGAY LÚC sửa — độ trễ lưu không đổi thời điểm hỏi đó.

**Đề xuất phạm vi hẹp cho v1** (chưa chốt, cần người dùng xác nhận): thêm setting
`fboDesigner.saveMode` (`immediate` mặc định — hành vi hiện tại, giữ nguyên; `auto` — gộp lưu sau
một khoảng debounce ngắn, chỉ áp dụng cho splice trên CHÍNH file đang mở, không áp dụng cho ghi
sang file khác qua `confirmForeignEdit` — ghi sang file khác vẫn lưu ngay vì người dùng đã xác
nhận rõ ràng ở bước đó rồi).

---

## Thứ tự đề xuất (khác thứ tự người dùng liệt kê ban đầu)

**#2 trước #1**: add column không phụ thuộc gì ngoài `sqlcmd` + `scanRoot.attrs`, làm xong dùng
được ngay, và ép dựng luôn `extension/src/sql-host.js` — thứ ba mục còn lại đều cần tầng đó. Làm
#1 trước thì vẫn phải dựng cùng tầng SQL nhưng kèm thêm UI chọn dòng và bài toán bảng-mã-hoá.

Sau đó: #1 → #3 (dùng chung tầng bơm giá trị) → #4 nhịp 1.

## Chưa quyết / cần đo trước khi viết code

- ~~Bảng ánh xạ kiểu FBO → kiểu cột SQL cho #2~~ — chốt ở §2, xem bảng ánh xạ kiểu.
- ~~Độ dài cột string khi field không khai `maxLength`~~ — chốt ở §2: `maxLength` không áp dụng
  cho cột bảng chính; dò `sys.columns` cho field cùng tên ở bảng khác trước (v1 chưa nối), hỏi
  tay NSD khi không dò được.
- ~~"Bảng chia kỳ" của #2 có phải luôn là bảng THẬT SỰ chia kỳ~~ — KHÔNG, chốt ở §2: `prime` kết
  thúc `$` + `increase` khác rỗng mới là chia kỳ thật; còn lại (kể cả có thẻ `<partition>`) là
  bảng tĩnh. Câu hỏi gốc về "bảng phân kỳ" (lịch phân bổ chi phí/khấu hao) vẫn CHƯA xác nhận có
  phải cùng khái niệm không — nếu khác thì cần khảo sát riêng, chưa động tới trong v1.
- ~~Cơ chế giải `%Database` của `appConnectionString`~~ — chốt ở §2: bảng `entity`, cột `cdata`,
  dòng đầu theo `code` trên database `sys`, đối chiếu khớp `AppConnectionResolver`/
  `EntityRepository` của DevWorkFlow. `extension/src/sql-host.js` đã dựng xong (chạy `sqlcmd`),
  CHƯA test được trên SQL Server thật trong phiên này — cần người dùng tự thử.
- Cơ chế Filter → proc cho #3 (đọc một màn hình Filter thật).
- ~~**#5 (split/merge cột):** "cột" nghĩa là mở gộp/tách control đã có sang GRID, hay là sửa danh
  sách biên `widths` dùng chung của cả panel trên FORM~~ — chốt 2026-08-28: hướng (b), sửa danh
  sách biên. ĐÃ THỰC THI, xem §5.
- ~~**#6 (swap control):** cho hoán hai control khác span nhau hay chỉ cùng span~~ — chốt
  2026-08-28: chỉ cùng span. ĐÃ THỰC THI, xem §6.
- **#7 (lưu ngay/tự lưu):** "tự lưu" có gộp nhiều thao tác Undo thành một bước hay giữ từng bước
  riêng dù trễ lưu — ảnh hưởng trực tiếp tới `EditHistory`, chưa chốt cơ chế.
