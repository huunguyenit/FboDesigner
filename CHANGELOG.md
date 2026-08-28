# Changelog

Định dạng dựa trên [Keep a Changelog](https://keepachangelog.com/).

## [Chưa phát hành]

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
