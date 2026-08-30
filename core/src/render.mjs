// render.mjs — model → HTML.
//
// Đặc tả nguồn: hub 4AI, `assets/skills/erp/erp-view-design/references/reference-render-pipeline.md`.
//
// Ba luật của form FBO mà HTML sinh ra phải giữ đúng, nếu không thì preview nói dối:
//   1. Bề rộng bảng = TỔNG list px. Không có `width:100%` tính bằng px trên bảng.
//   2. `table-layout: fixed` — nội dung dài không đẩy cột rộng ra, nó bị cắt.
//   3. Một ô không có bề rộng px riêng. `colspan` là toàn bộ cách một ô rộng hơn.
//
// Luật thứ tư, học được khi so với HTML runtime thật của `Dir/Site.xml`: **bảng không tự đứng
// một mình**. Runtime bọc nó trong bảy lớp div (`UpdateDlgPanel` → `Border` → `Floor` →
// `Container` → `Frame` → `UpdateTaskDialog` → `UpdateDlgContent`), và chính mấy lớp đó cộng
// thêm 23px vào bề rộng, một thanh tiêu đề và một dải nút ở đáy vào chiều cao. Vẽ mỗi cái bảng
// là ra một cái form nhỏ hơn form thật ở cả hai chiều — đúng lỗi đang phải sửa.
//
// Phạm vi: view đầu tiên, cả ba vùng — header (`categoryIndex` 0 hoặc không khai), main tức
// vùng tab (`> 0`) và footer (`-1`) — cộng lưới Detail nhúng trong tab (`<items style="Grid">`).

import { scanViews, scanFields, scanTitle, scanRoot, scanToolbar, scanCss } from './spans.mjs';
import { classifyItem, parseWidths, parseRow, buildCells } from './item-value.mjs';
import {
  renderControl,
  containerClass,
  isTextArea,
  alignOf,
  CELL_PADDING_PX,
  resolveLocaleName,
  fieldHint,
} from './control.mjs';
import { sourceRange, hostRefAt } from './entities.mjs';
import { renderGrid } from './grid.mjs';

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ESCAPES[c]);
}

/**
 * Nhãn `<header>` / `<footer>` là **innerHTML**, không phải văn bản.
 *
 * Runtime nhét thẳng chuỗi đó vào DOM, nên `Mã số th<u>u</u>ế` phải ra chữ "u" gạch chân, và
 * `<span class="CheckTaxCodeFlag" onclick="…">` phải ra đúng cái icon tra cứu MST nằm cạnh nhãn.
 * Escape cả cụm thì người dùng thấy nguyên văn thẻ trên màn hình — sai, và nhãn dài gấp ba lần
 * thật nên cột 1 tràn theo.
 *
 * Nhưng chuỗi này đến từ file của KHÁCH và webview thì có `acquireVsCodeApi()`, nên không thể
 * cho qua nguyên xi. Lối đi: allowlist thẻ trình bày, bỏ mọi thứ còn lại về dạng văn bản.
 * Cùng thái độ với `DesignHtmlEncoder` của DWF.
 *
 *   - giữ thẻ: b i u s em strong sub sup br span font small big
 *   - giữ attribute: class title id style (id/title/class là thứ CSS của program bám vào)
 *   - bỏ: mọi `on*`, `href`, `src`, và mọi thẻ ngoài allowlist (script/style/img/a/iframe…)
 *
 * Thẻ bị loại thì bỏ CHÍNH THẺ, giữ phần chữ bên trong — `<a href=x>Xem</a>` ra `Xem`, chứ
 * không nuốt mất chữ.
 */
const LABEL_TAGS = new Set(['b', 'i', 'u', 's', 'em', 'strong', 'sub', 'sup', 'br', 'span', 'font', 'small', 'big']);
const LABEL_ATTRS = new Set(['class', 'title', 'id', 'style']);
const RE_TAG = /<\/?([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)\/?>/g;
const RE_ONE_ATTR = /([\w:-]+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/g;

/**
 * Giải mã tham chiếu ký tự XML MỘT LƯỢT.
 *
 * Bắt buộc phải có, và bắt buộc phải một lượt. Trong file thật thẻ được viết dưới dạng
 * `Mã số &lt;u&gt;t&lt;/u&gt;huế` — chưa giải mã thì không có `<` nào để mà nhận ra thẻ.
 * Còn giải mã hai lượt (hoặc thay `&amp;` sau cùng) thì `&amp;lt;` — thứ người ta cố ý viết để
 * hiện ra chữ `&lt;` — biến thành thẻ thật. Một regex, một lần quét, không có đường vòng đó.
 */
const XML_REFS = { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' };
const RE_XML_REF = /&(lt|gt|quot|apos|amp|#\d+|#x[0-9a-fA-F]+);/g;

function decodeXmlText(s) {
  return String(s ?? '').replace(RE_XML_REF, (m, name) => {
    if (name in XML_REFS) return XML_REFS[name];
    const code = name[1] === 'x' || name[1] === 'X'
      ? Number.parseInt(name.slice(2), 16)
      : Number.parseInt(name.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
  });
}

export function sanitizeLabelHtml(raw) {
  const text = decodeXmlText(raw);
  if (!text.includes('<')) return esc(text);

  let out = '';
  let last = 0;
  RE_TAG.lastIndex = 0;
  let m;
  while ((m = RE_TAG.exec(text)) !== null) {
    out += esc(text.slice(last, m.index));
    last = m.index + m[0].length;

    const tag = m[1].toLowerCase();
    if (!LABEL_TAGS.has(tag)) continue; // thẻ lạ: bỏ thẻ, chữ bên trong vẫn chảy tiếp
    if (m[0].startsWith('</')) { out += `</${tag}>`; continue; }

    let attrs = '';
    RE_ONE_ATTR.lastIndex = 0;
    let a;
    while ((a = RE_ONE_ATTR.exec(m[2] ?? '')) !== null) {
      const name = a[1].toLowerCase();
      if (!LABEL_ATTRS.has(name)) continue;
      const value = a[2].replace(/^["']|["']$/g, '');
      // `style` vẫn có thể chứa `url(javascript:…)` ở trình duyệt cũ — chặn cả cụm cho gọn.
      if (name === 'style' && /url\s*\(|expression\s*\(/i.test(value)) continue;
      attrs += ` ${name}="${esc(value)}"`;
    }
    out += tag === 'br' ? '<br/>' : `<${tag}${attrs}>`;
  }
  return out + esc(text.slice(last));
}

/**
 * Chênh lệch bề rộng giữa panel và bảng: bảng 550px (120+25+5+70+330) nằm trong panel
 * `style="width: 573px"`. Không suy — đo trên chính trang runtime đã lưu, với CSS thật đã nạp
 * (`DevWorkFlow/.temp/Danh mục khách hàng_files/`), và quy hết được về rule:
 *
 *   573 − 1 (Border viền trái) − 1 (Border viền phải) − 1 (Floor viền trái) = 570
 *   570 − 8 − 8 (Content padding) − 1 (Content viền trái) = 553 lọt lòng ⊇ bảng 550
 *
 * Đổi bất kỳ viền/padding nào ở `fbo-form.css` thì con số này phải tính lại.
 */
export const DIALOG_CHROME_PX = 23;

/** Style inline runtime gắn lên mọi `<td class="FormCell">`. Nguyên văn, kể cả `!important`. */
const CELL_STYLE = `overflow:hidden;width:100%;padding:${CELL_PADDING_PX}px!important;`;

function pick(node, vi) {
  if (!node) return null;
  const text = vi ? node.v : node.e;
  if (text !== undefined && text !== '') return text;
  const other = vi ? node.e : node.v;
  return other !== undefined && other !== '' ? other : '';
}

/** Nhãn lấy từ `<field><header v e>`. Rỗng cả hai ngôn ngữ thì rơi về tên field. */
function labelOf(field, vi) {
  const text = pick(field?.header, vi);
  return text === null || text === '' ? (field?.name ?? '') : text;
}

/**
 * Ô `.Description` / `.Footer` lấy từ `<field><footer>`; KHÔNG có footer mới rơi về `<header>`.
 * Đây là chỗ dễ sai mà nhìn không ra: thiếu đọc footer thì ô mô tả hiện lại chính cái nhãn.
 */
function descriptionOf(field, vi) {
  const footer = pick(field?.footer, vi);
  if (footer !== null && footer !== '') return footer;
  const header = pick(field?.header, vi);
  return header ?? '';
}

/** `allowNulls="false"` là cách FBO khai bắt buộc nhập. Runtime gắn `Required` lên Ô NHẬP. */
function isRequired(field) {
  return field?.attrs?.allowNulls === 'false' || field?.attrs?.required === 'true';
}

/**
 * `categoryIndex` — vùng nào của form thì HÀNG này thuộc về.
 *
 * Chỗ dễ hiểu sai nhất của định dạng: `categoryIndex` KHÔNG khai trên `<item>` (tức trên hàng),
 * mà khai trên `<field categoryIndex="n">`. Hàng lấy vùng của mình từ FIELD ĐẦU TIÊN trong hàng
 * có khai `categoryIndex`; không field nào khai thì hàng ở vùng main. Đọc nhầm sang `<item>` thì
 * mọi hàng đều rơi về main — form vẫn vẽ ra, chỉ là tab và footer biến mất, và đó đúng là triệu
 * chứng "form có categoryIndex load chưa đúng" (form KHÔNG có categoryIndex thì không lộ gì).
 *
 * Ba vùng của form, theo đúng tên gọi trong FBO:
 *   `0` (hoặc KHÔNG khai) → **header** — dải trên cùng, luôn hiện, không thuộc tab nào
 *   `> 0`                 → **main** — vùng tab; `<category index="n">` cho nhãn và list px
 *   `-1`                  → **footer** — dải dưới đáy form
 *
 * Lưu ý tên: "main" ở đây là VÙNG TAB, không phải dải trên cùng. Gọi dải trên là main (như
 * `LayoutRegionId` của DWF đặt) rồi đọc `view@height` thành chiều cao của nó là sai chỗ —
 * `height` ghim chiều cao vùng tab, xem `mainHeight`.
 */
const REGION_HEADER = 0;
const REGION_FOOTER = -1;
const isTrue = (v) => String(v ?? '').toLowerCase() === 'true';

/**
 * `view@height` — chiều cao CỐ ĐỊNH của vùng main (vùng tab), tính bằng px.
 *
 * Cho phép cả biểu thức số học (`"400"`, `"380 + 20"`) vì corpus có dùng. Chỉ nhận chữ số và
 * `+ - * / ( ) .`; gặp bất cứ thứ gì khác thì trả null chứ KHÔNG đoán — và không bao giờ `eval`
 * một chuỗi lấy từ file của khách.
 */
export function evaluateHeight(expr) {
  if (expr === null || expr === undefined) return null;
  const text = String(expr).trim();
  if (text === '') return null;
  if (/^\d+$/.test(text)) return Number(text);
  if (!/^[\d\s+\-*/().]+$/.test(text)) return null;
  try {
    // eslint-disable-next-line no-new-func
    const n = Function(`"use strict";return (${text});`)();
    return Number.isFinite(n) ? Math.round(n) : null;
  } catch {
    return null;
  }
}

/** Tên field → `categoryIndex`. Chỉ giữ field CÓ khai — "không khai" khác hẳn "khai bằng 0". */
export function fieldCategories(fields) {
  const map = new Map();
  for (const f of fields) {
    const n = Number.parseInt(f.attrs?.categoryIndex, 10);
    if (Number.isInteger(n)) map.set(f.name, n);
  }
  return map;
}

/**
 * Vùng của một hàng.
 *
 * Runtime ưu tiên token nhãn/mô tả (`.Label`/`.Footer`/`.Description`) khi quyết vùng. Nhờ vậy,
 * hàng kiểu `[ma_nvbh].Label, [ma_nvbh], [ten_nvbh%l], ...` vẫn ở header dù `ten_nvbh%l`
 * lỡ mang `categoryIndex` của tab khác. Chỉ khi hàng không có token nhãn/mô tả nào (ví dụ
 * `1: [d21]`) mới rơi về token input.
 */
export function rowCategoryIndex(row, categoryByField) {
  if (categoryByField.size === 0) return REGION_HEADER;
  const hasCompanion = row.tokens.some((t) => t.kind === 'label' || t.kind === 'footer' || t.kind === 'description');

  for (const t of row.tokens) {
    if (!(t.kind === 'label' || t.kind === 'footer' || t.kind === 'description')) continue;
    if (t.field !== null && categoryByField.has(t.field)) return categoryByField.get(t.field);
  }

  if (!hasCompanion) {
    for (const t of row.tokens) {
      if (t.field !== null && categoryByField.has(t.field)) return categoryByField.get(t.field);
    }
  }
  return REGION_HEADER;
}

/**
 * Chia hàng vào vùng và xếp vùng theo đúng thứ tự runtime vẽ: header → tab (main) → footer.
 *
 * Tab lấy thứ tự KHAI trong `<categories>`, không sort theo index — runtime cũng vậy. Một tab
 * đã khai mà không hàng nào trỏ tới vẫn phải hiện ra (tab rỗng là chuyện có thật, và giấu nó đi
 * là preview nói dối về số tab của form).
 */
function buildRegions(built, categories, view, regionWidths, duplicateCategories = [], segments = null) {
  const categoryByIndex = new Map();
  for (const c of categories) if (!categoryByIndex.has(c.index)) categoryByIndex.set(c.index, c);

  /**
   * Toạ độ NGUỒN của thẻ đã khai `anchor`/`split`, quy về file sở hữu thật.
   *
   * Trả `null` khi không có `segments` (lời gọi thuần, bộ test) — tầng edit hiểu đó là «không
   * biết ghi vào đâu» và từ chối, thay vì ghi bừa vào một offset của clearText.
   */
  const spansOf = (node, tagName) => {
    if (!node || !segments) return null;
    const at = (span) => (span ? sourceRange(segments, span.start, span.end) : null);
    return {
      tagName,
      tagStart: sourceRange(segments, node.start, node.start + 1),
      anchorRange: at(node.attrSpans?.anchor),
      splitRange: at(node.attrSpans?.split),
    };
  };

  const byIndex = new Map();
  for (const r of built) {
    if (!byIndex.has(r.categoryIndex)) byIndex.set(r.categoryIndex, []);
    byIndex.get(r.categoryIndex).push(r);
  }

  const region = (kind, index, header, rows, attrs) => {
    const w = regionWidths(index);
    return {
      kind,
      index,
      id: kind === 'category' ? `cat:${index}` : kind,
      header,
      widths: w,
      totalWidth: w.reduce((a, b) => a + b, 0),
      // `anchor` / `split` là CHỈ SỐ CỘT tính từ 1, không phải px. Vùng nào khai thì vùng đó
      // giữ — view khai cho dải header, `<category>` khai cho tab của nó.
      anchor: intOrNull(attrs?.anchor),
      split: intOrNull(attrs?.split),
      // Vị trí NGUỒN để ghi ngược hai con số đó khi người dùng kéo marker trên blueprint.
      // `tagStart`/`attrSpans` của chính thẻ đã khai chúng — `<view>` cho dải header,
      // `<category index="n">` cho tab. Ghi nhầm thẻ là sửa anchor của cả form khi người dùng
      // chỉ kéo trong một tab.
      writeback: spansOf(kind === 'category' ? categoryByIndex.get(index) : view, kind === 'category' ? 'category' : 'view'),
      rows,
    };
  };

  const regions = [region('header', REGION_HEADER, null, byIndex.get(REGION_HEADER) ?? [], view.attrs)];

  /*
   * MỘT tab cho mỗi `index`, dù `<categories>` khai nó mấy lần.
   *
   * Khai trùng là chuyện có thật, không phải file hỏng: `Dir/SVTran.xml` khai `index="8"`,
   * `"14"`, `"15"` mỗi cái hai lần — controller khai một lần, rồi một Include kéo vào lần nữa.
   * Runtime tra `<category>` theo index như tra từ điển nên khai lần hai chỉ ghi đè lần một;
   * còn ở đây, đẩy từng khai báo thành một region là ra HAI tab «Xác thực» cạnh nhau, DÙNG
   * CHUNG một `id`. Trùng id thì bấm tab này mở luôn tab kia, và cả hai cùng nhận `DwfActive`.
   *
   * Lần khai ĐẦU thắng, để thứ tự tab giữ đúng thứ tự đọc trong file. Lần sau bị bỏ thì nói ra
   * bằng cảnh báo — hai lần khai có thể mang `columns` khác nhau, và im lặng ở đó là nuốt mất
   * một khác biệt người đọc cần biết.
   */
  const declared = new Set();
  for (const c of categories) {
    if (c.index <= 0) continue;
    if (declared.has(c.index)) {
      duplicateCategories.push(c.index);
      continue;
    }
    declared.add(c.index);
    regions.push(region('category', c.index, c.header, byIndex.get(c.index) ?? [], c.attrs));
  }
  // Hàng trỏ tới tab KHÔNG được khai trong `<categories>`: vẫn phải vẽ, không được nuốt mất.
  // Không có `<header>` nên nhãn tab rơi về chính con số index.
  for (const [index, rows] of byIndex) {
    if (index > 0 && !declared.has(index)) regions.push(region('category', index, null, rows, null));
  }

  const footer = byIndex.get(REGION_FOOTER);
  if (footer && footer.length > 0) {
    // Footer không có thẻ riêng thì dùng view@anchor/split. Có `<category index="-1">` thì
    // attrs của category ghi đè — nhưng thiếu anchor/split vẫn thừa kế từ view, không để null
    // (trước đây truyền `null` nên dải đáy không bao giờ hiện mỏ neo).
    const footerCat = categoryByIndex.get(REGION_FOOTER);
    const footerAttrs = { ...(view.attrs || {}), ...(footerCat?.attrs || {}) };
    regions.push(region('footer', REGION_FOOTER, null, footer, footerAttrs));
  }

  return regions;
}

/** Attribute số nguyên; thiếu hoặc không phải số → null, không đoán thành 0. */
function intOrNull(raw) {
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) ? n : null;
}

/**
 * Dựng model layout của một view: list px + các hàng đã phân giải thành ô.
 * Không sinh HTML ở đây — tách ra để test được layout mà không cần so chuỗi HTML.
 */
export function buildViewModel(view, fields, {
  vi = true,
  title = null,
  titleMode = 'add',
  segments = null,
  hostFile = '',
  loadDetail = null,
  pageCss = '',
  baseCss = '',
} = {}) {
  // Kèm luôn vị trí NGUỒN của `rows="N"` và của chính thẻ `<field`, để tầng edit kéo được
  // chiều cao tab mà không phải quét lại file. `attrSpans` đo trên clearText nên phải quy đổi.
  const fieldByName = new Map(fields.map((f) => [f.name, segments
    ? {
      ...f,
      categoryRange: f.attrSpans?.categoryIndex
        ? sourceRange(segments, f.attrSpans.categoryIndex.start, f.attrSpans.categoryIndex.end)
        : null,
      rowsRange: f.attrSpans?.rows
        ? sourceRange(segments, f.attrSpans.rows.start, f.attrSpans.rows.end)
        : null,
      tagStart: sourceRange(segments, f.start, f.start + 1),
    }
    : f]));
  const warnings = [];

  let widths = [];
  let widthsItem = null;
  const rows = [];

  view.items.forEach((item, i) => {
    if (item.value === null) return;
    if (classifyItem(item.value, i) === 'widths') {
      const w = parseWidths(item.value);
      widths = w.widths;
      widthsItem = { index: i, value: item.value, span: item.valueSpan ?? null };
      warnings.push(...w.warnings.map((m) => ({ item: i, message: m })));
      return;
    }

    const row = parseRow(item.value);
    rows.push({ item, index: i, row });
    warnings.push(...row.warnings.map((m) => ({ item: i, message: m })));
  });

  // Item đầu đã có `:` → view không khai list cột: số cột suy từ pattern dài nhất, mọi cột bằng nhau.
  let inferredWidths = false;
  if (widths.length === 0) {
    const maxLen = rows.reduce((n, r) => Math.max(n, Array.from(r.row.pattern).length), 0);
    widths = new Array(maxLen).fill(100);
    inferredWidths = maxLen > 0;
  }

  const categoryByField = fieldCategories(fields);
  const categories = (view.categories ?? []).map((c) => {
    const w = parseWidths(c.columns);
    warnings.push(...w.warnings.map((m) => ({ item: null, message: `category ${c.index}: ${m}` })));
    return { ...c, widths: w.widths };
  });
  const categoryByIndex = new Map(categories.map((c) => [c.index, c]));

  // Vùng nào khai `columns` riêng thì dùng list px của nó; không khai thì rơi về list px của
  // view. Footer không có `<category index="-1">` cũng rơi về view — đó là ca thường gặp nhất.
  const regionWidths = (index) => {
    const own = categoryByIndex.get(index)?.widths;
    return own && own.length > 0 ? own : widths;
  };

  const built = rows.map((r) => {
    // Hàng này thật ra nằm ở file nào? Hàng đến từ Include dùng chung nhiều controller —
    // designer phải biết để khoá, và để nhảy đúng chỗ khi người dùng bấm vào.
    //
    // `sourceRange` quy CẢ DẢI về một file. Map riêng lẻ hai đầu rồi ghép thì hàng có entity ở
    // giữa cho ra hai file khác nhau, và dải ghép từ hai hệ toạ độ bôi đen mấy chục dòng.
    const range = segments && r.item.valueSpan
      ? sourceRange(segments, r.item.valueSpan.start, r.item.valueSpan.end)
      : null;
    const origin = range ? { file: range.file, offset: range.start } : null;
    // Dải của CẢ THẺ `<item …/>`, không phải của riêng `value` — phép thêm hàng chèn một thẻ
    // mới cạnh thẻ cũ, nên nó cần biên của thẻ chứ không phải biên của thuộc tính.
    const itemRange = segments
      ? sourceRange(segments, r.item.start, r.item.end)
      : null;
    // …và chỗ nào trong file ĐANG MỞ đã kéo nó vào. Có cái này thì bấm vào hàng ngoại lai
    // không cần mở thêm file: nhảy thẳng tới `&Name;` ngay trong controller.
    const hostRef = segments && r.item.valueSpan && hostFile
      ? hostRefAt(segments, r.item.valueSpan.start, hostFile)
      : null;

    // Hàng của tab/footer đo bằng list px CỦA VÙNG ĐÓ, không phải của view. Dùng nhầm list px
    // của view thì mọi ô trong tab lệch cột — hỏng im lặng, vì bảng vẫn vẽ ra bình thường.
    const categoryIndex = rowCategoryIndex(r.row, categoryByField);
    const widths = regionWidths(categoryIndex);
    const { cells, warnings: w } = buildCells(r.row, widths);
    warnings.push(...w.map((m) => ({ item: r.index, message: m })));
    for (const c of cells) {
      if (c.token?.field && !fieldByName.has(c.token.field)) {
        warnings.push({ item: r.index, message: `token "${c.token.raw}": không có <field name="${c.token.field}">` });
      }
    }
    // Hàng có textarea thì runtime canh CẢ HÀNG lên đỉnh — nhãn phải đi theo, không thì nhãn
    // trôi xuống giữa ô cao hai dòng và lệch hẳn so với runtime.
    const multiline = cells.some((c) => c.token?.kind === 'input' && isTextArea(fieldByName.get(c.token.field)));
    const foreign = origin !== null && hostFile !== '' && origin.file !== hostFile;
    /*
     * Hàng này đến từ BẢN CHUẨN CỦA SẢN PHẨM (`.f`) hay từ bản customize của khách (`.xml`)?
     *
     * Khác hẳn `foreign`, và đó là lý do phải là hai cờ chứ không một: `foreign` nói «khai ở
     * file KHÁC file đang mở» — tức Include hay entity. `product` nói «khai ở một file `.f`» —
     * tức thứ designer TỪ CHỐI ghi vào (xem `productFileBlocks`), và bản nâng cấp sau của Fast
     * sẽ ghi đè. Một hàng có thể là cả hai, một trong hai, hoặc không cái nào.
     */
    // Nguồn hiệu lực: file khai ra hàng này; không có `segments` thì chính file đang mở.
    // Thiếu vế fallback là mở thẳng một `Dir/X.f` mà không hàng nào được tô — đúng ca hay gặp nhất.
    const product = /\.f$/i.test(origin?.file ?? hostFile ?? '');
    return {
      ...r, cells, categoryIndex, widths, origin, range, itemRange, hostRef, foreign, product,
      valign: multiline ? 'top' : 'middle',
    };
  });

  const duplicateCategories = [];
  const regions = buildRegions(built, categories, view, regionWidths, duplicateCategories, segments);
  for (const index of duplicateCategories) {
    warnings.push({
      item: -1,
      message: `<category index="${index}"> được khai nhiều lần — chỉ lần đầu được dùng`,
    });
  }

  return {
    mode: 'form',
    widths,
    widthsItem,
    inferredWidths,
    totalWidth: widths.reduce((a, b) => a + b, 0),
    // Panel phải ôm được vùng RỘNG NHẤT, không phải riêng vùng main: một tab khai `columns`
    // rộng hơn view thì bảng của nó tràn ra ngoài panel nếu chỉ đo theo main.
    get panelWidth() { return Math.max(this.totalWidth, ...this.regions.map((r) => r.totalWidth)) + DIALOG_CHROME_PX; },
    categories,
    regions,
    // `view@height` ghim chiều cao vùng main (vùng tab). Không khai thì vùng co theo nội dung —
    // đừng bịa một chiều cao mặc định, form thật cũng không có.
    mainHeight: evaluateHeight(view.attrs?.height),
    // Dải của giá trị `height="N"` trong file nguồn — chỗ để kéo cao/thấp vùng main.
    // Không có thuộc tính thì giữ vị trí thẻ `<view` để còn chèn nó vào.
    heightRange: segments && view.attrSpans?.height
      ? sourceRange(segments, view.attrSpans.height.start, view.attrSpans.height.end)
      : null,
    viewTagStart: segments ? sourceRange(segments, view.start, view.start + 1) : null,
    // Bản đồ provenance của cả tài liệu. Tầng edit cần nó để vá ĐÚNG mấy ký tự đã đổi trong
    // pattern, kể cả khi mấy ký tự ấy nằm trong phần bung ra từ một entity — xem `patternPlan`.
    segments,
    // File đang mở. Tầng edit so với nó để biết khi nào phải hỏi lại vì đang đụng file dùng chung.
    hostFile,
    anchor: intOrNull(view.attrs?.anchor),
    split: intOrNull(view.attrs?.split),
    rows: built,
    fieldByName,
    vi,
    title,
    titleMode,
    // Cách core đọc file lưới Detail mà vẫn không chạm đĩa — xem `renderEmbeddedGrid`.
    loadDetail,
    // `<css>` của chính controller này — lưới nhúng cần nó để biết nút nào thật sự có icon.
    pageCss,
    // CSS NỀN của base pack — nguồn của MỌI icon chuẩn. Đi kèm model vì lưới nhúng trong tab
    // được vẽ muộn hơn (`renderEmbeddedGrid`) và không thấy `opts` gốc nữa.
    baseCss,
    // `<css>` của từng lưới Detail nhúng, gom trong lúc vẽ.
    detailCss: [],
    warnings,
  };
}

/**
 * Ô mang lưới Detail nhúng — `<field><items style="Grid" controller="X"/></field>`.
 *
 * Lưới nằm ở FILE KHÁC (`Grid/X.xml`, hoặc `Grid/X.f` nếu chưa customize), nên core không tự
 * đọc được: core không chạm đĩa. Người gọi truyền vào `loadDetail(name)` — hàm đã đọc file,
 * đã bung entity, và trả về `{ text, segments, file }`. Không truyền thì ô báo thẳng là thiếu
 * chứ không vẽ một ô rỗng: ô rỗng nhìn y hệt "tab này vốn không có gì".
 *
 * Ô dùng `padding:0` và class `FormCellGrid` — lưới tự có viền và nền riêng, để nguyên padding
 * 4px của FormCell thì lưới thụt vào trong ô một vành không có ở runtime.
 */
function renderEmbeddedGrid(cell, field, model, td) {
  const name = field.items?.controller ?? '';
  const gridTd = (inner) =>
    `<td class="FormCellGrid" style="overflow:hidden;width:100%;padding:0!important;" colspan="${cell.span}"`
    + ` data-fbo-col="${cell.col}" data-fbo-span="${cell.span}" data-fbo-width="${cell.width}"`
    + ` data-fbo-token="[${esc(field.name)}]" data-fbo-grid="${esc(name)}">`
    + `<div tabindex="-1" style="outline:none;">${inner}</div></td>`;

  if (name === '') {
    return gridTd(`<p class="FboEmpty">&lt;items style="Grid"&gt; của <b>${esc(field.name)}</b> không khai <code>controller</code>.</p>`);
  }
  const detail = model.loadDetail ? model.loadDetail(name) : null;
  if (!detail) {
    return gridTd(`<p class="FboEmpty">Không đọc được lưới Detail <b>${esc(name)}</b> (tìm <code>Grid\\${esc(name)}.xml</code> rồi <code>.f</code>).</p>`);
  }

  // Lưới Detail mang `<css>` RIÊNG của nó, và đó là chỗ khai icon cho nút toolbar riêng
  // (`div.GroupExtra` → `Images/Extra.png` của program). Chỉ gom `<css>` của controller chủ thì
  // nút «Khác…» trong tab vĩnh viễn không có icon, vì rule của nó không nằm ở file chủ.
  const detailCss = scanCss(detail.text);
  if (detailCss) model.detailCss.push(detailCss);

  const built = renderGrid(scanViews(detail.text), scanFields(detail.text), {
    vi: model.vi,
    // `<css>` của CẢ HAI file: nút riêng của khách có thể được khai kiểu ở lưới, mà cũng có thể
    // ở controller chủ — cả hai đều nạp vào cùng một trang, nên cả hai đều tính.
    css: [model.pageCss ?? '', detailCss ?? ''].filter(Boolean).join('\n'),
    // CSS NỀN đi tiếp xuống lưới nhúng: icon của nó cũng quyết định theo CSS quy tắc chung,
    // không truyền là mọi nút trong tab thành chỉ-chữ.
    baseCss: model.baseCss ?? '',
    root: scanRoot(detail.text),
    title: scanTitle(detail.text),
    toolbar: scanToolbar(detail.text),
    segments: detail.segments ?? null,
    hostFile: detail.file ?? '',
    // Tên mà FORM gọi lưới này (`<items controller="X"/>`) — nói thẳng thay vì để lưới tự suy
    // từ tên file: file có thể là `X.f` (bản chuẩn) trong khi khoá tra cứu vẫn là `X`.
    controller: name,
    embedded: true,
    // `<field rows="242">` — chiều cao phần thân lưới, do FORM khai chứ không phải lưới khai.
    bodyHeight: intOrNull(field.attrs?.rows),
  });
  return gridTd(built.html);
}

/**
 * Div bọc nội dung ô — runtime luôn có một cái, và chính nó ghim chiều cao 13px của nhãn.
 *
 * `align` đặt ở ĐÂY chứ không chỉ trên `<input>`: `text-align` trên một
 * `<input type="checkbox">` không làm gì cả — checkbox là hộp cỡ cố định, nó chỉ dịch khi thứ
 * BỌC nó canh nó. Thiếu vế này là ô `type="Boolean"` vĩnh viễn dính lề trái. Xem `alignOf`.
 */
function container(cls, valign, capped, inner, align = null) {
  const style = `width:100%;${capped ? 'max-height:13px;' : ''}overflow:hidden;`
    + `vertical-align:${valign};${align ? `text-align:${align};` : ''}`;
  return `<div class="${cls}" style="${style}">${inner}</div>`;
}

function renderCell(cell, row, model, cellIndex) {
  const token = cell.token;
  const field = token?.field ? model.fieldByName.get(token.field) : null;
  const rowMeta = (row.foreign ? ' data-fbo-foreign="1"' : '')
    + (row.product ? ' data-fbo-product="1"' : '');
  // `data-fbo-cell` là chỉ số trong MẢNG Ô của hàng, khác hẳn `data-fbo-col` (chỉ số cột).
  // Mọi phép sửa nhắm theo ô, nên nhầm hai cái này là sửa trúng ô khác — ô trống cũng là một ô,
  // nên ở hàng có ô trống hai con số này lệch nhau ngay.
  //
  // `data-fbo-col` / `data-fbo-span` = cột/span THẬT của token (edit*). `colspan` HTML có thể
  // ngắn hơn khi ô bị cắt ở vạch split — kéo thả phải giữ span đầy đủ, không lấy bản vẽ.
  const editCol = cell.editCol ?? cell.col;
  const editSpan = cell.editSpan ?? cell.span;
  const data = ` data-fbo-cell="${cellIndex}" data-fbo-col="${editCol}"`
    + ` data-fbo-span="${editSpan}" data-fbo-width="${cell.width}"`;
  const td = (cls, inner, extra = '') =>
    `<td class="${cls}" nowrap style="${CELL_STYLE}" colspan="${cell.span}"${data}${rowMeta}${extra}>${inner}</td>`;

  if (cell.empty) {
    // Hàng toàn `-` / nửa split trống không có ô nhập cạnh → `<td>` rỗng chỉ còn padding ~8px,
    // thấp hơn slot trống cạnh control (~24px). Chèn FormContainer + &nbsp; cùng cỡ ô nhập
    // (13px) để chiều cao khớp slot trống bình thường — không dùng FormContainerInput kẻo
    // hiện gạch chân giả trên ô trống.
    return td('FormCell DwfEmptyCell',
      container('FormContainer', row.valign, false,
        '<div style="height:13px;line-height:13px;font-size:11px;overflow:hidden;">&nbsp;</div>'));
  }

  const tokenAttr = ` data-fbo-token="${esc(token?.raw ?? '')}"`;
  const fieldFile = field?.tagStart?.file ?? null;
  const fieldForeign = !!(fieldFile && model.hostFile && fieldFile !== model.hostFile);
  const fieldProduct = !!(fieldFile && /\.f$/i.test(fieldFile));
  const fieldMeta = field
    ? ` data-field-name="${esc(resolveLocaleName(field.name, model.vi))}"`
      + ` title="${esc(fieldHint(field, model.vi))}"`
      + (isTrue(field.attrs?.readOnly) ? ' data-fbo-readonly="1"' : '')
      + (isTrue(field.attrs?.external) ? ' data-fbo-external="1"' : '')
      + (isTrue(field.attrs?.inactivate) ? ' data-fbo-inactivate="1"' : '')
      + (isTrue(field.attrs?.disabled) ? ' data-fbo-disabled="1"' : '')
      + (fieldForeign ? ' data-fbo-foreign="1"' : '')
      + (fieldProduct ? ' data-fbo-product="1"' : '')
    : '';

  if (token?.kind === 'label') {
    // `FormRequiredLabel` KHÔNG có ở runtime — nó là dấu của designer, và chỉ được phép đổi
    // màu. Cho nó đổi font-weight là nhãn `nowrap` dài ra, cột 1 tràn, và preview nói dối.
    const required = isRequired(field) ? ' FormRequiredLabel' : '';
    return td(`FormCell${required}`, container('FormContainer', row.valign, true, sanitizeLabelHtml(labelOf(field, model.vi))), tokenAttr + fieldMeta);
  }
  if (token?.kind === 'description' || token?.kind === 'footer') {
    const text = field ? sanitizeLabelHtml(descriptionOf(field, model.vi)) : '';
    return td('FormCell', container('FormContainer', row.valign, true, text), tokenAttr + fieldMeta);
  }
  if (token?.kind === 'unknown') {
    return td('FormCell FormCellInvalid', container('FormContainer', row.valign, true, esc(token.raw)), `${tokenAttr} title="kind không hợp lệ"`);
  }
  if (!field) {
    return td('FormCell FormCellInvalid', container('FormContainer', row.valign, true, esc(token?.field ?? '')), `${tokenAttr} title="không có &lt;field&gt; tương ứng"`);
  }

  // `<items style="Grid" controller="X"/>` — ô này KHÔNG phải một control, nó là cả một lưới
  // Detail lấy từ `Grid/X`. Đây là cách một tab của form chứa lưới con (tab «Mua hàng», «Liên
  // hệ»… của danh mục khách hàng). Không dựng thì tab trông rỗng, mà file thì khai đầy đủ.
  if (String(field.items?.style ?? '').toLowerCase() === 'grid') {
    return renderEmbeddedGrid(cell, field, model, td);
  }

  // Bề rộng ô = tổng px các cột nó trải qua. Ô Lookup cần con số này để tính chỗ đeo icon —
  // đây là chỗ duy nhất biết nó.
  const control = renderControl(field, { vi: model.vi, cellWidth: cell.width });
  const required = isRequired(field) ? ' Required' : '';
  return td(`FormCell${required}`,
    container(containerClass(field), row.valign, false, control, alignOf(field)), tokenAttr + fieldMeta);
}

function titleText(model) {
  if (!model.title) return '';
  const text = pick(model.title, model.vi) ?? '';
  if (text === '') return '';
  if (model.titleMode === 'plain') return text;
  return model.vi ? `Thêm ${text}` : `Add ${text}`;
}

// Dải nút đáy (`UpdateDlgFooter` với Mới/Sửa/Lưu/Hủy/Đóng) CỐ Ý không dựng.
//
// Runtime có nó, nên bỏ đi là preview thấp hơn dialog thật ~52px. Đổi lại: nút nào hiện, nút
// nào ẩn là do runtime quyết theo ngữ cảnh (đang thêm hay đang sửa, quyền của người dùng),
// không có gì trong `<view>` nói ra điều đó. Vẽ một bộ nút đoán được là bịa ra thứ file không
// khai — và designer thì không sửa được nút, nên chỗ đó chỉ tốn màn hình.
//
// Ai cần đối chiếu chiều cao với dialog thật thì cộng thêm phần đáy: padding 10px trên,
// 14px dưới, nút cao 24px (`.UpdateDlgFooter` + `Menu.css` của program).

/**
 * Field mang lưới trong một tab, nếu có.
 *
 * Quyết định chiều cao tab đó lấy từ đâu: có lưới → `field@rows` của chính field này; không có
 * → `view@height` dùng chung. Kéo nhầm nguồn là co một tab nhưng mọi tab khác cùng đổi theo.
 */
function gridFieldOf(region, model) {
  for (const row of region.rows) {
    for (const t of row.row.tokens) {
      const f = t.field ? model.fieldByName.get(t.field) : null;
      if (String(f?.items?.style ?? '').toLowerCase() === 'grid') return f.name;
    }
  }
  return null;
}

export function renderViewHtml(model) {
  const heading = titleText(model);
  const title = heading === ''
    ? ''
    : `<div class="UpdateDlgTitle"><table cellspacing="0" cellpadding="0"><tr><td style="width:100%;">`
      + `<div class="UpdateDlgTitleText">${esc(heading)}</div></td></tr></table></div>`;

  const header = model.regions.find((r) => r.kind === 'header');
  const tabs = model.regions.filter((r) => r.kind === 'category');
  const footer = model.regions.find((r) => r.kind === 'footer');

  // `view@height` ghim chiều cao vùng main, và ghim trên PANEL chứ không trên bảng: bảng cao
  // theo số hàng, panel mới là cái runtime cho cuộn khi hàng vượt quá chiều cao khai.
  // `box-sizing:border-box` để con số khai trong XML LÀ chiều cao đo được. Không có nó thì
  // padding + viền của `.DwfTabPanel` cộng thêm 13px, và `height="302"` đo ra 315.
  /*
   * Trục NGANG của panel: mỗi tab được nhiều nhất MỘT thanh cuộn ngang, và tab có lưới thì
   * thanh ấy thuộc về lưới.
   *
   * Lý do phải phân biệt: lưới nhúng đã tự giới hạn `max-width:100%` rồi tự cho `divGrid` cuộn
   * ngang phần cột thừa (xem `renderGridHtml`). Để panel cũng `overflow-x:auto` thì cùng một
   * dãy cột có hai thanh cuộn xếp chồng nhau, kéo cái này thì cái kia đứng yên — đúng cảnh
   * «scroll render dư» đang phải sửa. Tab không có lưới thì ngược lại: bảng của vùng rộng đúng
   * bằng `<category columns>` và có thể rộng hơn form, nên panel phải là chỗ cuộn nó.
   */
  const panelStyleOf = (t) => {
    const hasGrid = gridFieldOf(t, model) !== null;
    if (model.mainHeight === null) return '';
    return ` style="height:${model.mainHeight}px;box-sizing:border-box;`
      + `overflow-y:${hasGrid ? 'hidden' : 'auto'};overflow-x:${hasGrid ? 'hidden' : 'auto'};"`;
  };

  const mainHtml = tabs.length === 0 ? '' : [
    `<div class="DwfTabs FormRegion" data-dwf-region="main" data-fbo-region="main">`,
    '<div class="DwfTabList" role="tablist">',
    tabs.map((t, i) =>
      `<button type="button" class="DwfTabButton" role="tab" aria-selected="${i === 0}"`
      + ` data-target="fbo-tab-${t.index}">${esc(pick(t.header, model.vi) || `Tab ${t.index}`)}</button>`).join(''),
    '</div>',
    tabs.map((t, i) => {
      const gf = gridFieldOf(t, model);
      const rowsVal = gf ? intOrNull(model.fieldByName.get(gf)?.attrs?.rows) : null;
      return `<section id="fbo-tab-${t.index}" class="DwfTabPanel${i === 0 ? ' DwfActive' : ''}" role="tabpanel"`
        + ` data-fbo-region="cat:${t.index}" data-fbo-category="${t.index}"`
        + (gf === null ? '' : ` data-fbo-rows-field="${esc(gf)}"`)
        // `data-fbo-rows` = đúng con số khai `field@rows` (NSD quan tâm), KHÔNG gồm chrome 60px.
        + (rowsVal === null ? '' : ` data-fbo-rows="${rowsVal}"`)
        + (model.mainHeight === null ? '' : ` data-fbo-view-height="${model.mainHeight}"`)
        + `${panelStyleOf(t)}>\n`
        + `${renderRegionTable(t, model)}\n</section>`;
    }).join('\n'),
    '</div>',
  ].join('\n');

  const footerHtml = footer
    ? `<div class="FormRegion" data-dwf-region="footer" data-fbo-region="footer">\n${renderRegionTable(footer, model)}\n</div>`
    : '';

  // Bảy lớp div là nguyên văn runtime. Bỏ bớt lớp nào cũng làm hụt padding/border của lớp đó,
  // và form ra nhỏ hơn form thật đúng bằng chừng ấy px.
  return [
    `<div class="FormParent UpdateDlgPanel" data-fbo-mode="form" style="width:${model.panelWidth}px;">`,
    '<div class="UpdateDlgBorder"><div class="UpdateDlgFloor">',
    title,
    '<div class="UpdateDlgContainer"><div class="UpdateDlgFrame"><div class="UpdateTaskDialog">',
    '<div class="UpdateDlgContent">',
    '<div class="FormRegion" data-dwf-region="header" data-fbo-region="header">',
    renderRegionTable(header, model),
    '</div>',
    mainHtml,
    footerHtml,
    '</div>',
    '</div></div></div>',
    '</div></div>',
    '</div>',
  ].filter((s) => s !== '').join('\n');
}

/**
 * `view@split` / `category@split` hợp lệ — chia bảng SAU cột thứ k (chỉ số từ 1).
 * Trả số cột bên trái (= k), hoặc `null` khi không chia.
 */
function splitColCount(region, gridOnly) {
  if (gridOnly) return null;
  const k = region.split;
  if (k === null || k === undefined) return null;
  if (!Number.isFinite(k) || k <= 0 || k >= region.widths.length) return null;
  return k;
}

/**
 * Cắt ô vào nửa cột `[colStart, colEnd)`. Giữ nguyên `data-fbo-cell` (index trong mảng ô
 * đầy đủ) — phép sửa vẫn nhắm đúng ô model, dù ô đang nằm ở bảng trái hay phải.
 */
function clipCellToHalf(cell, colStart, colEnd, widths) {
  const start = Math.max(cell.col, colStart);
  const end = Math.min(cell.col + cell.span, colEnd);
  if (end <= start) return null;
  let width = 0;
  for (let c = start; c < end; c++) width += widths[c] ?? 0;
  // `span`/`col` sau clip chỉ để VẼ (colspan nửa bảng). Span/cột thật của token giữ ở
  // `editSpan`/`editCol` — kéo thả/ghi XML phải dùng cái này, không dùng bản đã cắt ở vạch split.
  return {
    ...cell,
    col: start,
    span: end - start,
    width,
    editSpan: cell.editSpan ?? cell.span,
    editCol: cell.editCol ?? cell.col,
  };
}

/**
 * Ô của một nửa split: CHỈ nhận ô BẮT ĐẦU trong nửa đó (tránh nhân đôi control khi span
 * vượt vạch split). Cột bị nửa kia “ăn” sang → ô trống để tổng colspan khớp số `<th>`.
 */
function halfCellPieces(rowCells, colStart, colEnd, widths) {
  const starters = rowCells
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.col >= colStart && c.col < colEnd)
    .sort((a, b) => a.c.col - b.c.col);

  const pieces = [];
  let col = colStart;
  for (const { c, i } of starters) {
    while (col < c.col) {
      const existing = rowCells.findIndex((x) => x.empty && x.col === col && x.span === 1);
      pieces.push({
        cell: existing >= 0
          ? rowCells[existing]
          : { col, span: 1, width: widths[col] ?? 0, token: null, empty: true },
        index: existing >= 0 ? existing : -1,
      });
      col += 1;
    }
    const clipped = clipCellToHalf(c, colStart, colEnd, widths);
    if (!clipped) continue;
    pieces.push({ cell: clipped, index: i });
    col = clipped.col + clipped.span;
  }
  while (col < colEnd) {
    const existing = rowCells.findIndex((x) => x.empty && x.col === col && x.span === 1);
    pieces.push({
      cell: existing >= 0
        ? rowCells[existing]
        : { col, span: 1, width: widths[col] ?? 0, token: null, empty: true },
      index: existing >= 0 ? existing : -1,
    });
    col += 1;
  }
  return pieces;
}

/**
 * MỘT hàng `<tr class="FormRow">` — cùng một hàm cho cả bảng đầy đủ lẫn bản vá cục bộ.
 *
 * Vì sao phải là cùng một hàm: bản vá cục bộ (gộp/tách ô) thay đúng một `<tr>` trong DOM đang
 * có. Nếu nó dựng bằng một đoạn code chép riêng thì hai đường sinh HTML bắt đầu trôi khỏi nhau,
 * và triệu chứng sẽ là "gộp ô xong nhìn khác lúc mở lại file" — loại lệch khó thấy nhất, vì mỗi
 * bên nhìn riêng đều đúng.
 *
 * `half` (tuỳ chọn): `{ colStart, colEnd, widths }` — chỉ vẽ ô bắt đầu trong nửa đó. Dùng khi
 * vùng có `split`: mỗi nửa một `<tr>` cùng `data-fbo-item`, patch cục bộ thay cả hai.
 */
function renderRow(r, model, half = null) {
  const cells = half
    ? halfCellPieces(r.cells, half.colStart, half.colEnd, half.widths)
      .map(({ cell, index }) => renderCell(cell, r, model, index)).join('')
    : r.cells.map((c, i) => renderCell(c, r, model, i)).join('');
  const entity = r.row.hasEntity ? ' data-fbo-entity="1"' : '';
  const span = r.item.valueSpan;

  // Offset gửi ra ngoài là offset trong FILE SỞ HỮU, không phải trong clearText — người nhận
  // dùng nó để đặt con trỏ, nên clearText offset là vô nghĩa với họ.
  const origin = r.range
    ? ` data-fbo-file="${esc(r.range.file)}" data-fbo-src-start="${r.range.start}" data-fbo-src-end="${r.range.end}"`
    : '';
  // Chỗ neo trong file đang mở — dùng khi không muốn (hoặc không cần) mở file Include ra.
  const hostRef = r.hostRef
    ? ` data-fbo-host-start="${r.hostRef.start}" data-fbo-host-end="${r.hostRef.end}"`
    : '';
  const foreign = r.foreign ? ' data-fbo-foreign="1"' : '';
  const product = r.product ? ' data-fbo-product="1"' : '';
  const side = half
    ? (half.colStart === 0 ? ' data-fbo-split-side="left"' : ' data-fbo-split-side="right"')
    : '';

  return `<tr class="FormRow" data-fbo-item="${r.index}" data-fbo-start="${span?.start ?? ''}" data-fbo-end="${span?.end ?? ''}"${side}${entity}${origin}${hostRef}${foreign}${product}>${cells}</tr>`;
}

/** Vùng chứa hàng — để `renderRowHtml` biết có split hay không. */
function regionOfRow(model, row) {
  return model.regions.find((reg) => reg.rows.some((r) => r.index === row.index)) ?? null;
}

/**
 * HTML của đúng một hàng, tra theo `<item>` index — nguồn của phép render cục bộ.
 *
 * Gộp/tách ô chỉ đổi phần pattern của MỘT `<item value>`, nên chỉ một `<tr>` đổi theo. Dựng lại
 * cả form cho một thay đổi như thế là ném đi vị trí cuộn, tab đang mở và ô đang chọn — ba thứ
 * người dùng vừa mất công đặt vào đúng chỗ.
 *
 * Khi vùng có `split`, trả HAI `<tr>` (trái rồi phải) — `patchRow` thay cả hai chỗ cùng
 * `data-fbo-item`.
 *
 * Trả `null` khi hàng không còn (bị xoá, hoặc index lệch) — người gọi phải hiểu đó là tín hiệu
 * "vá không được, vẽ lại cả form" chứ không phải "không có gì đổi".
 */
export function renderRowHtml(model, item) {
  if (!model || model.mode !== 'form') return null;
  const row = model.rows.find((r) => r.index === item);
  if (!row) return null;
  const region = regionOfRow(model, row);
  const gridOnly = region ? regionIsEmbeddedGridOnly(region, model) : false;
  const split = region ? splitColCount(region, gridOnly) : null;
  if (split === null) return renderRow(row, model);
  return [
    renderRow(row, model, { colStart: 0, colEnd: split, widths: region.widths }),
    renderRow(row, model, { colStart: split, colEnd: region.widths.length, widths: region.widths }),
  ].join('\n');
}

/** Hàng tiêu đề cột ẩn — `data-fbo-col` là chỉ số CỘT TOÀN VÙNG (không reset về 0 ở bảng phải). */
function renderColHeader(widths, colOffset) {
  return widths.map((w, i) => {
    const col = colOffset + i;
    return `<th style="width:${w}px;" data-fbo-col="${col}"${w === 0 ? ` data-fbo-zero-col="1" title="cột ${col + 1} · 0px"` : ''}></th>`;
  }).join('');
}

/**
 * Một nửa FormTable (trái hoặc phải khi có split, hoặc cả vùng khi không).
 *
 * `meta` mang list px CỦA NỬA này (để blueprint đo zoom / vạch cục bộ). `anchor`/`split` và list
 * px ĐẦY ĐỦ nằm ở bọc ngoài khi có split — xem `renderRegionTable`.
 */
function renderFormTable(region, model, {
  widths, colOffset, half, side, gridOnly, includeRegionMeta,
}) {
  const cols = renderColHeader(widths, colOffset);
  const rows = region.rows.map((r) => renderRow(r, model, half)).join('\n');
  const total = widths.reduce((a, b) => a + b, 0);
  const meta = ` data-fbo-col-widths="${widths.join(',')}"`
    + ` data-fbo-col-offset="${colOffset}"`
    + (side ? ` data-fbo-split-side="${side}"` : '')
    + (includeRegionMeta && !gridOnly && region.anchor !== null ? ` data-fbo-anchor="${region.anchor}"` : '')
    + (includeRegionMeta && !gridOnly && region.split !== null ? ` data-fbo-split="${region.split}"` : '')
    + (gridOnly ? ' data-fbo-grid-only="1"' : '');

  return [
    `<table class="FormTable" cellpadding="0" cellspacing="0" style="width:${total}px;table-layout:fixed;" data-fbo-region-table="${region.id}"${meta}>`,
    `<tr class="FormRow DwfColRow">${cols}</tr>`,
    rows,
    '</table>',
  ].join('\n');
}

/**
 * Một vùng = một (hoặc hai) `<table class="FormTable">` đo bằng list px CỦA VÙNG đó.
 *
 * Runtime khi `split=k`: bảng cha 2 cột → trái `formTable` (cột 1..k) + phải `formTablesplit`
 * (cột k+1..hết). Designer giữ cấu trúc ấy để preview khớp form thật; blueprint đọc
 * `data-fbo-region-root` (list px đầy đủ + split/anchor) và từng nửa FormTable.
 */
function renderRegionTable(region, model) {
  // Tab/vùng CHỈ chứa ô lưới Detail: không gắn anchor/split — chúng vô nghĩa trên một ô nhúng
  // lưới, và blueprint kéo chúng là ghi số vào `<category>`/`<view>` không liên quan layout lưới.
  const gridOnly = regionIsEmbeddedGridOnly(region, model);
  const split = splitColCount(region, gridOnly);

  if (split === null) {
    return renderFormTable(region, model, {
      widths: region.widths,
      colOffset: 0,
      half: null,
      side: null,
      gridOnly,
      includeRegionMeta: true,
    });
  }

  const leftW = region.widths.slice(0, split);
  const rightW = region.widths.slice(split);
  const leftTotal = leftW.reduce((a, b) => a + b, 0);
  const rightTotal = rightW.reduce((a, b) => a + b, 0);
  const fullMeta = ` data-fbo-region-root="${region.id}" data-fbo-region-table="${region.id}"`
    + ` data-fbo-col-widths="${region.widths.join(',')}"`
    + (region.anchor !== null ? ` data-fbo-anchor="${region.anchor}"` : '')
    + ` data-fbo-split="${region.split}"`
    + (gridOnly ? ' data-fbo-grid-only="1"' : '');

  const left = renderFormTable(region, model, {
    widths: leftW,
    colOffset: 0,
    half: { colStart: 0, colEnd: split, widths: region.widths },
    side: 'left',
    gridOnly,
    includeRegionMeta: false,
  });
  const right = renderFormTable(region, model, {
    widths: rightW,
    colOffset: split,
    half: { colStart: split, colEnd: region.widths.length, widths: region.widths },
    side: 'right',
    gridOnly,
    includeRegionMeta: false,
  });

  return [
    `<div class="FormSplit"${fullMeta} style="width:${region.totalWidth}px;">`,
    `<table class="FormParentTable" cellpadding="0" cellspacing="0" style="border-collapse:collapse;table-layout:fixed;width:${region.totalWidth}px;">`,
    `<tr><th style="width:${leftTotal}px;"></th><th style="width:${rightTotal}px;"></th></tr>`,
    '<tr style="vertical-align:top;">',
    `<td>${left}</td>`,
    `<td>${right}</td>`,
    '</tr>',
    '</table>',
    '</div>',
  ].join('\n');
}

/**
 * Mọi ô có token trong vùng đều là lưới Detail (`<items style="Grid"/>`).
 * Vùng rỗng → false (không gắn cờ grid-only).
 */
function regionIsEmbeddedGridOnly(region, model) {
  let saw = false;
  for (const r of region.rows ?? []) {
    for (const c of r.cells ?? []) {
      if (c.empty || !c.token?.field) continue;
      const field = model.fieldByName?.get(c.token.field);
      if (String(field?.items?.style ?? '').toLowerCase() !== 'grid') return false;
      saw = true;
    }
  }
  return saw;
}

/**
 * Mảnh cấu hình ẩn của lưới → `{fields, columns, arrangement}` để `renderGrid` gộp vào.
 *
 * Người gọi truyền vào văn bản ĐÃ BUNG ENTITY kèm `segments` của chính file ấy — core không chạm
 * đĩa, cùng một giao kèo với `loadDetail`. `Grid/Config/Initialize.xml` dựa hẳn vào parameter
 * entity (`%Control.Field;` kéo cả `Include\Field.ent` vào), nên chưa bung thì không có
 * `<controller>` nào để mà đọc.
 *
 * Quét bằng CHÍNH `scanFields`/`scanViews` đã dùng cho controller: hai file khác tên thẻ gốc
 * (`<group>` với `<grid xmlns=…grid-fields>`) nhưng ruột thì cùng một hình dạng, và dựng bộ quét
 * thứ hai cho cùng một hình dạng là dựng sẵn chỗ cho hai bên trôi khỏi nhau.
 */
function scanGridConfig(parts) {
  if (!Array.isArray(parts)) return [];
  return parts.map((p) => {
    const view = scanViews(p.text).find((v) => (v.columns ?? []).length > 0);
    return {
      fields: scanFields(p.text),
      columns: view?.columns ?? [],
      arrangement: view?.attrs?.arrangement ?? '',
      segments: p.segments ?? null,
      file: p.file ?? '',
      // `kind` để tô màu và để nói ra nguồn; `rank` để xếp thứ tự cột. Xem `mergeGridConfig`.
      kind: p.kind ?? null,
      rank: Number.isFinite(p.rank) ? p.rank : 1,
    };
  });
}

/**
 * Đường tắt: văn bản XML → HTML thân màn hình.
 *
 * `<dir>` (Dir/ và Filter/) ra Form; `<grid>` ra lưới Detail. Chọn theo GỐC TÀI LIỆU chứ không
 * theo thư mục — xem `scanRoot`.
 *
 * @returns {{html: string, model: object|null, warnings: Array<{item:number,message:string}>, mode: string}}
 */
export function renderControllerHtml(text, opts = {}) {
  const root = scanRoot(text);
  const views = scanViews(text);
  const fields = scanFields(text);

  // CSS do CHÍNH controller khai — nút riêng của khách lấy icon từ đây, và base pack không thể
  // biết trước. Tính TRƯỚC mọi nhánh return để lối nào cũng trả kèm.
  const css = scanCss(text);

  if (views.length === 0) {
    return {
      html: '<p class="FboEmpty">Không tìm thấy &lt;view&gt; nào trong file.</p>',
      model: null,
      warnings: [],
      mode: root.mode,
      root,
      css,
    };
  }

  if (root.mode === 'grid') {
    const built = renderGrid(views, fields, {
      ...opts,
      root,
      title: scanTitle(text),
      toolbar: scanToolbar(text),
      css,
      config: scanGridConfig(opts.gridConfig),
    });
    return { ...built, mode: 'grid', root, css };
  }

  const model = buildViewModel(views[0], fields, { ...opts, title: scanTitle(text), pageCss: css });
  model.foreignRows = model.rows.filter((r) => r.foreign).length;
  model.productRows = model.rows.filter((r) => r.product).length;
  model.root = root;
  // CSS gửi ra = của controller + của mọi lưới Detail nhúng trong nó.
  // `skipHtml`: tầng edit chỉ cần model — bỏ renderViewHtml.
  const html = opts.skipHtml ? '' : renderViewHtml(model);
  return {
    html,
    model,
    warnings: model.warnings,
    mode: 'form',
    root,
    css: [css, ...model.detailCss].filter(Boolean).join('\n'),
  };
}
