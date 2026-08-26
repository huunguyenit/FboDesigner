// spans.mjs — quét XML controller và ghi lại VỊ TRÍ, không dựng cây đầy đủ.
//
// Vì sao không dùng XML parser chuẩn: file chứa `&Entity;` chưa phân giải và tham số `%X;`.
// Parser tuân thủ chuẩn sẽ hoặc lỗi, hoặc đòi phân giải toàn bộ include trước.
//
// Vì sao không dùng lối quét của hub (`mcp/fbo/lib/xmlscan.mjs`): nó cố tình KHÔNG giữ vị
// trí — đủ để trả lời "file này có field nào", không đủ để GHI NGƯỢC. Designer sửa file thì
// mọi thay đổi phải là splice `[start,end)` lên văn bản gốc, để phần không đụng tới giữ
// nguyên từng byte: encoding, CRLF, thụt lề, comment, và cả entity chưa phân giải.
//
// Phạm vi P0: `<view>` và `<item>` con của nó, cộng `<field>` trong `<fields>`. CST đầy đủ
// là việc của P2 — đừng dùng file này để khẳng định "XML well-formed".

const RE_VIEW_OPEN = /<view\b([^>]*)>/gi;
const RE_ITEM = /<item\b([^>]*?)(\/?)>/gi;
const RE_FIELD_OPEN = /<field\b([^>]*?)(\/?)>/gi;
const RE_ATTR = /([\w:%.-]+)\s*=\s*(["'])([\s\S]*?)\2/g;
const RE_ENTITY_REF = /&[A-Za-z_][\w.:-]*;/;
const RE_OPTION = /<item\b([^>]*)>([\s\S]*?)<\/item>/gi;
const RE_CATEGORIES = /<categories\b[^>]*>([\s\S]*?)<\/categories>/i;
const RE_CATEGORY = /<category\b([^>]*?)(?:\/>|>([\s\S]*?)<\/category>)/gi;
const RE_TEXT = /<text\b([^>]*)/i;
const RE_ROOT_NS = /<([A-Za-z_][\w.:-]*)\b([^>]*xmlns\s*=\s*["']urn:schemas-fast-com:data-([\w-]+)["'][^>]*)>/i;
const RE_ROOT_BARE = /<([A-Za-z_][\w.:-]*)\b([^>]*)>/;

/** Bóc attribute kèm vị trí của phần GIÁ TRỊ (không gồm dấu nháy) — chỗ splice nhắm tới. */
function parseAttrs(attrText, attrOffset) {
  const attrs = {};
  const spans = {};
  RE_ATTR.lastIndex = 0;
  let m;
  while ((m = RE_ATTR.exec(attrText)) !== null) {
    const name = m[1];
    if (name in attrs) continue; // attribute lặp: bản đầu thắng, giống trình duyệt
    attrs[name] = m[3];
    const valueStart = attrOffset + m.index + m[0].length - m[3].length - 1;
    spans[name] = { start: valueStart, end: valueStart + m[3].length };
  }
  return { attrs, spans };
}

/** Tìm `</view>` đóng cho một `<view>` mở tại openEnd. Giả định view không lồng nhau. */
function findViewClose(text, openEnd) {
  const idx = text.toLowerCase().indexOf('</view>', openEnd);
  return idx === -1 ? text.length : idx;
}

/**
 * @returns {Array<{start,end,innerStart,innerEnd,attrs,attrSpans,items:Array}>}
 *
 * `items` chỉ gồm `<item>` con của view. `<item>` của `<field><items>` (lựa chọn dropdown,
 * gần một phần tư số thẻ item trong corpus) nằm ngoài phạm vi view nên KHÔNG lọt vào đây —
 * đó là lý do quét theo view chứ không grep `<item value` toàn file.
 */
export function scanViews(text) {
  const views = [];
  RE_VIEW_OPEN.lastIndex = 0;
  let v;
  while ((v = RE_VIEW_OPEN.exec(text)) !== null) {
    const innerStart = v.index + v[0].length;
    const innerEnd = findViewClose(text, innerStart);
    const { attrs, spans } = parseAttrs(v[1], v.index + v[0].length - v[1].length - 1);

    const items = [];
    const inner = text.slice(innerStart, innerEnd);
    RE_ITEM.lastIndex = 0;
    let it;
    while ((it = RE_ITEM.exec(inner)) !== null) {
      const start = innerStart + it.index;
      const attrOffset = start + it[0].length - it[1].length - (it[2] ? 2 : 1);
      const parsed = parseAttrs(it[1], attrOffset);
      const value = parsed.attrs.value ?? null;
      items.push({
        start,
        end: start + it[0].length,
        attrs: parsed.attrs,
        attrSpans: parsed.spans,
        value,
        valueSpan: parsed.spans.value ?? null,
        hasEntity: value !== null && RE_ENTITY_REF.test(value),
      });
    }

    // View của <grid> không có <item value>: nó là DANH SÁCH CỘT, mỗi cột một <field name>.
    // Thứ tự khai chính là thứ tự cột — nên phải giữ nguyên thứ tự quét, không sort.
    const columns = [];
    RE_FIELD_OPEN.lastIndex = 0;
    let cf;
    while ((cf = RE_FIELD_OPEN.exec(inner)) !== null) {
      const start = innerStart + cf.index;
      const attrOffset = start + cf[0].length - cf[1].length - (cf[2] ? 2 : 1);
      const parsed = parseAttrs(cf[1], attrOffset);
      if (!parsed.attrs.name) continue;
      columns.push({ start, end: start + cf[0].length, attrs: parsed.attrs, attrSpans: parsed.spans, name: parsed.attrs.name });
    }

    const categories = scanCategories(inner, innerStart);

    views.push({ start: v.index, end: innerEnd + '</view>'.length, innerStart, innerEnd, attrs, attrSpans: spans, items, columns, categories });
    RE_VIEW_OPEN.lastIndex = innerEnd;
  }
  return views;
}

/**
 * `<categories><category index columns anchor split><header v e/></category></categories>`
 * bên trong một view — bản khai của TAB và của vùng FOOTER.
 *
 * `index` là chìa: `>0` là một tab, `-1` là vùng footer dưới đáy form, `0` (hoặc không có
 * category nào khớp) là vùng main. `columns` là list px RIÊNG của vùng đó — vùng khai columns
 * riêng mà vẫn vẽ bằng list px của view là mọi ô trong tab lệch cột, đúng lỗi "form có
 * categoryIndex load chưa đúng".
 *
 * Thứ tự trả về là thứ tự KHAI trong XML, không sort theo index — runtime xếp tab theo thứ tự
 * khai (`ErpViewLayoutBuilder.ParseCategories` của DWF ghi rõ điều này).
 */
function scanCategories(inner, innerStart) {
  const block = RE_CATEGORIES.exec(inner);
  if (!block) return [];

  const bodyOffset = innerStart + block.index + block[0].length - block[1].length - '</categories>'.length;
  const list = [];
  RE_CATEGORY.lastIndex = 0;
  let c;
  while ((c = RE_CATEGORY.exec(block[1])) !== null) {
    const start = bodyOffset + c.index;
    const attrOffset = start + c[0].indexOf(c[1]);
    const { attrs, spans } = parseAttrs(c[1], attrOffset);
    const index = Number.parseInt(attrs.index, 10);
    if (!Number.isInteger(index)) continue;

    const h = c[2] ? /<header\b([^>]*)/i.exec(c[2]) : null;
    list.push({
      start,
      end: start + c[0].length,
      index,
      columns: attrs.columns ?? '',
      attrs,
      attrSpans: spans,
      header: h ? parseAttrs(h[1], 0).attrs : null,
    });
  }
  return list;
}

/** Khoảng [innerStart, innerEnd) của mọi `<view>` — dùng để loại field NẰM TRONG view. */
function viewRanges(text) {
  const ranges = [];
  const re = new RegExp(RE_VIEW_OPEN.source, 'gi');
  let m;
  while ((m = re.exec(text)) !== null) {
    const innerStart = m.index + m[0].length;
    const innerEnd = findViewClose(text, innerStart);
    ranges.push({ start: innerStart, end: innerEnd });
    re.lastIndex = innerEnd;
  }
  return ranges;
}

/**
 * `<field name="…">` trong `<fields>` — name + header + footer + items + query để dựng control.
 *
 * Field NẰM TRONG `<view>` bị loại. View của `<grid>` khai cột bằng `<field name="x"/>` trần,
 * không header không width; nhặt cả chúng vào đây thì bản khai đầy đủ ở `<fields>` bị bản trần
 * ghi đè (Map lấy bản sau), và mọi cột Grid mất nhãn lẫn bề rộng — hỏng im lặng, chỉ lộ ra khi
 * mở một màn hình Grid.
 */
export function scanFields(text) {
  const fields = [];
  const inView = viewRanges(text);
  RE_FIELD_OPEN.lastIndex = 0;
  let f;
  while ((f = RE_FIELD_OPEN.exec(text)) !== null) {
    const start = f.index;
    if (inView.some((r) => start >= r.start && start < r.end)) continue;
    const attrOffset = start + f[0].length - f[1].length - (f[2] ? 2 : 1);
    const { attrs, spans } = parseAttrs(f[1], attrOffset);
    if (!attrs.name) continue;

    let header = null;
    let footer = null;
    let items = null;
    let query = null;
    let options = [];
    if (!f[2]) {
      const bodyEnd = text.toLowerCase().indexOf('</field>', f.index);
      const body = text.slice(f.index + f[0].length, bodyEnd === -1 ? undefined : bodyEnd);

      const h = /<header\b([^>]*)/i.exec(body);
      if (h) header = parseAttrs(h[1], 0).attrs;

      // `<footer>` là nguồn của ô `.Description`. Thiếu nó mới rơi về `<header>` — đọc thiếu
      // footer thì ô mô tả hiện lại chính cái nhãn, sai mà nhìn không ra ngay.
      const ft = /<footer\b([^>]*)/i.exec(body);
      if (ft) footer = parseAttrs(ft[1], 0).attrs;

      const it = /<items\b([^>]*)/i.exec(body);
      if (it) items = parseAttrs(it[1], 0).attrs;

      /*
       * `<query>` CON CỦA MỘT FIELD là bản khai lọc nhanh, không phải một câu SQL bất kỳ.
       *
       * Đếm trên corpus FBISP24 (`Grid/`): 3715 thẻ `<query>` nằm trong `<field>`, thì 3711 cái
       * có nội dung đúng một entity `&InsertCommandFilter;`; bốn cái còn lại là
       * `<queries><query event="…">` cấp lưới, không phải cấp field. Nên "field có `<query>`
       * không rỗng" đọc được thẳng thành "cột này khai lọc nhanh".
       *
       * Giữ NỘI DUNG chứ không giữ cờ boolean: entity đã được phân giải trước khi quét, và
       * `&InsertCommandFilter;` phân giải thành CHUỖI RỖNG khi `Include\Filter.txt` là IGNORE.
       * Đó chính là công tắc tắt lọc của cả hệ thống — một cờ boolean đặt lúc quét sẽ nuốt mất
       * nó và cột vẫn hiện ô lọc trong khi runtime không hiện.
       */
      const q = /<query\b[^>]*>([\s\S]*?)<\/query>/i.exec(body);
      if (q) query = q[1].trim();

      // `<item value="0"><text v e/></item>` — lựa chọn của combo, KHÔNG dính gì tới layout.
      RE_OPTION.lastIndex = 0;
      let op;
      while ((op = RE_OPTION.exec(body)) !== null) {
        const t = parseAttrs(RE_TEXT.exec(op[2])?.[1] ?? '', 0).attrs;
        options.push({ value: parseAttrs(op[1], 0).attrs.value ?? '', v: t.v ?? '', e: t.e ?? '' });
      }
    }
    fields.push({ name: attrs.name, start, attrs, attrSpans: spans, header, footer, items, query, options });
  }
  return fields;
}

/**
 * Gốc tài liệu: tên thẻ + schema `urn:schemas-fast-com:data-*`.
 *
 * Đây mới là thứ quyết định render kiểu gì, KHÔNG phải tên thư mục. `Filter/*.f` cũng là
 * `<dir xmlns="…data-dir">` nên vẽ ra Form; `Grid/*.f` là `<grid type="Detail">` nên vẽ ra
 * lưới. Thư mục chỉ là chỗ cất file, gốc tài liệu mới là hợp đồng — và có file Grid nằm ngoài
 * `Grid/`.
 *
 * @returns {{tag: string|null, schema: string|null, mode: 'form'|'grid', attrs: object}}
 */
export function scanRoot(text) {
  const ns = RE_ROOT_NS.exec(text);
  if (ns) {
    const schema = ns[3].toLowerCase();
    return { tag: ns[1], schema, mode: schema === 'grid' ? 'grid' : 'form', attrs: parseAttrs(ns[2], 0).attrs };
  }
  // Không có xmlns (fixture test, mảnh file cắt rời): rơi về thẻ phần tử đầu tiên.
  const bare = RE_ROOT_BARE.exec(text);
  if (!bare) return { tag: null, schema: null, mode: 'form', attrs: {} };
  const tag = bare[1].toLowerCase();
  return { tag: bare[1], schema: null, mode: tag === 'grid' ? 'grid' : 'form', attrs: parseAttrs(bare[2], 0).attrs };
}

/**
 * `<toolbar><button command="…"><title v e/></button></toolbar>` của một `<grid>`.
 *
 * Dải nút của lưới KHÔNG phải thứ đoán được như dải nút đáy của form: nó được KHAI ngay trong
 * file, từng nút một, đúng thứ tự. Nên ở đây vẽ được mà không bịa gì.
 *
 * Hai quy ước trong `<title>`:
 *   `-`               → dấu ngăn cách, không phải nút
 *   `tooltip$nhãn$px` → dấu phân cách là MỘT `$`; xem `toolbarButton` ở `grid.mjs`
 *
 * `Toolbar.<Command>` là KHOÁ TÀI NGUYÊN, không phải nhãn — runtime tra nó ra tiếng Việt.
 * Bảng tra nằm trong binary của program, không có file nào trong `App_Data` khai nó, nên phần
 * dịch khoá là bảng cứng ở `grid.mjs`. Nhãn viết thẳng (như nút riêng của khách) thì dùng
 * nguyên văn.
 *
 * `<menuItems>` BẮT BUỘC phải đọc, không phải phần trang trí bỏ qua được: runtime lấy đúng sự
 * có mặt của nó để quyết nút là «group» hay không, và group đổi CẢ tên class (`TextRetrieve` →
 * `TextGroupRetrieve`, tức đổi hẳn ô sprite), CẢ ruột thẻ (nhãn bị bọc trong
 * `<span class="ToolbarGroupSpan">` để có mũi tên xổ xuống), CẢ bề rộng khi nút chỉ có icon
 * (30px thay vì 22px). Bỏ qua `<menuItems>` là nút «Lấy dữ liệu» hiện icon của nút «Sửa».
 */
export function scanToolbar(text) {
  const block = /<toolbar\b[^>]*>([\s\S]*?)<\/toolbar>/i.exec(text);
  if (!block) return [];

  const buttons = [];
  const re = /<button\b([^>]*?)(?:\/>|>([\s\S]*?)<\/button>)/gi;
  let m;
  while ((m = re.exec(block[1])) !== null) {
    const command = parseAttrs(m[1], 0).attrs.command ?? '';
    const body = m[2] ?? '';
    const t = body ? /<title\b([^>]*)/i.exec(body) : null;
    const title = t ? parseAttrs(t[1], 0).attrs : {};
    buttons.push({ command, v: title.v ?? '', e: title.e ?? '', menu: scanMenuItems(body) });
  }
  return buttons;
}

/**
 * `<menuItems><menuItem commandArgument="10"><header v e/></menuItem></menuItems>`.
 *
 * Mảng RỖNG = nút không phải group. Quy ước này phải giữ nguyên ở mọi lối ra, vì chỗ gọi chỉ
 * nhìn vào độ dài mảng để quyết tên class của nút.
 */
function scanMenuItems(body) {
  const block = /<menuItems\b[^>]*>([\s\S]*?)<\/menuItems>/i.exec(body);
  if (!block) return [];

  const items = [];
  const re = /<menuItem\b([^>]*?)(?:\/>|>([\s\S]*?)<\/menuItem>)/gi;
  let m;
  while ((m = re.exec(block[1])) !== null) {
    const arg = parseAttrs(m[1], 0).attrs.commandArgument ?? '';
    const h = m[2] ? /<header\b([^>]*)/i.exec(m[2]) : null;
    const header = h ? parseAttrs(h[1], 0).attrs : {};
    items.push({ arg, v: header.v ?? '', e: header.e ?? '' });
  }
  return items;
}

/** `<title v e>` của controller — dùng cho thanh tiêu đề «Thêm {title}». */
export function scanTitle(text) {
  const m = /<title\b([^>]*)>/i.exec(text);
  return m ? parseAttrs(m[1], 0).attrs : null;
}

/**
 * Áp danh sách splice lên văn bản gốc. Áp từ phải sang trái để offset phía trước không lệch.
 * Splice chồng nhau là lỗi lập trình, không phải trường hợp cần đoán ý — ném luôn.
 *
 * @param {Array<{start:number,end:number,text:string}>} splices
 */
export function applySplices(text, splices) {
  const sorted = [...splices].sort((a, b) => b.start - a.start);
  let prevStart = Infinity;
  let out = text;
  for (const s of sorted) {
    if (s.start < 0 || s.end > text.length || s.start > s.end) {
      throw new Error(`applySplices: khoảng [${s.start},${s.end}) nằm ngoài văn bản dài ${text.length}`);
    }
    if (s.end > prevStart) throw new Error(`applySplices: splice chồng nhau tại [${s.start},${s.end})`);
    out = out.slice(0, s.start) + s.text + out.slice(s.end);
    prevStart = s.start;
  }
  return out;
}

/**
 * `<css><text><![CDATA[ … ]]></text></css>` của controller — CSS do CHÍNH màn hình khai.
 *
 * Đây là chỗ program tự định nghĩa kiểu cho những thứ base pack không thể biết trước: nút
 * toolbar riêng của khách (`div.APTranImport` có icon base64 của riêng nó), rồi `.Break`,
 * `.LabelDescription`… Không nạp thì mấy thứ đó hiện trần trụi, và nút riêng thì mất hẳn icon.
 *
 * Bẫy của định dạng: CDATA bị NGẮT QUÃNG để nhét giá trị entity vào giữa —
 *
 *     <![CDATA[ div.]]>APTranImport<![CDATA[ { … } ]]>
 *
 * Sau khi bung entity, phần nằm giữa hai khối CDATA chính là giá trị đã thay. Nên cách ghép
 * đúng là **bỏ dấu `<![CDATA[` và `]]>` rồi giữ lại tất cả phần còn lại** — cắt lấy riêng ruột
 * từng khối CDATA sẽ đánh rơi đúng những cái tên vừa được thay vào.
 *
 * @returns {string} CSS đã ghép; rỗng nếu controller không khai.
 */
export function scanCss(text) {
  const block = /<css\b[^>]*>([\s\S]*?)<\/css>/i.exec(text);
  if (!block) return '';
  const body = /<text\b[^>]*>([\s\S]*?)<\/text>/i.exec(block[1]);
  if (!body) return '';
  return body[1]
    .replace(/<!\[CDATA\[/g, '')
    .replace(/\]\]>/g, '')
    /*
     * `<Encrypted>…</Encrypted>` — CSS đã mã hoá bằng khoá của Fast. Bỏ hẳn.
     *
     * Nhét nguyên khối base64 vào `<style>` thì phần CSS đọc được nằm ngay sau nó cũng hỏng
     * theo, nên bỏ là bắt buộc chứ không phải cho gọn.
     *
     * HỆ QUẢ, ghi ra đây để không ai đi tìm lại: bản build bằng `.f` giấu CSS riêng của khách
     * trong khối này, nên icon của nút toolbar riêng (`div.PurOrgDeclaration` →
     * `images/Lookup.png`) KHÔNG dựng lại được. Nút vẫn hiện đủ chữ, chỉ thiếu icon — và đó là
     * mức chấp nhận được, đã chốt. Bản `.xml` customize viết CSS dạng rõ thì vẫn nạp bình
     * thường; phần rõ trong cùng file (`&GridExtraToolbarCss;`) cũng vậy.
     */
    .replace(/<Encrypted>[\s\S]*?<\/Encrypted>/gi, '')
    .trim();
}
