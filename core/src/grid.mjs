// grid.mjs — `<grid>` → lưới. Đây là mặt còn lại của controller FBO, và nó KHÔNG dùng đại số
// `item value` chút nào.
//
// Form (`<dir>`, tức `Dir/` và `Filter/`) khai layout bằng một list px cộng chuỗi pattern.
// Lưới (`<grid type="Detail">`, tức `Grid/`) khai layout bằng THỨ TỰ: view của nó là một dãy
// `<field name="x"/>` trần, mỗi cái một cột, bề rộng lấy từ `<fields><field width="N">`.
// Trộn hai lối này vào một hàm render là cách chắc chắn nhất để cả hai cùng sai.
//
// Cột `hidden="true"` (kèm `width="0"`) là khoá kỹ thuật — `stt_rec`, `stt_rec0`, `line_nbr`.
// Runtime không vẽ chúng. Vẽ ra là lưới thừa ba cột rỗng ở cuối, và tổng bề rộng sai.
//
// GIỚI HẠN PHẢI NÓI RÕ: DOM của Form đối chiếu được với HTML runtime thật của `Dir/Site.xml`,
// còn DOM dưới đây thì CHƯA — tên class lấy từ base pack (`fbo-grid.css`, trích từ
// `DevWorkFlow.UI/Config`), cấu trúc lồng là suy ra. Bề rộng cột và thứ tự cột là thứ đọc
// thẳng từ XML nên đúng; phần chrome quanh lưới còn là ước lượng.

import { renderGridControl, isDisabled, resolveLocaleName, alignOf } from './control.mjs';
import { sourceRange, hostRefAt } from './entities.mjs';

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ESCAPES[c]);

/** Cột số thứ tự bên trái, do runtime tự chèn — `fbo-grid.css` khai 24px. */
const INDEX_COL_PX = 24;

/**
 * Chiều cao hàng tiêu đề KHI CÓ dải lọc nhanh — runtime đặt inline `height:60px`.
 *
 * 60 = 8 (đệm trên của container) + 17 (chữ) + 4 (đệm dưới từ `.HeaderCellContainer`)
 *    + 1 (`border-top` của `.FilterPanel`) + 30 (`.FilterPanel`). Không có dải lọc thì hàng
 * không mang `height` inline nào và rơi về 30px của `.HeaderCellDefault`.
 */
const HEADER_ROW_FILTER_PX = 60;

/**
 * Chiều cao hàng tiêu đề khi KHÔNG có dải lọc — mức nền của `.HeaderCellDefault`.
 *
 * `<field rows="N">` chia đôi thành `divHeader` + `divGrid`, nên con số này là thứ trừ ra để
 * biết phần cuộn còn cao bao nhiêu. Xem phép cộng đầy đủ ở `renderGridHtml`.
 */
const HEADER_ROW_PX = 30;

/**
 * `<grid type="…">` nào là MÀN HÌNH DANH SÁCH đứng riêng, rộng bằng khung nhìn.
 *
 * Đếm trên corpus FBISP24: `Report` 652 · `Detail` 416 · `Inquiry` 207 · `Voucher` 167 ·
 * `Planned` 1. `Detail` là loại nhúng trong tab của form — không lưới `Voucher`/`Report` nào
 * được một `<items style="Grid" controller="…">` trỏ tới, nên hai loại này luôn đứng riêng.
 *
 * `Inquiry` và `Planned` KHÔNG có trong danh sách: chúng cũng có thể là màn hình đứng riêng,
 * nhưng chưa đo được runtime của chúng, và thêm vào đây theo cảm giác là quay lại đúng thói tự
 * chế đã phải dọn ở `fbo-grid.css`. Có trang runtime của chúng thì thêm.
 */
const VIEWPORT_GRID_TYPES = new Set(['voucher', 'report']);

/**
 * `type` rỗng hoặc KHÔNG KHAI = màn hình **danh mục**, cũng là màn hình đứng riêng.
 *
 * 557 file trong `Grid/` của FBISP24 không khai `type` — `Account.f`, `AccountDefinition.f`… —
 * nhiều hơn hẳn số file khai `Voucher` (167). Bỏ sót nhánh này là bỏ sót phần lớn màn hình danh
 * sách của cả hệ thống.
 */
function isViewportGrid(type) {
  const t = String(type ?? '').trim().toLowerCase();
  return t === '' || VIEWPORT_GRID_TYPES.has(t);
}

/**
 * `Toolbar.<Command>` → CHUỖI TÀI NGUYÊN runtime tra ra, không phải nhãn đã chẻ sẵn.
 *
 * Vì sao lưu nguyên chuỗi thay vì `{nhãn, tooltip, bề rộng}`: runtime chỉ có MỘT phép chẻ, và
 * nó chạy sau khi tra khoá — `getResources(key)` ra chuỗi, rồi `renderToolbarButton` chẻ chuỗi
 * ấy. Chẻ sẵn ở đây là dựng phép chẻ thứ hai chạy song song, và hai phép chẻ thì trước sau gì
 * cũng lệch nhau. Giữ nguyên chuỗi thì nhãn viết thẳng trong file của khách và nhãn tra từ khoá
 * đi qua đúng một đường.
 *
 * Ngữ pháp chuỗi (đọc từ `renderToolbarButton`, xem `toolbarButton`): `tooltip$nhãn$bềRộng`.
 * Nên `Khóa cột` (không có `$`) là nút CHỈ ICON, còn `Lấy dữ liệu$$120` là nút có chữ rộng
 * tối đa 120px. Đó cũng là cách `Freeze`/`Export`/`Download` thành nút vuông 22px mà không cần
 * bảng liệt kê riêng nào.
 *
 * Số liệu lấy nguyên văn từ HTML runtime đã lưu (`DevWorkFlow/.temp/Hóa đơn bán hàng.html`):
 * nút hiện chữ «Thêm» nhưng `title` là «Thêm dòng (Ctrl + Insert)»; `Retrieve` mang
 * `max-width:120px`; `Grow`/`Down` mang 100; `Clone` mang 90.
 *
 * Khoá lạ thì giữ NGUYÊN VĂN khoá — thà hiện `Toolbar.Xyz` để người đọc biết là chưa dịch,
 * còn hơn hiện một cái tên bịa.
 */
const TOOLBAR_RESOURCES = new Map(Object.entries({
  Insert: ['Thêm dòng (Ctrl + Insert)$Thêm', 'Insert row (Ctrl + Insert)$Insert'],
  New: ['Mới (Ctrl + Insert)$Mới', 'New (Ctrl + Insert)$New'],
  Edit: ['Sửa (Ctrl + E)$Sửa', 'Edit (Ctrl + E)$Edit'],
  Delete: ['Xóa (Ctrl + Delete)$Xóa', 'Delete (Ctrl + Delete)$Delete'],
  Remove: ['Xóa dòng (Ctrl + Delete)$Xóa', 'Delete row (Ctrl + Delete)$Delete'],
  View: ['Xem$Xem', 'View$View'],
  Search: ['Tìm$Tìm', 'Search$Search'],
  Grow: ['Chuyển lên$$100', 'Move up$$100'],
  Down: ['Chuyển xuống$$100', 'Move down$$100'],
  Clone: ['Nhân dòng$$90', 'Clone$$90'],
  /*
   * `Toolbar.Copy` — cùng LỆNH `Clone` nhưng KHÁC KHOÁ, và đó không phải lỗi chính tả của ai:
   * lưới Detail trong tab dùng `Toolbar.Clone` («Nhân dòng»), còn màn hình danh sách dùng
   * `Toolbar.Copy` («Chép dữ liệu»). 109 file trong FBISP24 dùng khoá này.
   *
   * Thiếu nó thì chuỗi rơi về nguyên văn `Toolbar.Copy`, mà chuỗi ấy không có dấu `$` nào → nút
   * thành CHỈ ICON, class `Copy`, và `.Copy` không có ô sprite nào nên nó rơi về ô số 0: icon
   * lệnh «Mới», không chữ. Số liệu lấy từ HTML runtime của màn hình danh sách.
   */
  Copy: ['Chép dữ liệu (Ctrl + Q)$$90', 'Copy (Ctrl + Q)$$90'],
  Print: ['In$In', 'Print$Print'],
  Retrieve: ['Lấy dữ liệu$$120', 'Retrieve$$120'],
  GroupRetrieve: ['Lấy theo nhóm$$120', 'Group retrieve$$120'],
  // Không có `$` = chỉ icon. Đúng như runtime: `title="Khóa cột"` trên một div 22×22 rỗng ruột.
  Freeze: ['Khóa cột', 'Freeze columns'],
  Export: ['Kết xuất', 'Export'],
  ImportData: ['Lấy dữ liệu từ tệp...', 'Import data from file...'],
  Download: ['Tải tệp mẫu...', 'Download template...'],
  Extra: ['Khác...', 'More...'],
}));

/**
 * Một nút toolbar đã phân giải: tooltip · nhãn · bề rộng · có phải group.
 *
 * Đây là bản chép của `renderToolbarButton` trong `ScriptResource.axd` của runtime, và bản chép
 * đó là chủ ý — mọi con số kỳ quặc dưới đây đều là hành vi thật, không phải lựa chọn của ta:
 *
 *   `b.split("$")` → `[tooltip, nhãn, bềRộng]`. MỘT dấu `$`, không phải hai. Chuỗi thật gặp cả
 *   ba dạng: `Bỏ duyệt$$75` (nhãn rỗng), `Chọn kỳ$Chọn...` (nhãn riêng), `Đồ thị$` (chỉ có
 *   tooltip). Đọc `$$` như một dấu duy nhất thì `Chọn kỳ$Chọn...` ra nhãn «Chọn kỳ$Chọn...».
 *
 *   Nhãn rỗng → lấy tooltip CẮT TẠI dấu `(`. Đó là cách «Thêm dòng (Ctrl + Insert)» ra nút chữ
 *   «Thêm dòng» mà tooltip vẫn đủ phím tắt.
 *
 *   KHÔNG có `$` nào → nhãn rỗng hẳn → nút CHỈ ICON, rộng 22px (30px nếu là group). Đây là chỗ
 *   dễ đọc nhầm nhất: `<title v="Tải tệp mẫu..."/>` trông như một nhãn, nhưng runtime vẽ nó
 *   thành cái nút vuông không chữ.
 *
 *   Bề rộng chỉ tính khi chuỗi có ĐỦ ba phần. Có → `max-width:Npx` inline; không có →
 *   class `ToolbarWidthButton` (CSS 60px). Gắn cả hai là nút bị ép về 60px và nhãn dài bị cắt.
 */
export function toolbarButton(button, vi) {
  const raw = String((vi ? button.v : button.e) || button.v || button.e || '');
  const group = Array.isArray(button.menu) && button.menu.length > 0;

  const key = /^Toolbar\.(.+)$/.exec(raw.split('$')[0]);
  const row = key ? TOOLBAR_RESOURCES.get(key[1]) : null;
  // Khoá tra được thì chuỗi tài nguyên thay chỗ khoá; không tra được thì giữ nguyên văn để
  // người đọc thấy là chưa dịch. Nhãn viết thẳng đi thẳng vào phép chẻ, không qua bảng.
  const text = row ? (vi ? row[0] : row[1]) : raw;

  const parts = text.split('$');
  const title = parts[0];
  const label = parts.length > 1
    ? (parts[1] || title.split('(')[0].trim())
    : '';
  const width = parts.length > 2 ? Number.parseInt(parts[2], 10) : NaN;

  return {
    title,
    label,
    width: Number.isFinite(width) ? width : null,
    group,
    menu: group ? button.menu : [],
  };
}

/**
 * Nút này có icon thật không — hỏi CSS, không hỏi một danh sách chép tay.
 *
 * `.ToolbarBackgroundImage` gắn sprite cho MỌI nút mang class đó và mặc định cắt tại `0 0` —
 * ô đầu tiên, icon lệnh «Mới». Nên nút nào không có rule riêng đều hiện icon «Mới» ở bên trái,
 * cộng `text-indent:22px` chừa chỗ cho cái icon không có thật.
 *
 * Bản trước hỏi một `Set` 27 tên lệnh chép tay, và nó sai theo HAI hướng cùng lúc — vì nó so
 * TÊN LỆNH trong khi CSS khai theo TÊN CLASS, mà hai thứ đó khác nhau ở nút có chữ
 * (`Export` → class `TextExport`):
 *
 *   `Export` `Freeze` `Save` `Cancel` `Option` `Page` `Preview` `Aggregate` `GroupToolbarPrint`
 *   có trong Set, nên nút CÓ CHỮ của chúng giữ `ToolbarBackgroundImage`; nhưng CSS chung không
 *   khai `.TextExport`, `.TextFreeze`… nên sprite rơi về `0 0`. Đo trên trình duyệt:
 *   `.TextExport` cho `fbo-toolbar.png @ 0px 0px`, y hệt icon «Mới» — chín lệnh cùng một icon sai.
 *
 *   `Download` và `ImportData` KHÔNG có trong Set, nhưng CSS chung khai đủ cho chúng (ảnh riêng
 *   `fbo-download.png` / `fbo-upload.png`). Danh sách chép tay bỏ sót là nút mất icon thật.
 *
 * Nên luật đúng — và đây là luật chủ hệ thống đã nói: **dù toolbar khai ở đâu thì icon cũng
 * theo CSS quy tắc chung**. Hỏi thẳng CSS, bằng ĐÚNG cái class sắp phát ra, gộp CSS nền của
 * base pack với `<css>` riêng của program. Danh sách chép tay không còn, nên cũng không còn
 * chỗ để nó trôi khỏi CSS.
 */

/**
 * `<css>` của program có khai kiểu cho class này không.
 *
 * So theo BIÊN từ (`\b`) chứ không `includes`: `.Extra` mà khớp bừa vào `.ExtraLarge` thì một
 * nút không có icon lại được coi là có, và ta quay về đúng lỗi đang sửa.
 */
function cssDeclaresClass(css, cls) {
  if (!css || !cls) return false;
  // Chỉ nhận tên class là định danh thuần. `command` đến từ XML của khách, và nhét thẳng nó vào
  // `new RegExp` là để một chuỗi như `a|b` đổi hẳn ý nghĩa của phép so.
  if (!/^[A-Za-z_][\w-]*$/.test(cls)) return false;
  return new RegExp(`\\.${cls}\\b`).test(css);
}

/** `-` (và `Separate`) là dấu ngăn cách, không phải nút. */
function isSeparator(button) {
  return button.command === '-' || button.command === 'Separate' || String(button.v).trim() === '-';
}

/** Ô đệm 1px giữa hai nút — runtime chèn `<td width="1">&nbsp;</td>` giữa MỌI ô. */
const GAP = '<td nowrap width="1">&nbsp;</td>';

/**
 * Danh sách xổ xuống của một nút group — hiện khi rê chuột, thuần CSS.
 *
 * Runtime dựng cái này ở một popup riêng do JS chèn vào cuối `<body>` lúc bấm; ta không chạy JS
 * của runtime nên không thể sao chép chỗ đặt. Nhưng NỘI DUNG thì `<menuItems>` khai thẳng trong
 * file, và với một designer thì đó mới là thứ cần thấy: nút «Lấy dữ liệu» lấy được từ những
 * nguồn nào. Vẽ nó ở đây, trong `<td>` của chính nút, là cách gần nhất mà không phải bịa JS.
 *
 * `-` trong `commandArgument` (và trong nhãn) là vạch ngăn, giống hệt quy ước của `<toolbar>`.
 */
function menuHtml(items, vi) {
  if (!items || items.length === 0) return '';
  const rows = items.map((it) => {
    const text = String(pick(it, vi) ?? '');
    return it.arg === '-' || text.trim() === '-'
      ? '<li class="ToolbarGroupMenuSep"></li>'
      : `<li class="ToolbarGroupMenuItem" data-fbo-arg="${esc(it.arg)}">${esc(text)}</li>`;
  }).join('');
  return `<ul class="ToolbarGroupMenu">${rows}</ul>`;
}

/**
 * Dải nút của lưới, dựng theo ĐÚNG cấu trúc runtime.
 *
 * Runtime không dùng `<button>`: mỗi nút là một `<div>` mang class icon nằm trong một `<td>`
 * riêng của một bảng một hàng. Cấu trúc đó không phải tuỳ tiện — `fbo-toolbar.css` gắn sprite
 * vào `.ToolbarBackgroundImage.Text<Command>`, và hiệu ứng hover là đổi sang
 * `Text<Command>OverGreen`. Dựng bằng `<button>` thì không nút nào có icon, và đó đúng là chỗ
 * bản trước sai.
 *
 * KHÔNG dựng `onclick`/`onmouseover` như runtime: chúng gọi `$find(...).executeCommand(...)`
 * của ASP.NET AJAX, thứ không tồn tại trong webview. Designer chỉ VẼ dải nút, không chạy lệnh —
 * gắn handler chết vào là hứa một thứ bấm không ra gì. Hover đổi class làm bằng CSS thay vì JS.
 *
 * Tên class ghép đúng công thức runtime: `(có chữ ? "Text" : "") + (group ? "Group" : "") + lệnh`.
 * Cả bốn tổ hợp đều có thật trong CSS và trỏ vào bốn ô sprite KHÁC NHAU — `Retrieve` (-448px 0),
 * `GroupRetrieve` (-470px 0), `TextGroupRetrieve` (-672px -44px). Bỏ mảnh `Group` đi là nút
 * «Lấy dữ liệu» rơi vào `TextRetrieve`, thứ CSS runtime không khai, và trình duyệt lấy nốt rule
 * đứng gần nhất — icon của nút «Sửa».
 */
function renderToolbar(buttons, vi, css = '') {
  if (!buttons || buttons.length === 0) return '';

  const cells = [];
  for (const b of buttons) {
    cells.push(GAP);
    if (isSeparator(b)) {
      // Vạch dọc 1px giữa hai nhóm nút — nguyên văn runtime, kể cả màu.
      cells.push('<td nowrap width="1px" style="padding:1px;background-color:white;">'
        + '<div style="height:18px;width:1px;border-width:0px;background-color:#559DFF;"></div></td>');
      continue;
    }

    const { title, label, width, group, menu } = toolbarButton(b, vi);
    const cmd = esc(b.command);
    const cls = `${label ? 'Text' : ''}${group ? 'Group' : ''}${cmd}`;

    // Nút không chữ: bề rộng cứng nằm trên CẢ `<td>` lẫn `<div>`, y như runtime. Group rộng
    // 30px chứ không 22 — chỗ thừa ra là để mũi tên xổ xuống.
    if (!label) {
      const w = group ? 30 : 22;
      /*
       * Nút CHỈ ICON cũng phải qua đúng phép hỏi ấy, và trước đây nó không qua gì cả.
       *
       * Nút không chữ mà class không có rule nào thì `ToolbarBackgroundImage` vẫn dán sprite và
       * cắt tại `0 0` — ra một ô vuông mang icon «Mới». `Compose` của `Grid/SOTran.f` là ca
       * thật, đo được: `.ToolbarBackgroundImage.Compose` cho `fbo-toolbar.png @ 0px 0px`, đúng
       * bằng icon lệnh «Mới».
       *
       * Không có icon thì để ô TRỐNG, giữ nguyên 22px. Tooltip vẫn còn nên nút vẫn nói được nó
       * là lệnh gì; một ô trống nói «chưa có icon», còn một icon sai thì nói dối.
       */
      const iconCls = cssDeclaresClass(css, cls) ? `ToolbarBackgroundImage ${cls}` : 'ToolbarNoIcon';
      cells.push(`<td nowrap style="width:${w}px;">`
        + `<div class="${iconCls}" data-fbo-command="${cmd}"`
        + ` style="height:22px;width:${w}px;border-width:0px;" title="${esc(title)}"></div>`
        + menuHtml(menu, vi) + '</td>');
      continue;
    }

    /*
     * Bề rộng nút có chữ:
     *   chuỗi có đủ ba phần → `max-width:Npx` inline
     *   không có            → class `ToolbarWidthButton` (CSS runtime cho 60px)
     *
     * Đọc từ HTML runtime đã lưu: `Clone` mang `max-width:90px` mà KHÔNG có `ToolbarWidthButton`,
     * còn `New`/`Edit`/`Delete` thì ngược lại. Gắn cả hai là nút bị ép về 60px và nhãn dài bị
     * cắt cụt; không gắn cái nào là nút dài ra hết cỡ theo chữ.
     */
    const sized = width === null ? ' ToolbarWidthButton' : '';
    const cap = width === null ? '' : `max-width:${width}px;`;
    // Nhãn của nút group bị bọc trong `<span class="ToolbarGroupSpan">` — chính cái span đó vẽ
    // mũi tên xổ xuống và chừa 14px bên phải cho nó. Bỏ span là mất mũi tên, và nút group nhìn
    // y hệt nút thường.
    const inner = group
      ? `<span class="ToolbarGroupSpan">${esc(label)}</span>`
      : esc(label);

    /*
     * Không có icon nào cho lệnh này → nút CHỈ CHỮ, và phải bỏ CẢ HAI thứ đi cùng icon:
     * `ToolbarBackgroundImage` (nếu không thì sprite cắt tại `0 0`, tức icon lệnh «Mới» hiện ra
     * sau lưng chữ) và `text-indent:22px` của `ToolbarTextButton` (khoảng chừa cho một icon
     * không tồn tại, đẩy chữ lệch hẳn sang phải rồi bị `max-width` cắt cụt).
     *
     * `PurOrgDeclaration` của `CustomerPurchasingDetail.f` là ca thật: bản chuẩn `.f` không kèm
     * `<css>` khai `div.PurOrgDeclaration`, nên nút ấy vừa mang icon sai vừa mất chữ.
     */
    const hasIcon = cssDeclaresClass(css, cls);
    const iconCls = hasIcon ? `ToolbarBackgroundImage ${cls} ` : '';
    const noIcon = hasIcon ? '' : ' ToolbarNoIcon';
    cells.push('<td nowrap>'
      + `<div class="${iconCls}ToolbarTextButton${noIcon}${sized}" data-fbo-command="${cmd}"`
      + ` style="height:22px;border-width:0px;${cap}" title="${esc(title)}">${inner}</div>`
      + menuHtml(menu, vi) + '</td>');
  }

  /*
   * KHÔNG `overflow:hidden` trên dải nút, và đó là chỗ vừa phải sửa.
   *
   * Menu xổ xuống của nút group (`<ul class="ToolbarGroupMenu">`) nằm TRONG `<td>` của chính
   * nút, tức trong dải nút. Dải mà `overflow:hidden` thì menu bị cắt ngay mép dưới — rê chuột
   * vào chỉ thấy một vạch, đúng triệu chứng «popup bị đè ở dưới». Runtime không gặp chuyện này
   * vì nó chèn popup vào cuối `<body>` bằng JS, thứ ta không chạy.
   *
   * `position:relative` + `z-index` để menu vẽ ĐÈ LÊN lưới: lưới đứng sau trong DOM nên mặc
   * định nó phủ lên menu. Hai thuộc tính này là keo dán của designer, không phải của runtime —
   * runtime không cần vì popup của nó không nằm ở đây.
   */
  return [
    '<div class="ToolbarStyle Green" data-fbo-region="toolbar"',
    // `sticky` chứ không `relative`: bảng lưới rộng hơn khung thì tổ tiên cuộn ngang, và dải nút
    // trôi đi theo dữ liệu trong khi tiêu đề cột lại bám dữ liệu bằng `scrollLeft` riêng của nó.
    // `sticky` neo dải nút tại mép trái vùng nhìn thấy. Nó vẫn tạo tầng riêng nên menu group
    // vẫn vẽ đè lên lưới như cũ.
    ' style="position:sticky;left:0;z-index:5;display:inline-block;height:26px;width:100%;'
      + 'vertical-align:middle;padding-top:2px;">',
    '<table cellpadding="0" cellspacing="0"><tr nowrap>',
    cells.join(''),
    '</tr></table></div>',
  ].join('');
}
/**
 * MỘT hàng mẫu, không hơn.
 *
 * Hàng mẫu tồn tại để trả lời đúng một câu hỏi — «cột này là ô nhập kiểu gì» — và hàng thứ nhất
 * đã trả lời xong. Hàng thứ hai, thứ ba là bản sao rỗng: chúng không nói thêm điều gì, nhưng
 * chiếm mất chiều cao của phần cuộn, đẩy footer khuất xuống dưới trong tab đã bị ghim chiều
 * cao, và làm lưới nhìn như đang có ba dòng dữ liệu thật.
 */
const SAMPLE_ROWS = 1;

function pick(node, vi) {
  if (!node) return null;
  const text = vi ? node.v : node.e;
  if (text !== undefined && text !== '') return text;
  const other = vi ? node.e : node.v;
  return other !== undefined && other !== '' ? other : '';
}

function headerOf(field, vi) {
  const text = pick(field?.header, vi);
  return text === null || text === '' ? (field?.name ?? '') : text;
}

function isHidden(field) {
  if (!field) return false;
  if (String(field.attrs?.hidden ?? '').toLowerCase() === 'true') return true;
  return Number(field.attrs?.width) === 0;
}

/** Bề rộng cột. Không khai `@width` thì runtime tự giãn — ta lấy 100px để lưới còn đọc được. */
function widthOf(field) {
  const w = Number(field?.attrs?.width);
  return Number.isFinite(w) && w > 0 ? w : 100;
}

/**
 * Cột này có Ô LỌC NHANH không — hai luật khác nhau, chọn theo `<grid type>`.
 *
 * Đo trên hai trang runtime đã lưu (`DevWorkFlow/.temp/`), không suy:
 *
 *   `Grid/Customer.f` — lưới danh mục, KHÔNG khai `type`, mỗi field chỉ có `allowFilter="true"`
 *   và không có `<query>` nào. Runtime vẫn vẽ đủ nút + ô nhập cho cả 5 cột.
 *
 *   ARTran đã customize — `type="Voucher"`, các field có `allowFilter="true"` nhưng KHÔNG field
 *   nào khai `<query>`. Runtime vẫn dựng `<div class="FilterPanel">` cho cả 16 cột (kể cả
 *   `stt_rec` ẩn) nhưng để RỖNG — không nút, không ô nhập.
 *
 * Nên với `Voucher`, `allowFilter` một mình chỉ mở ra DẢI lọc; phải có thêm
 * `<query>&InsertCommandFilter;</query>` thì cột mới có ô để gõ. Với các loại còn lại,
 * `allowFilter` là đủ.
 */
function isTrue(v) {
  return String(v ?? '').trim().toLowerCase() === 'true';
}

function isVoucherGrid(type) {
  return String(type ?? '').trim().toLowerCase() === 'voucher';
}

/**
 * Dựng model lưới: danh sách cột hiển thị theo đúng thứ tự khai trong view.
 * Thuần — không sinh HTML, để test được thứ tự/bề rộng mà không so chuỗi.
 */
export function buildGridModel(view, fields, {
  vi = true,
  title = null,
  root = null,
  segments = null,
  hostFile = '',
} = {}) {
  const fieldByName = new Map(fields.map((f) => [f.name, f]));
  const warnings = [];
  const freeze = Number(root?.attrs?.freezeColumns);
  const frozen = Number.isFinite(freeze) && freeze > 0 ? freeze : 0;
  const voucher = isVoucherGrid(root?.attrs?.type);

  const columns = [];
  (view.columns ?? []).forEach((col, i) => {
    const field = fieldByName.get(col.name);
    if (!field) {
      warnings.push({ item: i, message: `cột "${col.name}": không có <field name="${col.name}"> trong <fields>` });
      return;
    }
    /*
     * `sourceRange` quy CẢ dải `<field name="…"/>` về một file. Map riêng hai đầu rồi ghép thì
     * cột khai bằng entity (`<field name="&k;"/>`) cho ra hai file khác nhau, và dải ghép từ hai
     * hệ toạ độ bôi đen mấy chục dòng — đúng lỗi đã sửa cho hàng của form.
     *
     * Cột do `Grid/Config` gộp vào mang `segments` RIÊNG của mảnh nó đến từ. Dùng `segments` của
     * controller cho nó là quy một offset của file khác về file này — bôi đen nhầm chỗ trong một
     * file chẳng liên quan. Không có mảnh riêng thì không có `range`: thà không nhảy được còn
     * hơn nhảy sai.
     */
    const src = col.source ?? { segments, file: hostFile };
    // `<field>` có thể ở file khác `<field name=…/>` trong view — mỗi bên mang dấu nguồn riêng.
    const fieldSeg = field.source ? field.source.segments : segments;
    const range = src.segments ? sourceRange(src.segments, col.start, col.end) : null;
    const origin = range ? { file: range.file, offset: range.start } : null;
    const hostRef = src.segments && hostFile && col.source === null
      ? hostRefAt(src.segments, col.start, hostFile)
      : null;
    const foreign = origin !== null && hostFile !== '' && origin.file !== hostFile;
    // Cột khai trong một file `.f` — bản chuẩn của sản phẩm. Xem ghi chú ở `render.mjs`.
    const product = /\.f$/i.test(origin?.file ?? hostFile ?? '');

    columns.push({
      index: columns.length,
      declared: i,
      // Cột khoá kỹ thuật vẫn được DỰNG, chỉ `display:none` lúc vẽ — runtime cũng vậy.
      // Bỏ hẳn thì chỉ số cột trong model lệch với thứ tự `<field>` khai trong view, và mọi
      // phép sửa cột (chèn/xoá) nhắm sai chỗ ngay khi lưới có một cột ẩn.
      hidden: isHidden(field),
      name: col.name,
      field,
      // Cột ẩn rộng 0, không phải 100 của `widthOf`. Để nguyên 100 thì `data-fbo-width` nói dối,
      // và một cú kéo giãn cột ẩn sẽ bắt đầu từ con số chưa từng có trong file.
      width: isHidden(field) ? 0 : widthOf(field),
      header: headerOf(field, vi),
      required: field.attrs?.allowNulls === 'false',
      disabled: isDisabled(field),
      // `allowFilter` mở DẢI lọc dưới tiêu đề; `filterable` mới là cột có ô để gõ. Xem
      // `isVoucherGrid` — với `type="Voucher"` còn phải có `<query>` không rỗng nữa.
      allowFilter: isTrue(field.attrs?.allowFilter),
      filterQuery: field.query ?? null,
      filterable: isTrue(field.attrs?.allowFilter)
        && (!voucher || (field.query ?? '') !== ''),
      origin,
      // `range` là dải của `<field name="x"/>` TRONG VIEW — chỗ để chèn/xoá một cột.
      range,
      // `widthRange` là dải của giá trị `width="N"` trong khai báo `<fields>` — chỗ để kéo giãn.
      // Hai chỗ khác nhau, ở hai phần khác nhau của file: xoá cột thì đụng view, đổi bề rộng
      // thì đụng khai báo. Nhầm hai cái này là xoá nhầm khai báo khi người dùng chỉ kéo cột.
      // Cùng luật với `range`: `<field>` của cột gộp vào nằm ở file của mảnh, không phải file
      // này. Không có `segments` của mảnh thì để `null` — kéo giãn một cột mà không biết ghi vào
      // đâu thì phải từ chối, chứ không phải ghi bừa vào offset của file khác.
      widthRange: fieldSeg && field.attrSpans?.width
        ? sourceRange(fieldSeg, field.attrSpans.width.start, field.attrSpans.width.end)
        : null,
      fieldTagStart: fieldSeg && field.start !== undefined
        ? sourceRange(fieldSeg, field.start, field.start + 1)
        : null,
      hostRef,
      foreign,
      product,
      /*
       * Cột này đến từ MẢNH CẤU HÌNH ẨN nào — `initialize`, `fields`, hoặc `null` nếu chính
       * controller khai nó.
       *
       * `foreign` đã nói «khai ở file khác», nhưng nó gộp chung ba thứ rất khác nhau: Include
       * kéo qua entity, `Config/Fields/<Tên>.xml`, và `<group>` dùng chung trong
       * `Initialize.xml`. Ba nguồn ấy sửa ở ba chỗ và ảnh hưởng tới ba diện khác nhau — cột của
       * `<group>` là dùng chung cho cả nhóm controller, sửa nó là đổi cho tất cả. Một màu cho
       * cả ba thì người dùng không có cách nào biết mình đang đứng trước cái nào.
       */
      configKind: col.source?.kind ?? null,
    });
  });

  columns.forEach((c) => { c.frozen = c.index < frozen; });

  const widths = [INDEX_COL_PX, ...columns.map((c) => c.width)];
  return {
    mode: 'grid',
    type: root?.attrs?.type ?? null,
    frozen,
    columns,
    visibleColumns: columns.filter((c) => !c.hidden),
    // Dải lọc là chuyện của CẢ HÀNG tiêu đề, không của từng ô: runtime bật nó lên là mọi ô
    // tiêu đề cao thêm 30px cùng lúc, kể cả ô của cột không lọc được.
    hasFilterPanel: columns.some((c) => c.allowFilter),
    filterColumns: columns.filter((c) => c.filterable),
    widths,
    indexWidth: INDEX_COL_PX,
    totalWidth: widths.reduce((a, b) => a + b, 0),
    fieldByName,
    vi,
    title,
    warnings,
    foreignRows: columns.filter((c) => c.foreign).length,
    productColumns: columns.filter((c) => c.product).length,
  };
}

/**
 * Tooltip của ô tiêu đề: tên cột · bề rộng · và NGUỒN nếu nó không nằm trong file lưới.
 *
 * Màu nền đã nói ra rằng cột này đến từ chỗ khác, nhưng màu không nói được CHỖ NÀO — mà đó mới
 * là thứ quyết định sửa ở đâu và sửa xong ảnh hưởng tới ai. Không có tooltip thì bảng màu cần
 * một chú giải, và chú giải thì không có chỗ nào để đặt trong một cái lưới.
 */
function headerTitle(col, label) {
  const base = `${label} · ${col.width}px`;
  if (!col.configKind || !col.range?.file) return base;
  const file = col.range.file.split(/[\\/]/).pop();
  return col.configKind === 'initialize'
    ? `${base} · từ ${file} (nhóm dùng chung — sửa là đổi cho mọi controller cùng nhóm)`
    : `${base} · từ ${file} (bản riêng của controller này)`;
}

function anchorAttrs(col) {
  const origin = col.range
    ? ` data-fbo-file="${esc(col.range.file)}" data-fbo-src-start="${col.range.start}" data-fbo-src-end="${col.range.end}"`
    : '';
  const hostRef = col.hostRef ? ` data-fbo-host-start="${col.hostRef.start}" data-fbo-host-end="${col.hostRef.end}"` : '';
  return origin + hostRef + (col.foreign ? ' data-fbo-foreign="1"' : '')
    + (col.product ? ' data-fbo-product="1"' : '')
    + (col.configKind ? ` data-fbo-config="${esc(col.configKind)}"` : '');
}

/**
 * @param {object} model
 * @param {{embedded?: boolean, bodyHeight?: number|null}} opts
 *   `embedded` — lưới nằm TRONG một tab của form, không phải màn hình lưới đứng riêng.
 *   `bodyHeight` — `<field rows="N">` của ô chứa lưới: chiều cao phần thân, px.
 */
export function renderGridHtml(model, { embedded = false, bodyHeight = null } = {}) {
  const fitWidth = !embedded && isViewportGrid(model.type);

  /*
   * Bề rộng nằm trên TỪNG `<td>`, không phải trên bảng.
   *
   * Lưới runtime là `<table class="GridTable" cellpadding="0" cellspacing="0">` — KHÔNG có
   * `width`, KHÔNG có `table-layout:fixed`. Mỗi ô tự mang `style="overflow:hidden;width:Npx"`,
   * và bên trong còn một div container mang lại đúng bề rộng đó. Khác hẳn Form (bảng fixed +
   * colspan), nên hai bên phải dựng khác nhau — đó cũng là cách runtime cho kéo giãn cột: nó
   * sửa width của td, chứ không sửa một list px chung.
   */
  const cellStyle = (c) => (c.hidden
    ? 'overflow:hidden;width:0px;display:none;'
    : `overflow:hidden;width:${c.width}px;`);

  /*
   * Tooltip hiện tên ĐÃ PHÂN GIẢI hậu tố ngôn ngữ, `data-fbo-column` thì giữ NGUYÊN VĂN.
   *
   * Hai việc khác nhau: tooltip để người đọc biết cột này lấy dữ liệu từ cột database nào —
   * `ten_kh%l` chẳng nói gì, `ten_kh` hay `ten_kh2` mới nói. Còn `data-fbo-column` là khoá tầng
   * edit tra ngược về `<field name="…">` trong XML; phân giải nó là mọi phép sửa cột tìm không
   * ra field và im lặng từ chối.
   */
  const localName = (c) => resolveLocaleName(c.name, model.vi);

  const colAttrs = (c) => ` data-fbo-col="${c.index + 1}" data-fbo-span="1" data-fbo-width="${c.width}"`
    + ` data-fbo-column="${esc(c.name)}"${c.hidden ? ' data-fbo-hidden="1"' : ''}`;

  /*
   * DẢI LỌC NHANH dưới hàng tiêu đề — `<div class="FilterPanel">`.
   *
   * Ba con số dưới đây đo trên trang runtime đã lưu, không suy:
   *
   *   không có dải lọc   `<tr class="GridHeader">` cao 30px; container tiêu đề chỉ mang
   *                      `width` (đệm 4px lấy từ `.HeaderCellContainer`)
   *   có dải lọc         hàng cao **60px**; container tiêu đề mang thêm
   *                      `padding-top:8px;height:17px` inline, và MỌI ô tiêu đề nhận thêm một
   *                      `<div class="FilterPanel">` (8 + 17 + 4 = 29 ≈ 30, cộng 30 của dải và
   *                      1px `border-top` của nó ra đúng 60)
   *
   * Dải rỗng vẫn phải dựng cho cột không lọc được — kể cả cột `hidden`. Chỉ dựng cho cột lọc
   * được thì ô tiêu đề của các cột kia hụt 30px và hàng tiêu đề gãy làm hai tầng cao thấp;
   * runtime cũng dựng đủ (đo trên ARTran: 16 dải, không dải nào có nội dung).
   *
   * `data-fbo-filter="1"` đánh dấu cột CÓ ô lọc — chỗ để tầng vỏ và test bám vào. Dải lọc
   * KHÔNG mang `data-fbo-col` riêng: nó nằm trong `<td>` tiêu đề vốn đã có, nên bấm vào dải là
   * chọn đúng cột ấy, không cần thêm một slot thứ hai chỉ về cùng một chỗ.
   */
  const showFilter = !embedded && model.hasFilterPanel;

  /*
   * Nút toán tử mặc định là `FilterPanelBackground8` — "Thuộc…", tức `like '%…%'`.
   *
   * Đọc từ menu toán tử của runtime: 1 Bằng · 2 Không bằng · 3 Nhỏ hơn · 4 Lớn hơn · 5 Nhỏ hơn
   * hoặc bằng · 6 Lớn hơn hoặc bằng · 7 Bắt đầu bằng… · 8 Thuộc… · 9 Không thuộc… · 10 Lọc…
   * Cả 5 cột của trang danh mục đã lưu đều mở ra ở 8.
   *
   * GIỚI HẠN PHẢI NÓI RÕ: `FilterPanelBackground11`…`15` cũng có trong CSS runtime và gần như
   * chắc chắn là menu của cột SỐ / NGÀY, nhưng trang đã lưu không có cột nào mở ra ở đó. Nên
   * mọi cột ở đây đều vẽ nút 8. Có trang runtime của một cột số thì sửa lại chỗ này — đoán
   * thêm bây giờ chính là thói tự chế đã phải dọn ở `fbo-grid.css`.
   */
  const FILTER_OP_DEFAULT = 'FilterPanelBackground8';

  const filterPanel = (c) => {
    if (!showFilter) return '';
    if (!c.filterable) return '<div class="FilterPanel"></div>';
    return '<div class="FilterPanel">'
      + `<span class="FilterPanelButton ${FILTER_OP_DEFAULT}">&nbsp;</span>`
      // `readonly`: ô này là HÌNH của runtime, không phải bộ lọc chạy được — designer không có
      // dữ liệu để lọc. Cùng lối với ô lưới bị khoá ở `control.mjs`.
      + '<input type="text" class="FilterPanelText" value="" readonly tabindex="-1"'
      + ' autocomplete="off" spellcheck="false">'
      + '</div>';
  };

  const headerContainerStyle = (c) => 'display:inline-block;overflow:hidden;'
    + (showFilter ? 'padding-top:8px;height:17px;' : '')
    + `width:${c.hidden ? 0 : c.width}px;vertical-align:middle;`;

  const header = model.columns.map((c) => {
    const cls = ['HeaderCellDefault'];
    if (c.required) cls.push('Required');
    if (c.frozen) cls.push('GridFrozen');
    return `<td nowrap class="${cls.join(' ')}" style="${cellStyle(c)}"${colAttrs(c)}`
      + `${c.filterable ? ' data-fbo-filter="1"' : ''}`
      + ` data-fbo-token="[${esc(c.name)}]"${anchorAttrs(c)} title="${esc(headerTitle(c, localName(c)))}">`
      + `<div align="center" class="HeaderCellContainer"`
      + ` style="${headerContainerStyle(c)}">`
      + `${esc(c.header)}</div>${filterPanel(c)}</td>`;
  }).join('');

  // Hàng 1 mang control thật để thấy loại ô; các hàng sau để trống — nhân bản control chỉ tạo
  // ra id trùng nhau mà không nói thêm điều gì.
  /*
   * `text-align` đặt trên CẢ container lẫn control.
   *
   * Trên control để chữ trong ô nhập canh đúng phía; trên container vì `<input type="checkbox">`
   * KHÔNG nghe `text-align` — nó là một hộp cỡ cố định, chỉ dịch khi thứ bọc nó canh nó. Thiếu
   * vế container là cột `type="Boolean"` vĩnh viễn dính lề trái. Xem `alignOf`.
   */
  const dataCell = (c, inner) => {
    const align = alignOf(c.field);
    return `<td nowrap class="CellDefault${c.frozen ? ' GridFrozen' : ''}"`
      + ` style="${cellStyle(c)}"${colAttrs(c)}${anchorAttrs(c)}>`
      + `<div class="RowCellContainer" style="height:14px;width:${c.hidden ? 0 : c.width}px;`
      + `vertical-align:middle;${align ? `text-align:${align};` : ''}">`
      + `${inner}</div></td>`;
  };

  const firstRow = model.columns
    .map((c) => dataCell(c, c.hidden ? '' : renderGridControl(c.field, { vi: model.vi, cellWidth: c.width })))
    .join('');
  const blankRow = model.columns.map((c) => dataCell(c, '')).join('');

  // Cột STT do runtime tự chèn — không có `<field>` nào khai nó, nên không có gì để sửa và
  // cũng không có chỗ nào trong XML để nhảy tới. Không gắn `data-fbo-col`: gắn vào là
  // `wireSelection` bám theo và ô này chọn được nhưng bấm vào không ra gì.
  const indexCell = (cls, n) => `<td class="${cls}" style="width:${INDEX_COL_PX}px;">`
    + `<div style="width:${INDEX_COL_PX}px;height:17px;">${n}</div></td>`;

  const body = [`<tr class="GridDataRow">${indexCell('IndexCellBody', 1)}${firstRow}</tr>`];
  for (let i = 2; i <= SAMPLE_ROWS; i++) {
    body.push(`<tr class="GridDataRow">${indexCell('IndexCellBody', i)}${blankRow}</tr>`);
  }

  const caption = pick(model.title, model.vi) ?? '';
  // Lưới nhúng trong tab KHÔNG có thanh tiêu đề riêng: nhãn của nó chính là nhãn tab.
  const heading = embedded || caption === ''
    ? ''
    : `<div class="HeaderStyle UpdateDlgTitleText">${esc(caption)}</div>`;

  const toolbar = renderToolbar(model.toolbar, model.vi, model.toolbarCss ?? model.css ?? '');

  /*
   * `<field rows="N">` = divHeader + divGrid. KHÔNG gồm toolbar, divSplit, hay dải cuộn.
   *
   * Bản trước đọc `rows` là «divGrid + divSplit + divFooter» và ra CÙNG một con số cho ca
   * thường (242 − 8 − 22 = 212 = 242 − 30), nên nó trông như đúng. Hai cách đọc chỉ tách ra khi
   * hàng tiêu đề KHÔNG cao 30 — tức đúng lúc lưới có dải lọc nhanh, hàng tiêu đề 60px. Khi ấy
   * cách đọc cũ cho divGrid 212 trong khi chỗ thật chỉ còn 182, và cả khối cao hơn tab 30px.
   *
   * Phép cộng đầy đủ, theo lời chủ hệ thống, cho `<view height="302">` và `<field rows="242">`:
   *
   *   toolbar    30   cố định, KHÔNG nằm trong `rows`
   *   divHeader  30   (60 nếu có dải lọc nhanh)
   *   divGrid   212   = rows − divHeader
   *   divSplit    8   tay nắm kéo, một icon
   *   cuộn       22
   *   ────────────
   *   view       302  = chiều cao vùng main (thân tab), KHÔNG gồm thanh nhãn tab
   *
   * `blockPx` là chiều cao CẢ KHỐI — thứ phải so với `view@height` để biết một `rows` có khai
   * vượt vùng main hay không.
   */
  const TOOLBAR_PX = 30;
  const SPLIT_PX = 8;
  const FOOTER_PX = 22;
  const headerPx = showFilter ? HEADER_ROW_FILTER_PX : HEADER_ROW_PX;
  const scrollPx = bodyHeight !== null && bodyHeight > headerPx
    ? bodyHeight - headerPx
    : null;
  const blockPx = bodyHeight === null
    ? null
    : TOOLBAR_PX + bodyHeight + SPLIT_PX + FOOTER_PX;
  /*
   * Theo HTML runtime chuẩn của tab lưới:
   *   divGrid  -> cuộn dọc
   *   divFooter -> cuộn ngang
   *   divHeader -> đứng yên, chỉ nhận scrollLeft đồng bộ
   *
   * `auto` chứ không `scroll` để thanh chỉ hiện khi thật sự thiếu chỗ.
   */
  const bodyStyle = embedded || fitWidth
    ? ` style="${scrollPx === null ? '' : `height:${scrollPx}px;`}overflow-x:hidden;overflow-y:auto;"`
    : '';

  // Lưới đứng riêng bị ghim bề rộng để đối chiếu với runtime. Lưới nhúng thì KHÔNG: ô chứa nó
  // đã có bề rộng của cột trong form, ghim thêm một lần nữa là lưới thò ra ngoài tab.
  /*
   * Lưới nhúng KHÔNG được rộng hơn ô chứa nó.
   *
   * Lưới nhiều cột (có cái 15–20 cột) rộng hơn hẳn bề ngang form. Để nó tự giãn thì nó đẩy
   * toàn bộ tab phình ra và form mất luôn hình dạng thật. Runtime cũng không làm vậy: nó giới
   * hạn theo ô rồi cho CUỘN NGANG phần còn lại — `divGrid` mang `overflow:auto`, và `divHeader`
   * được kéo theo bằng `scrollLeft` (xem `syncGridScroll` phía webview).
   */
  /*
   * Lưới ĐỨNG RIÊNG kiểu danh sách (`Voucher` / `Report`) rộng bằng khung nhìn, không bằng tổng
   * px của cột.
   *
   * Đây là màn hình danh sách — «Hóa đơn bán hàng: thêm, sửa, xóa…» — chứ không phải một cái
   * dialog. Runtime cho nó chiếm hết bề ngang cửa sổ trình duyệt rồi cuộn ngang phần cột thừa;
   * nó không có bề rộng cố định nào để mà đối chiếu. Ghim `width: tổng px` như lưới Detail thì
   * một danh sách 15 cột kéo trang designer rộng ra hàng nghìn px, và mọi thứ khác trên trang
   * (thanh trạng thái, thước) dài theo.
   *
   * Phân biệt bằng `@type`, đúng như runtime phân biệt:
   *   `Detail`            → nhúng trong tab của form; bề rộng do ô chứa quyết
   *   `Voucher` / `Report` → màn hình danh sách đứng riêng; rộng bằng khung nhìn
   * Kiểu khác (`Inquiry`, `Planned`, hoặc không khai) giữ nguyên lối cũ — ghim theo tổng px —
   * vì chưa đo được runtime của chúng, và đoán thêm ở đây là quay lại đúng thói tự chế đã phải
   * dọn ở `fbo-grid.css`.
   *
   * `GridFitWidth` là tín hiệu cho tầng vỏ: `#fbo-stage` vốn `inline-block` để ôm sát form, nên
   * `width:100%` ở đây một mình không đủ — phần trăm sẽ quy về chính bề rộng co theo nội dung.
   * Xem `fbo-fit-width` ở `designer.css`.
   */
  const panelStyle = embedded
    ? ' style="max-width:100%;overflow:hidden;"'
    : (fitWidth
      ? ' style="width:100%;overflow:hidden;"'
      : ` style="width:${model.totalWidth + 2}px;"`);
  const panelClass = embedded
    ? 'GridTabPanel GridEmbedded'
    : `FormParent GridTabPanel${fitWidth ? ' GridFitWidth' : ''}`;
  // Nguyên văn runtime: KHÔNG width, KHÔNG table-layout — bề rộng nằm trên từng `<td>`.
  const table = (extra) => `<table class="GridTable" cellpadding="0" cellspacing="0"${extra}>`;

  // Header nằm ở BẢNG RIÊNG trong `divHeader`, không cùng bảng với thân — đó là cách runtime
  // giữ tiêu đề cột đứng yên khi thân cuộn. Gộp chung một bảng thì cuộn là mất luôn tiêu đề.
  /*
   * Hàng tổng KHÔNG mang `data-fbo-*` — nó là CHROME, không phải slot sửa được.
   *
   * Runtime có hàng này thật (đo được trên trang đã lưu: một `FooterCellDefault` cho mỗi cột,
   * `AggregationLayout`, cao 22px), nên vẫn phải vẽ; bỏ đi là lưới hụt 22px và mọi phép tính
   * chiều cao `rows` lệch theo. Nhưng gắn `data-fbo-col`/`data-fbo-column` lên nó thì
   * `wireSelection` bám vào, và người dùng bấm được một ô rỗng: có viền chọn, không có thanh
   * lệnh, không nhảy tới XML được (footer không có `data-fbo-src-start` để mà nhảy). Một vùng
   * trông như bấm được mà bấm không ra gì thì tệ hơn một vùng rõ ràng là trang trí.
   *
   * Cột STT bên trái cũng vậy — xem `indexCell`.
   */
  const footerCells = model.columns
    .map((c) => `<td nowrap class="FooterCellDefault" style="${cellStyle(c)}">`
      + '<div align="right" class="FooterCellContainer"'
      + ` style="display:inline-block;overflow:hidden;width:${c.hidden ? 0 : c.width}px;height:17px;vertical-align:middle;">`
      + '</div></td>')
    .join('');

  return [
    // `data-fbo-block` = chiều cao CẢ KHỐI theo phép cộng ở trên. Đây là con số phải so với
    // `view@height` để biết một `<field rows>` có khai vượt vùng main hay không — soi được từ
    // DOM, không phải tính lại bằng tay.
    /*
     * `data-fbo-grid` = TÊN CONTROLLER của chính lưới này, và nó phải nằm trên panel.
     *
     * Trước đây dấu này chỉ được gắn ở một chỗ duy nhất: ô `<td class="FormCellGrid">` của FORM
     * chứa lưới nhúng (`renderEmbeddedGrid`). Nên mở thẳng một `Grid/X.xml` ra thì trên cả trang
     * không có `data-fbo-grid` nào — `gridColTarget` ở webview tra ngược không thấy, trả `null`,
     * và cú `mousedown` kéo giãn cột thoát ra ngay từ dòng đầu. Nhìn ra ngoài đúng như «cột lưới
     * không kéo được», và với lưới đứng riêng thì KHÔNG phép sửa cột nào chạy: chèn, xoá, kéo
     * giãn đều đi qua cùng một hàm tra tên ấy.
     *
     * Gắn trên panel thì cả hai lối cùng chạy. Lưới nhúng có thêm một dấu nữa trên ô của form —
     * không sao, `closest` lấy cái GẦN NHẤT, tức chính panel này, và hai dấu mang cùng một tên.
     */
    `<div class="${panelClass}" data-fbo-mode="grid"${model.controller ? ` data-fbo-grid="${esc(model.controller)}"` : ''}`
      // Ngăn bằng `|`: đường dẫn Windows không bao giờ chứa ký tự này, nên tách lại ở webview
      // không cần biết gì về cú pháp đường dẫn.
      + `${(model.relatedFiles ?? []).length > 1 ? ` data-fbo-related="${esc(model.relatedFiles.join('|'))}"` : ''}`
      + `${blockPx === null ? '' : ` data-fbo-block="${blockPx}"`}`
      // `data-fbo-rows` = đúng `field@rows` (body), không gồm toolbar/split/footer.
      + `${bodyHeight === null ? '' : ` data-fbo-rows="${bodyHeight}"`}${panelStyle}>`,
    heading,
    toolbar,
    '<div class="HeaderStyle divHeader" style="overflow:hidden;position:relative;">',
    table(` data-fbo-col-widths="${model.widths.join(',')}"`),
    // Chiều cao hàng tiêu đề đặt INLINE, đúng như runtime — `.HeaderCellDefault{height:30px}` của
    // `fbo-grid.css` là mức nền, dải lọc đẩy hàng lên 60px. Xem `filterPanel`.
    `<tr class="GridHeader"${showFilter ? ` style="height:${HEADER_ROW_FILTER_PX}px;"` : ''}>`
      + `${indexCell('IndexCellHeader', '')}${header}</tr>`,
    '</table>',
    '</div>',
    `<div class="GridStyle divGrid"${bodyStyle}>`,
    table(''),
    body.join('\n'),
    '</table>',
    '</div>',
    `<div class="SplitStyle divSplit" style="height:${SPLIT_PX}px;"></div>`,
    `<div class="FooterStyle divFooter" style="overflow-x:auto;overflow-y:hidden;height:${FOOTER_PX}px;">`,
    table(''),
    `<tr class="GridFooter">${indexCell('IndexCellFooter', '')}${footerCells}</tr>`,
    '</table>',
    '</div>',
    '</div>',
  ].join('\n');
}

/**
 * `arrangement="a:%l0;b:%a(x);c:%b(y)"` — chỗ đứng của từng cột được cấu hình chèn thêm.
 *
 * Cột do cấu hình ẩn mang vào mặc định nối đuôi danh sách. `arrangement` là cách khai nó phải
 * đứng ở đâu, và ĐÂY LÀ THỨ TỰ NGƯỜI DÙNG THẤY — sai thứ tự thì preview vẫn đủ cột nhưng bố cục
 * không còn giống màn hình thật.
 *
 *   `%a(x)`  đứng NGAY SAU cột `x`
 *   `%b(x)`  đứng NGAY TRƯỚC cột `x`
 *   `%l0`    đứng sau cột CUỐI CÙNG KHAI TRONG FILE GRID
 *
 * `%l0` KHÔNG phải «nối vào cuối danh sách». Mốc của nó là cột cuối cùng của chính file
 * controller — với `Grid/SOTran.f` là `ma_nt` — chứ không phải cột cuối sau khi đã gộp. Hai cách
 * đọc chỉ trùng nhau khi đúng một cột được chèn thêm; từ cột thứ hai trở đi là khác.
 *
 * Mốc ấy TIẾN DẦN: `a:%l0;b:%l0` cho ra `…, ma_nt, a, b`, không phải `…, ma_nt, b, a`. Đứng yên
 * thì một dãy 11 cột cùng `%l0` — có thật, xem `Config/Fields/*.xml` — sẽ hiện ra theo thứ tự
 * ngược với thứ tự khai.
 *
 * Cột nào là «khai trong file Grid»: cột không mang dấu nguồn (`source == null`). `mergeGridConfig`
 * đóng dấu nguồn lên mọi cột đến từ `Grid/Config`, nên phân biệt được mà không phải truyền thêm gì.
 *
 * Tên cột có thể mang hậu tố `%l` (`ten_kh%l`), tức chính ký tự `%` vừa dùng làm dấu lệnh — nên
 * phải bóc `%a(` / `%b(` bằng neo đầu chuỗi chứ không bằng cách tìm dấu `%` gần nhất. Mốc neo so
 * theo tên NGUYÊN VĂN: cột trong model cũng mang `ten_kh%l`, phân giải trước khi so là không
 * khớp được với gì.
 *
 * Áp TUẦN TỰ, không gom lại rồi sắp một lượt: `b:%a(a);c:%a(b)` nghĩa là c đứng sau b sau khi b
 * đã dời chỗ. Gom lại mà sắp thì `c` neo vào vị trí CŨ của `b`.
 *
 * Neo vào một cột không tồn tại thì để cột đó ở nguyên chỗ cũ và ghi cảnh báo — đẩy nó về cuối
 * lặng lẽ là giấu mất một khai báo hỏng.
 */
export function applyArrangement(columns, arrangement, warnings = []) {
  const raw = String(arrangement ?? '').trim();
  if (raw === '') return columns;

  const out = [...columns];

  /*
   * Mốc của `%l0`: ngay sau cột cuối cùng KHAI TRONG FILE GRID.
   *
   * Ghim bằng chính đối tượng cột chứ không bằng chỉ số — mọi luật `%a`/`%b` chạy trước đó đều
   * có thể đã dời chỗ nó, và một chỉ số ghi lại từ đầu vòng lặp sẽ trỏ vào cột khác. Tìm lại vị
   * trí ngay trước mỗi lần dùng.
   */
  const lastOwn = [...out].reverse().find((c) => c.source == null) ?? null;
  let lastPlaced = null;

  for (const rule of raw.split(';')) {
    const cut = rule.indexOf(':');
    if (cut === -1) continue;
    const name = rule.slice(0, cut).trim();
    const spec = rule.slice(cut + 1).trim();
    if (name === '' || spec === '') continue;

    const from = out.findIndex((c) => c.name === name);
    if (from === -1) {
      warnings.push({ item: null, message: `arrangement: không có cột "${name}"` });
      continue;
    }

    const m = /^%([ab])\((.+)\)$/.exec(spec);
    if (!m) {
      if (!/^%l/i.test(spec)) {
        warnings.push({ item: null, message: `arrangement: không đọc được "${rule.trim()}"` });
        continue;
      }
      // `%l0`: sau cột cuối của file Grid, và mốc tiến dần theo từng luật để hai cột cùng `%l0`
      // giữ đúng thứ tự khai. Không có cột nào của file Grid thì mốc là đầu danh sách.
      const [moved] = out.splice(from, 1);
      const anchor = lastPlaced ?? lastOwn;
      const at = anchor ? out.indexOf(anchor) : -1;
      out.splice(at + 1, 0, moved);
      lastPlaced = moved;
      continue;
    }

    const anchorName = m[2].trim();
    const anchor = out.findIndex((c) => c.name === anchorName);
    if (anchor === -1) {
      warnings.push({ item: null, message: `arrangement: cột "${name}" neo vào "${anchorName}" nhưng không có cột đó` });
      continue;
    }
    if (anchor === from) continue;

    const [moved] = out.splice(from, 1);
    // Gỡ cột ra rồi mới tìm lại mốc: chỉ số của mốc dịch một nấc nếu nó đứng SAU chỗ vừa gỡ.
    const at = out.findIndex((c) => c.name === anchorName);
    out.splice(m[1] === 'a' ? at + 1 : at, 0, moved);
  }
  return out;
}

/**
 * Gộp cấu hình ẩn của `Grid/Config` vào view và `<fields>` của controller.
 *
 * Hai nguồn, và cả hai đều KHÔNG nằm trong file controller nên đọc file controller thôi là thiếu
 * cột — đúng chỗ preview khác màn hình thật mà không có dấu hiệu gì:
 *
 *   `Grid/Config/Initialize.xml`   `<controller name="AITran" group="001"/>` → thân `<group id="001">`
 *   `Grid/Config/Fields/<Tên>.xml` khai riêng cho từng controller, và mang cả `arrangement`
 *
 * Mỗi mảnh đi kèm `segments` + `file` CỦA CHÍNH NÓ. Bắt buộc: cột của mảnh nằm ở file khác, nên
 * quy offset của nó bằng `segments` của controller là bôi đen nhầm chỗ trong một file chẳng
 * liên quan. Cột nào không có `segments` riêng thì không có `range` — thà không nhảy được còn
 * hơn nhảy sai.
 *
 * Trùng tên thì bản của CONTROLLER thắng: cấu hình ẩn là phần bổ sung dùng chung, còn controller
 * là chỗ khai riêng cho màn hình này.
 */
function mergeGridConfig(view, fields, config, warnings) {
  if (!config || config.length === 0) return { view, fields, arrangement: '' };

  const byName = new Map(fields.map((f) => [f.name, f]));
  const outFields = [...fields];
  const outColumns = (view.columns ?? []).map((c) => ({ ...c, source: null }));
  const seen = new Set(outColumns.map((c) => c.name));
  let arrangement = '';

  /*
   * THỨ TỰ CỘT, từ mạnh tới yếu — bốn nguồn, và ba trong số đó nằm ngoài file controller:
   *
   *   1. `Grid/<Tên>`                      view của chính controller: cột nào khai ở đây đứng
   *                                        trước, đúng thứ tự khai
   *   2. `Grid/Config/Fields/<Tên>`        thuộc tính `arrangement` — luật neo `%a()`/`%b()`/`%l0`
   *                                        chạy SAU CÙNG nên nó nói lời cuối về vị trí
   *   3. `Grid/Config/Fields/<Tên>`        các cột file ấy khai thêm
   *   4. `Grid/Config/Initialize.xml`      cột của `<group>` dùng chung
   *
   * Bản trước xếp 4 TRƯỚC 3 (chỉ vì `loadGridConfig` đẩy `Initialize` vào mảng trước), nên cột
   * dùng chung của cả nhóm chen lên trước cột khai riêng cho chính controller này — ngược hẳn
   * mức độ cụ thể của hai nguồn.
   *
   * Xếp bằng `rank` chứ không dựa vào thứ tự mảng người gọi đưa vào: thứ tự ấy là chi tiết cài
   * đặt của tầng vỏ, còn luật ưu tiên là quy ước của FBO. Sắp ỔN ĐỊNH để hai mảnh cùng hạng giữ
   * nguyên thứ tự đọc file.
   */
  const ordered = [...config]
    .map((p, i) => ({ p, i }))
    .sort((x, y) => (x.p.rank ?? 1) - (y.p.rank ?? 1) || x.i - y.i)
    .map((x) => x.p);

  for (const part of ordered) {
    // Nguồn đóng dấu lên TỪNG field, không suy từ nguồn của cột: một cột của mảnh A hoàn toàn có
    // thể trỏ vào `<field>` khai trong controller. Suy chéo là quy offset của file này về file kia.
    const source = { segments: part.segments ?? null, file: part.file ?? '' };
    for (const f of part.fields ?? []) {
      if (byName.has(f.name)) continue;
      const tagged = { ...f, source };
      byName.set(f.name, tagged);
      outFields.push(tagged);
    }
    for (const c of part.columns ?? []) {
      if (seen.has(c.name)) continue;
      seen.add(c.name);
      outColumns.push({
        ...c,
        source: { segments: part.segments ?? null, file: part.file ?? '', kind: part.kind ?? null },
      });
    }
    /*
     * `arrangement` lấy từ mảnh CỤ THỂ NHẤT — mảnh hạng cao nhất khai nó.
     *
     * `ordered` đã xếp `Config/Fields/<Tên>.xml` (hạng 1) trước `Initialize.xml` (hạng 2), nên
     * "mảnh đầu tiên khai" chính là mảnh riêng của controller. Bản trước lấy mảnh CUỐI, thứ chỉ
     * đúng nhờ thứ tự mảng cũ — đảo thứ tự ấy là `Initialize` lặng lẽ giành mất quyền sắp xếp.
     */
    if (part.arrangement && arrangement === '') arrangement = part.arrangement;
  }

  return {
    view: { ...view, columns: applyArrangement(outColumns, arrangement, warnings) },
    fields: outFields,
    arrangement,
  };
}

/** Lưới lấy view id="Grid" nếu có; không có thì view đầu tiên có khai cột. */
export function renderGrid(views, fields, opts = {}) {
  const picked = views.find((v) => (v.columns ?? []).length > 0) ?? views[0];
  const configWarnings = [];
  const merged = mergeGridConfig(picked, fields, opts.config, configWarnings);
  const view = merged.view;
  const model = buildGridModel(view, merged.fields, opts);
  model.warnings.push(...configWarnings);
  model.toolbar = opts.toolbar ?? [];
  /*
   * CSS mà `renderToolbar` hỏi để biết nút nào có icon = CSS NỀN + `<css>` của program.
   *
   * Hai lớp, và thiếu lớp nào cũng ra một loại sai riêng:
   *   `baseCss`  base pack (`fbo-toolbar.css`) — nguồn của mọi icon chuẩn. Thiếu nó thì KHÔNG
   *              nút chuẩn nào có icon.
   *   `css`      `<css>` của controller/program — nguồn duy nhất của icon nút riêng của khách
   *              (`div.APTranImport` với ảnh base64 của chính nó). Thiếu nó thì nút riêng mất icon.
   *
   * Core không đọc đĩa, nên `baseCss` do tầng vỏ truyền vào (xem `inlineBaseCss` ở
   * `render-host.js` và `tools/probe-layout.mjs`).
   */
  /*
   * Tên controller của lưới — khoá mà tầng edit dùng để tìm lại đúng file cần ghi.
   *
   * Lưới NHÚNG biết tên từ `<items controller="X"/>` của form, nên `renderEmbeddedGrid` truyền
   * thẳng vào. Lưới ĐỨNG RIÊNG thì không ai nói cho nó biết — tên nó chính là tên file đang mở,
   * và `hostFile` là thứ duy nhất mang thông tin ấy. Cắt bằng chuỗi, không bằng `path`: core
   * không được phụ thuộc vào module của Node (ADR-0002), và ở đây chỉ cần bỏ thư mục với đuôi.
   */
  model.controller = opts.controller
    ?? String(opts.hostFile ?? '').split(/[\\/]/).pop().replace(/\.(xml|f)$/i, '');
  /*
   * MỌI file cùng góp cột vào lưới này — file lưới cộng từng mảnh cấu hình ẩn.
   *
   * Tầng vỏ dùng nó cho `fboDesigner.revealRelatedFiles = "all"`: một cột có thể được khai ở
   * tới bốn chỗ, và câu hỏi ngay sau «nó khai ở đâu» thường là «còn chỗ nào khác nói về nó
   * nữa». Danh sách lấy từ chính các mảnh đã gộp, không đoán theo quy ước thư mục — mảnh nào
   * thật sự được đọc mới có tên ở đây.
   */
  model.relatedFiles = [...new Set([
    opts.hostFile ?? '',
    ...(opts.config ?? []).map((p) => p.file ?? ''),
  ].filter(Boolean))];
  model.baseCss = opts.baseCss ?? '';
  model.css = opts.css ?? '';
  model.toolbarCss = [model.baseCss, model.css].filter(Boolean).join('\n');
  // Không có CSS nền mà vẫn có nút: mọi nút sẽ ra chỉ-chữ. Nói ra, đừng để người đọc tự đoán.
  if (model.toolbar.length > 0 && model.baseCss === '') {
    model.warnings.push({
      item: -1,
      message: 'không nhận được CSS nền (baseCss) — mọi nút toolbar vẽ dạng chỉ chữ,'
        + ' vì icon quyết định theo CSS quy tắc chung',
    });
  }
  if (model.columns.length === 0) {
    return {
      html: '<p class="FboEmpty">View của lưới không khai cột nào (&lt;field name="…"/&gt;), hoặc mọi cột đều hidden.</p>',
      model,
      warnings: model.warnings,
    };
  }
  const embedded = opts.embedded === true;
  return {
    html: renderGridHtml(model, { embedded, bodyHeight: opts.bodyHeight ?? null }),
    model,
    // Tầng vỏ cần biết để nới `#fbo-stage` ra hết bề ngang — `width:100%` trong một hộp
    // `inline-block` co theo nội dung thì không nới được gì. Xem `panelStyle`.
    fitWidth: !embedded && isViewportGrid(model.type),
    warnings: model.warnings,
  };
}
