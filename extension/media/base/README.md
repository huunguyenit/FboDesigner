# Base pack — CSS nền của form FBO

```
base/css/*.css     nạp tự động, theo thứ tự tên file
base/image/*       ảnh mà CSS trỏ tới bằng `url(../image/…)`
```

Layout `css/` + `image/` phải giữ nguyên: CSS trỏ ảnh bằng đường dẫn tương đối
(`url(../image/fbo-required.png)`), gộp phẳng lại là mất hết ảnh.

## Thứ tự nạp — lặp lại đúng thứ tự runtime

```
designer.css          khung tối giản của extension, thua tất cả
  ↓
base/css/*.css        NỀN
  ↓
<program>\Css\*.css   VÁ — Menu.css chỉ có 8 rule kiểu `padding-right: 1px !important`
```

Đảo thứ tự là để lớp vá bị nền đè, tức là vô hiệu hoá đúng thứ khách đã chỉnh.

## Nguồn hiện tại

| File | Nguồn | Trạng thái |
|---|---|---|
| `fbo-form.css` | `WebResource(2).axd` — CSS runtime thật | **trích nguyên văn** |
| `fbo-lookup.css` | `WebResource(2).axd` | **trích nguyên văn** |
| `fbo-grid.css` | `DevWorkFlow.UI/Config/` + `WebResource(2).axd` | **trộn** — xem đầu file: mỗi rule tự khai nguồn |
| `fbo-{tabs,toolbar}.css` | `DevWorkFlow.UI/Config/` | bản DWF dựng lại, còn nợ |
| `image/fbo-dlg-{title,icon}.gif` | tài nguyên nhúng của `FastBusiness.ReportExtender.dll` | trích |
| `image/*` còn lại | `DevWorkFlow.UI/Config/image/` | bản DWF dựng lại |

CSS runtime thật lấy từ một trang đã lưu bằng *Save page as*:
`DevWorkFlow/.temp/Danh mục khách hàng_files/WebResource(2).axd`. Đó là bản trình duyệt tải về
khi mở `Dir/Customer` trên FSD_Dev, nên nó là **thứ đang chạy**, không phải bản mô phỏng.

Hai ảnh của thanh tiêu đề thì trang lưu KHÔNG có — runtime phát chúng qua
`WebResource.axd?d=…` và trình duyệt không lưu ảnh nền. Chúng được trích từ tài nguyên nhúng
của `FBISP24\bin\FastBusiness.ReportExtender.dll`, chính assembly chứa chuỗi
`UpdateDlgTitleText`. Dải gradient nhận ra được vì nó chứa đúng `#eef6fc` — `background-color`
mà rule `.UpdateDlgTitle` khai làm màu dự phòng.

`fbo-{grid,tabs,toolbar}.css` vẫn là bản dựng lại của DWF, tức vẫn là **nhánh sẽ trôi**. Trả
nốt nợ đó bằng cách mở một màn hình Grid/Filter trên FBO rồi trích tiếp cùng cách.

## Luật của file trích nguyên văn

**Không thêm rule không có trong runtime.** Mỗi rule "cho đẹp" là một lần preview nói dối, và
giá phải trả rơi vào lúc ai đó tin preview rồi sửa XML theo. Chỗ nào buộc phải thêm (vì webview
không có wrapper mà trang runtime có) thì đánh dấu `THÊM` kèm lý do.

Ba thứ từng tự thêm rồi phải gỡ — đừng thêm lại:

| Đã thêm | Hậu quả |
|---|---|
| `.FormContainer { display: inline-block }` | hàng Lookup cao 25,8px thay vì 24 |
| `line-height: 0` ở ô và container | chỉ để bù cho cái inline-block ở trên |
| `.FormCell:first-child { text-align: right }` | runtime canh TRÁI (`textAlign: start`) |

## Số đo runtime để đối chiếu

Đo trên chính trang đã lưu, CSS thật đã nạp:

```
panel        575 ngoài (573 nội dung + 2 viền)
chuỗi bọc    573 → 570   Border viền trái+phải 2px · Floor viền trái 1px
Content      570 ngoài · padding 8 · viền trái 1 → 553 lọt lòng, bảng 550
MỌI hàng     24px — kể cả hàng Lookup, kể cả hàng checkbox
ô nhập       13px · container 16px (13 + padding 1×2 + viền dưới 1)
ô Lookup     input 77px cho ô rộng 100px · icon 15×11
nhãn         canh TRÁI
```

Lưới, đo trên `Hóa đơn bán hàng.html` và `Danh mục khách hàng.html` của cùng thư mục:

```
hàng tiêu đề   30px thường · 60px khi có dải lọc nhanh (`height` đặt inline trên `<tr>`)
container      đệm 4px thường · thêm `padding-top:8px;height:17px` khi có dải lọc
dải lọc        `.FilterPanel` 30px + 1px `border-top`, nằm TRONG `<td>` tiêu đề
nút toán tử    22×22 · mặc định `FilterPanelBackground8` («Thuộc…», tức like '%…%')
lưới nhúng     KHÔNG bao giờ có dải lọc — hàng tiêu đề của nó luôn 30px
```

Dựng lại số này bất cứ lúc nào: `node tools/probe-layout.mjs --serve`.

## Thay bằng CSS runtime thật

Chính xác hơn hẳn, vì đó là thứ runtime đang chạy chứ không phải bản mô phỏng.

1. Mở FBO trên Chrome/Edge, đăng nhập, mở một danh mục rồi bấm **Thêm** cho hộp thoại hiện ra
   — phải có hộp thoại thì stylesheet của nó mới được nạp.
2. F12 → Console → dán:

   ```js
   copy([...document.styleSheets].map(s => {
     try { return `/* ${s.href || 'inline'} */\n` + [...s.cssRules].map(r => r.cssText).join('\n'); }
     catch (e) { return `/* ${s.href} — cross-origin, không đọc được */`; }
   }).join('\n\n'))
   ```

3. Dán ra `runtime.css`, rồi `node tools/import-runtime-css.mjs runtime.css`.

Bộ import liệt kê mọi `url()` sẽ chết: ảnh `WebResource.axd?d=…` phải tải riêng, `http://`
tuyệt đối bị CSP webview chặn, `data:` thì tự sống.

## Cái KHÔNG bỏ vào đây

CSS của program (`<program>\Css\*.css`). Chỗ đó đã nạp tự động từ đường dẫn file đang mở —
chép vào đây là nạp hai lần và ghim cứng CSS của **một** khách vào extension dùng chung.
