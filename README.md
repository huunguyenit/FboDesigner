# FBO Designer

FBO Designer là extension cho Cursor giúp thiết kế form FBO ngay trong IDE: mở file controller, nhìn layout qua **Blueprint**, kéo thả control, chỉnh biên cột, rồi sửa XML mà không rời ide.

## Tại sao nên dùng

**Thiết kế**

- Thiết kế form FBO trực tiếp trên file `Dir` / `Filter` / `Grid`
- Blueprint mặc định: thước px, slot, `colspan`, `split`, `anchor` đọc layout từ XML thuần
- Kéo thả, thêm hàng / field / cột, đổi chỗ control
- Sinh script khai báo lọc nhanh và thêm cột database

**Đọc và sửa XML** *(mới ở 1.0.2)*

- **Gạch đỏ ngay trong editor** cho 26 luật — và lỗi hiện ở **đúng file phải sửa**, kể cả khi
  hàng ấy khai trong `Include`
- **Mục lục** (`Ctrl+Shift+O`), **F12** tới chỗ khai, **rê chuột** đọc thông số field, **gợi ý**
  tên field và entity — chạy trên mọi file dưới `App_Data\Controllers`, không cần license
- **Xem dữ liệu thật trên lưới** (`Ctrl+Alt+D`): vài dòng thật đổ vào đúng bề rộng cột, để biết
  cột 60px có cắt mất tên khách hay không. Che dữ liệu mặc định, giữ nguyên độ dài
- Ctrl+click (hoặc double click) nhảy đúng file / dòng khai báo entity và Include

## Tính năng chính

### 1. Blueprint (layout + debug tài nguyên)

Blueprint là lớp thiết kế mặc định trên form đang mở:

- Thước đo pixel, khung slot, số `colspan`, vạch `split`, `anchor`, `move`, `drag` and `drop`
- Form có `view@split` / `category@split` render đúng runtime
- Chọn ô để xem khai báo field, file nguồn và nơi khai báo
- Xem stylesheet đang nạp, ảnh đang dùng (kích thước file / render / sprite)
- Nạp lại resource khi cần làm mới cache hoặc kiểm tra lỗi hình ảnh

![Form overview](docs/images/Form.png)

*Blueprint trên form chứng từ: thước cột, slot trống, nhãn* `colspan` *và vùng split.*

![Tab layout](docs/images/Tab.png)

*Tab và vùng nội dung — neo / split đọc được ngay trên design.*

![Grid columns](docs/images/Grid.png)

*Lưới chi tiết: bề rộng cột (px) và nút* `(+)` *chèn cột giữa các header.*

### 2. Lệnh và phím tắt

Bốn lệnh, gọi từ chuột phải → **FBO Designer** hoặc Command Palette.

`Ctrl+Alt+F` và `Ctrl+Alt+C` **sinh script SQL để bạn tự chạy** — extension không bao giờ chạy
script thay bạn. `Ctrl+Alt+C` và `Ctrl+Alt+D` có **đọc** database khách (chỉ đọc, có hạn giờ) để
dò sẵn; nối không được thì `Ctrl+Alt+C` vẫn chạy và hỏi tay.


| Lệnh                                   | Phím tắt     | Việc làm                                                                                          |
| -------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------- |
| **Mở giao diện giả lập FBO**           | `Ctrl+Alt+O` | Mở panel designer bám theo file controller đang active                                            |
| **Khai báo lọc nhanh cho lưới này**    | `Ctrl+Alt+F` | Bật `allowFilter` / `<query>` trên XML lưới (nếu thiếu), sinh SQL xoá–nạp lại `sysfilterdeclares` |
| **Sinh script thêm cột cho field mới** | `Ctrl+Alt+C` | So field trên form với schema, sinh SQL thêm cột cho field chưa có trên bảng                      |
| **Xem dữ liệu thật trên lưới**         | `Ctrl+Alt+D` | Lấy vài dòng thật đổ vào lưới để đo bề rộng cột; bấm lại để bỏ đi (xem §4)                       |


![Commands](docs/images/Command.png)

*Menu chuột phải trên file* `.xml` */* `.f`*: mở designer, khai báo lọc, sinh script thêm cột.*

**Khai báo lọc nhanh**

1. Mở file trong `App_Data\Controllers\Grid`
2. Chạy lệnh hoặc `Ctrl+Alt+F`
3. Chọn cột cần lọc; chấp nhận sửa XML nếu thiếu `allowFilter` / `%Control.Filter;`
4. Chạy script SQL trên database `sys` của khách theo đúng controller
5. Dòng chưa rõ bảng nguồn được đánh dấu, không che điểm chưa biết

![Quick Filter](docs/images/QuickFilter.png)

*Hộp thoại chọn cột lọc nhanh — tick cột cần bật, dòng chưa rõ bảng nguồn có cảnh báo.*

**Sinh script thêm cột**

Chạy **Sinh script thêm cột cho field mới** trên form/lưới: extension dò field chưa có cột trên database, tick field cần sinh SQL, rồi mở script để chạy trên DB khách.

![Scripts add](docs/images/ScriptsAdd.png)

*Chọn field thiếu cột trên bảng (vd. chia kỳ) — bỏ tick field không muốn sinh script.*

- Giải `&Entity;` / `Config`: biết hàng đến từ file nào
- Ctrl+click hoặc double click mở đúng chỗ khai báo
- Sửa control từ entity: hỏi ghi vào file gốc hay phân giải inline (`entityEditTarget`)



### 3. Chẩn đoán trong Problems panel

Mở một file trong `Dir` / `Filter` / `Grid` là extension quét ngay và đẩy lỗi vào **Problems**
(`Ctrl+Shift+M`) — không cần mở designer, không cần license.

- Token trỏ vào field chưa khai, `<field>` khai mà lưới không có, pattern lệch số cột, list px
  hỏng, tab khai trùng, entity chưa khai / đệ quy / file `SYSTEM` không đọc được
- `<field>` khai mà không chỗ nào dùng tới, `aliasName` không có trong `<query event="Finding">`
  hoặc trỏ tới bảng tạm cục bộ (lọc nhanh sẽ không thấy), lưới nhúng khai `rows` tràn khỏi vùng
- **Lỗi hiện ở đúng file phải sửa**: hàng viết trong `Include` thì gạch đỏ nằm trong chính file
  Include ấy, không nằm ở controller đang mở
- Gạch vào đúng khúc chữ hỏng — đúng token, đúng phần tử trong list px — chứ không bôi cả hàng
- Mức `Error` dành cho thứ làm control **biến mất khỏi màn hình**; `Warning` cho thứ vẫn vẽ ra
  được nhưng đáng ngờ
- Bấm vào một dòng trong Problems là nhảy thẳng tới chỗ khai

Sửa một file `Include` thì mọi controller đang mở có kéo file ấy vào đều được tính lại. Lưu ý:
Include đang sửa **chưa lưu** thì chẩn đoán vẫn tính trên bản đã lưu — giống hệt cách designer
đọc file, nên hai bên luôn nói cùng một chuyện.


### 4. Xem dữ liệu thật trên lưới

Chỉnh bề rộng cột mà không biết dữ liệu thật dài bao nhiêu là đoán. Mở một file trong
`App_Data\Controllers\Grid` → `Ctrl+Alt+D`: extension lấy vài dòng thật về và đổ vào chính lưới
đang vẽ, đúng bề rộng cột, đúng chỗ runtime cắt chữ. Bấm lại phím tắt để bỏ đi.

| | |
| --- | --- |
| **Che mặc định BẬT** | chữ thành `x`/`X`, số thành `0`, **giữ nguyên độ dài** — vẫn đo được cột mà ảnh chụp không kèm dữ liệu khách. Tắt ở `fboDesigner.maskSampleData` khi cần đo tới từng pixel |
| **Chỉ đọc, có trần** | `SELECT TOP 10` (đổi ở `fboDesigner.sampleRowCount`, trần 100), `READ UNCOMMITTED` để không khoá ai đang làm việc thật, hạn 10 giây |
| **Không tự chạy** | chỉ chạy khi bạn bấm lệnh. Không có nhánh nào tự lấy dữ liệu lúc mở file hay lúc gõ phím |
| **Không giữ lại** | dữ liệu nằm trong bộ nhớ của phiên, không ghi đĩa, mất khi đóng cửa sổ |

Câu lệnh dựng từ `<query event="Finding">` của chính file, và **không một mẩu SQL nào của file
đi thẳng vào câu lệnh** — chỉ tên bảng, tên alias, tên cột đã qua kiểm định danh. Cột nào không
dựng được thì **bỏ riêng cột đó** và nói lý do ở Output, chứ không bỏ cả phép xem trước:

- `aliasName` là biểu thức không bóc được thành `alias.cột`
- alias không có trong câu Finding, hoặc trỏ tới **bảng tạm cục bộ** (`#x` — không sống ngoài
  phiên đã tạo ra nó)
- bảng join là tiền tố chia kỳ chưa có kỳ

Ô của những cột ấy hiện **gạch chéo xám** — để phân biệt với ô có dữ liệu mà giá trị rỗng.

Cần `sqlcmd` trên máy (khai đường dẫn ở `fboDesigner.sqlcmdPath` nếu cài chỗ lạ) và `Web.config`
của program đọc được.


### 5. Mục lục file (`Ctrl+Shift+O`)

Controller thật dài vài nghìn dòng. `Ctrl+Shift+O` (hoặc panel **Outline**) cho cây cấu trúc và
nhảy thẳng tới chỗ khai:

```
fields (24)
  ma_kh          Mã khách hàng · 80px
  ten_kh%l       Tên khách · 150px
view "Dir"       height="302"
  cột: 100, 60, 90, 120
  [ma_kh].Label, [ma_kh]          110-
  &BI.Rows.Customer;              hàng đến từ file khác
  categories (3)
    tab 1 — Thông tin chung
toolbar (7)
  New            Thêm
```

- Chạy trên **mọi** file dưới `App_Data\Controllers`, kể cả `Include\` — không cần license
- Hàng hiện **danh sách token** (thứ người ta đi tìm), pattern xuống dòng mô tả
- Cột lưới hiện `aliasName` — nhìn là biết cột lấy dữ liệu từ bảng nào
- Đọc **văn bản thô, không bung entity**: mục lục là của *file đang mở*. Một view mà mọi hàng
  đến từ `&Rows;` hiện đúng một nút `&Rows;` — vừa thành thật, vừa nói luôn phải sang file nào
  để sửa
- Thứ đã comment thì không có trong mục lục, cùng luật với designer


### 6. Đi tới định nghĩa (`F12` / `Ctrl+click` trong editor)

Ba thứ nhảy được ngay trong file XML, không cần mở designer:

| Con trỏ đang trên | `F12` đi tới |
| --- | --- |
| `&Rows;` | **nội dung** entity — file Include, hoặc giá trị trong nháy nếu khai inline |
| `SYSTEM "..\Include\X.ent"` | chính file ấy |
| `[ma_kh]` hoặc `<field name="ma_kh"/>` trong view | thẻ `<field>` khai nó |

Điểm đáng kể: field khai trong `Include` thì nhảy sang **đúng file ấy**, không phải một chỗ tình
cờ trong file đang mở. Entity trỏ file thì nhảy tới **nội dung**, không dừng lại ở dòng
`<!ENTITY … SYSTEM …>` — tấm biển chỉ đường không phải đích đến.

Đứng trên chính khai báo (`<field name="ma_kh">` trong `<fields>`) thì không nhảy đi đâu: đó đã
là định nghĩa rồi. Thứ đã comment cũng không nhảy, cùng luật với designer.

Chạy trên mọi file dưới `App_Data\Controllers`, không cần license.


### 7. Rê chuột và gợi ý

**Rê chuột** lên một field — trong `<fields>`, trong `[token]`, hay trong danh sách cột — hiện
nhãn, kiểu, `maxLength`, bề rộng, `aliasName`, và **file khai nó** nếu đó không phải file đang
mở. Rê lên `&Name;` hiện nó trỏ tới file nào, hoặc chính giá trị nếu khai inline.

Sau khi bấm `Ctrl+Alt+D`, hover còn kèm **thống kê dữ liệu thật**:

```
ten_kh — Tên khách
String · width 60px · aliasName="b"
khai ở Include/SVTran-SharedFields.xml
dữ liệu thật: dài nhất 32 ký tự / 10 dòng (đã che, độ dài giữ nguyên)
```

`width 60px` và `dài nhất 32 ký tự` đứng cạnh nhau — đó là toàn bộ câu trả lời cho «cột này có
đủ rộng không». Hover **không** hiện giá trị nào, chỉ độ dài.

**Gợi ý** bật bằng chính ký tự mở:

- gõ `[` trong một `<item value>` → danh sách field, chèn cả cặp ngoặc
- gõ `&` → danh sách entity đã khai, kèm file nó trỏ tới

Danh sách field lấy từ bản **đã bung entity**, nên field đến từ `Include` cũng được gợi ý — đó
lại đúng là phần lớn danh sách ở những program dùng Include nhiều.


## Kích hoạt License

Mọi tính năng Designer chỉ chạy khi đã có **License Key** hợp lệ trên máy của bạn.

### 1. Lấy Machine ID

1. Cài / mở extension **FBO Designer**.
2. Mở **Settings** (`Ctrl+,`) → gõ `FBO Designer` hoặc `machineId`.
3. Copy giá trị **Machine Id** (chuỗi hex, ví dụ `aec330dc91f04a326cf470d5d2ddad61`).

Gửi **Machine Id** + tên công ty / bộ phận cho người cấp license (admin nội bộ).

### 2. Nhận và dán License Key

1. Admin phát hành key (thường dạng `FBO1....`, hạn dùng theo thỏa thuận).
2. Trong Settings → **FBO Designer** → **License Key**, dán toàn bộ key rồi Enter / lưu.
3. Extension kích hoạt offline: không cần gọi server khi dùng hàng ngày.

Khi thành công, **License Key** vẫn hiện trong Settings để bạn đối chiếu. Xóa hết ô License Key = hủy kích hoạt trên máy đó.

### 3. Khi bị khóa

| Hiện tượng | Việc cần làm |
| ---------- | ------------ |
| Thông báo cần License / trang “đang khoá” | Dán key vào Settings như trên |
| License hết hạn | Xin admin key mới, dán đè lên key cũ |
| Machine ID không khớp | Gửi đúng Machine Id máy hiện tại để admin cấp lại |

Machine Id gắn với máy; đổi máy / cài lại Windows thường cần key mới (hoặc key đã gồm Machine Id máy mới).



## Cách dùng nhanh



### 1. Mở bằng chuột phải hoặc lệnh

1. Mở file controller trong `App_Data/Controllers/Dir`, `Filter` hoặc `Grid` (`.xml` / `.f`).
2. Chuột phải → **FBO Designer** → **Mở giao diện giả lập FBO**, hoặc Command Palette / `Ctrl+Alt+O`.
3. Panel luôn render theo file đang active: sửa XML bên trái, form bên phải.



### 2. Kéo thả, thêm hàng / cột / control, swap

![Add row and slot](docs/images/AddRowNSlot.png)

*Rê chuột lên hàng →* `+` *mép ngoài thêm hàng; chọn slot trống →* `(+)` *thêm field.*

![Height](docs/images/Height.png)

*Kéo mép dưới tab để đổi* `view@height`*; vùng main dùng chung chiều cao.*

**Dời và đổi chỗ (swap)**

- Kéo control sang **slot trống** → dời.
- Kéo lên **control khác cùng hàng** → đổi chỗ (swap token, giữ pattern/slot — kể cả khác `colspan`).

**Thêm hàng**

- Rê chuột lên hàng form → nút `+` ngoài mép (một nút, hoặc hai nút khi vùng có `split`) → thêm hàng trống bên dưới.
- Form `split`: `+` trái / `+` phải chèn slot trống một nửa và **dồn nửa kia** của các hàng phía dưới lên (tới trước hàng nhúng lưới Detail), nửa còn lại không bị đẩy xuống dòng trống thừa.
- Tab chỉ chứa lưới Detail không hiện `+` thêm hàng form.
- Hàng / nửa hàng toàn slot trống giữ chiều cao gần hàng có ô nhập (~24px).

**Thêm control (field)**

- Bấm slot trống (ô gạch chéo) → `(+)` giữa ô → thêm field đúng chỗ đó.

**Thêm / chỉnh cột lưới**

- Trên header lưới: nút `(+)` giữa các cột để chèn cột mới tại vị trí đó.

**Tách / gộp biên cột form (**`Tách` **/** `◄Gộp` **/** `Gộp►`**)**

Bấm con số px trên dải thước phía trên bảng. Thanh lệnh:

- `Tách` — chia cột đang chọn thành hai (hỏi bề rộng; mặc định chia đôi, tổng giữ nguyên).
- `◄Gộp` / `Gộp►` — gộp với cột liền trái hoặc liền phải; bề rộng mới = tổng hai cột cũ.

Đây **không** phải tay cầm xanh ở mép ô. Tay cầm xanh đổi số cột **một** control đang trải (trong danh sách biên sẵn có), chỉ ảnh hưởng một hàng. Ba nút trên thước đổi **danh sách biên dùng chung** — mọi hàng đọc cùng `<item value="100, 60, 90">` (header, footer, tab không có `columns` riêng, kể cả Include) đều được viết lại. Designer báo rõ số hàng / số file trước khi ghi.

Từ chối thay vì đoán:

- Gộp hai cột đang giữ hai control khác nhau — bỏ một control trước.
- Gộp đúng vào vạch `split` đang trỏ — đổi `split` trước.

`anchor` và `split` được dời theo chỉ số cột ở mọi trường hợp còn lại.

**Xóa**

- `Delete` xóa control trên form.
- `Shift+Delete` xóa luôn khai báo `<field>` khi được hỗ trợ.



## Ý nghĩa màu trên design

- Cam: mốc đo layout, số px blueprint, nhãn `colspan`
- Xanh dương: vùng đang chọn, ô trống thao tác được, đường/khung phụ trợ
- Xám: ô trống từ Include / nguồn ngoài thường không sửa như ô nội bộ
- Đỏ: vùng chia tách, thao tác xóa, hoặc vị trí kéo không hợp lệ
- Xanh lá: vị trí hợp lệ khi đang dời control
- Nền cam nhạt: hàng đang chọn

Một số màu còn bám theme (dark/light) nên nhìn thực tế có thể hơi khác.

## Biểu tượng và nút thao tác


| Ký hiệu                  | Việc                                                                                                                                                                                                            |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `(+)`                    | Viền form: thêm dòng · Slot trống: thêm control · Grid: thêm cột                                                                                                                                                |
| Delete / Shift+Delete    | Xóa control / kèm `<field>`                                                                                                                                                                                     |
| Drag / drop              | Di dời control; kéo lên control cùng hàng = swap                                                                                                                                                                |
| `⚓`                      | Mỏ neo (`view@anchor`) — kéo ngang để đổi cột neo                                                                                                                                                               |
| `┃` đỏ (`split`)         | Vạch đỏ dọc — ranh giới `view@split` / `category@split`; kéo ngang để dời chỗ chia hai FormTable                                                                                                                |
| `Tách` / `◄Gộp` / `Gộp►` | Bấm số px trên thước form: tách một cột biên thành hai, hoặc gộp với cột liền trái / phải (đổi danh sách biên dùng chung cả vùng)                                                                               |
| `cursor resize`          | Hai mép ô đang chọn, kéo để gộp/tách **một** control (`colspan`), không đổi list px vùng · `Line -- (cam)` ở main thay đổi chiều cao tab (field@rows) · `Line -- (đỏ)` ở main thay đổi chiều cao main (`view@height`) |




## Đóng góp

Báo lỗi, đề xuất thiết kế gửi trực tiếp cho **NGUYENTDH**