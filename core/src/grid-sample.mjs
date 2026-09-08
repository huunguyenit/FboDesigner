// grid-sample.mjs — dựng câu lệnh lấy vài dòng dữ liệu THẬT cho một lưới.
//
// Vì sao có nó: chỉnh bề rộng cột trên blueprint là làm bằng cảm tính. Không ai biết cột 60px
// có cắt mất tên khách hay không cho tới khi màn hình chạy trên máy khách. Vài dòng thật đổ vào
// lưới trả lời câu ấy trong một giây.
//
// ═══ MỘT LƯỚI LẤY DỮ LIỆU THEO ĐÚNG BỐN KIỂU, VÀ `type` NÓI KIỂU NÀO ═══
//
//   `type` trống   DANH MỤC. Không có query nào cả — dữ liệu là chính `grid@table`, cột theo
//                  `view/field`, thứ tự theo `grid@order`. Câu lệnh dựng HOÀN TOÀN từ định
//                  danh, không một mẩu SQL nào của file lọt vào. 555/2017 lưới của FBISP24.
//
//   `Voucher`      CHỨNG TỪ. `<query event="Loading">` là một lời gọi
//                  `FastBusiness$App$Voucher$Loading` với danh sách cột truyền vào dưới dạng
//                  chuỗi. Chạy lại chính lời gọi ấy, chỉ thay các biến `@@…`.
//
//   `Detail`       LƯỚI CHI TIẾT. `<query event="Loading">` là một câu `select` thường:
//                  `select @@fieldExternal from @@prime$partition$current a left join … where
//                  @@whereClause order by @@orderByClause`.
//
//   `Report`       BÁO CÁO. Lưới không có bảng và không có query — dữ liệu do
//                  `<command event="Processing">` của FILE FILTER cùng tên sinh ra, đổ vào
//                  bảng `#$query`. Phải hỏi người dùng giá trị cho từng tham số `@x` rồi mới
//                  chạy được.
//
//   `Inquiry` và các kiểu còn lại không tự lấy dữ liệu (màn hình cha bơm vào) — từ chối, nói rõ.
//
// ═══ LUẬT ĐÃ ĐỔI, VÀ ĐỔI CÓ CHỦ Ý ═══
//
// Bản đầu của file này có luật «không một mẩu SQL nào của file khách đi thẳng vào câu lệnh»:
// nó tự dựng lại phép join từ cặp khoá đọc được ở `<query event="Finding">`. Luật ấy nay CHỈ
// còn áp cho nhánh DANH MỤC.
//
// Vì sao bỏ: câu tự dựng chạy được nhưng trả về dữ liệu KHÁC với dữ liệu runtime hiện ra — sai
// join, thiếu mệnh đề `where` phân quyền, sai kỳ. Một bản xem trước nói dối về màn hình thật là
// hỏng đúng cái nó sinh ra để chữa. Ba nhánh Voucher/Detail/Report vì thế chạy CHÍNH câu query
// của file, và chỗ duy nhất ta thay là các biến `@@…`.
//
// Đánh đổi phải nói thẳng: lệnh này giờ CHẠY SQL CỦA FILE trên database của khách. Nó vẫn
// chỉ-đọc theo ý định, nhưng ý định ấy là của người viết controller, không phải của file này —
// nếu một câu `Loading` có tác dụng phụ thì tác dụng phụ ấy xảy ra. Tầng vỏ phải hỏi trước khi
// chạy nhánh Report (nhánh duy nhất gọi tới một stored procedure báo cáo của khách).
//
// Cái KHÔNG đổi: mọi thứ do FILE NÀY sinh ra — tên bảng, tên cột, alias, mệnh đề order by —
// vẫn đi qua `assertIdent` trước khi ghép. Ta không thêm lỗ hổng nào của riêng mình vào một câu
// lệnh vốn đã là của khách.

import { scanRoot, scanViews, scanFields } from './spans.mjs';
import { scanPartition, readAliasName } from './filter-declare.mjs';
import { resolveLocaleName } from './control.mjs';
import { assertIdent } from './sql-config.mjs';
import { msg, SAMPLE_PARAMS, SQL_CONFIG } from './msg.mjs';
import { isDateField, resolveMask } from './format.mjs';

/** Mặc định đủ để thấy dữ liệu dài ngắn ra sao, mà không kéo về một trang lưới. */
export const SAMPLE_TOP_DEFAULT = 10;
/** Trần cứng. Đây là phép XEM TRƯỚC để đo cột, không phải công cụ trích dữ liệu. */
export const SAMPLE_TOP_MAX = 100;

/**
 * Dòng đánh dấu «từ đây trở xuống mới là dữ liệu».
 *
 * Cần vì ba nhánh kia chạy SQL của file, và SQL ấy in ra nhiều bộ kết quả trước bộ ta cần —
 * `select cast(@ngay as smalldatetime) as date_to, …` đứng ngay trước `exec` trong hầu hết câu
 * Processing. `sqlcmd -h -1` nối mọi bộ kết quả thành một dòng liền, nên không có mốc thì phép
 * ghép cột-theo-vị-trí lệch đúng bằng số dòng thừa ấy.
 *
 * Chọn một chuỗi không ai gõ nhầm được, và KHÔNG dùng ký tự phải escape trong SQL.
 */
export const SAMPLE_SENTINEL = '~fbo-sample~';

/** Bảng tạm TOÀN CỤC hứng kết quả báo cáo — xem `buildReportSelect` về lý do phải là `##`. */
const REPORT_TABLE = '##fbo$sample';

/** Bỏ một cột khỏi câu lệnh, kèm lý do đọc được. */
function skip(code, params) {
  return { code, message: msg(code, params), ...params };
}

/**
 * Bảng là TIỀN TỐ chia kỳ chứ chưa phải một bảng thật?
 *
 * `m64$` mới chỉ là tiền tố, kỳ nào thì nối thêm vào sau. `assertIdent` không bắt được ca này
 * (`$` là ký tự hợp lệ trong định danh SQL Server), nên phải hỏi riêng — chạy `select from m64$`
 * là chắc chắn "Invalid object name".
 */
function isPartitionPrefix(table) {
  return /\$$/.test(String(table ?? '').trim());
}

/**
 * Kỳ hiện tại dưới dạng `YYYYMM` — giá trị thay cho `$partition$current`.
 *
 * Luật (xác nhận của người dùng 2026-09-07): **có thẻ `<partition>` thì chắc chắn có chia kỳ**.
 * Nên không dò `partition@default`, không hỏi database — kỳ của một phép xem trước là kỳ đang
 * làm việc, tức tháng hiện tại.
 */
export function partitionPeriod(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${y}${m}`;
}

/**
 * Che một giá trị, GIỮ NGUYÊN ĐỘ DÀI.
 *
 * Giữ trong core để test / tiện ích đo độ dài chuỗi; tầng extension không còn che dữ liệu mẫu
 * — xem trước luôn hiện giá trị SQL thật.
 *
 * Cách che: chữ hoa thành `X`, chữ thường thành `x`, chữ số thành `0`. Khoảng trắng và dấu
 * ngăn giữ nguyên.
 */
export function maskSampleValue(value) {
  if (value === null || value === undefined) return value;
  return String(value).replace(/\p{Lu}|\p{Lt}|\p{Ll}|\p{N}/gu, (ch) => {
    if (/\p{N}/u.test(ch)) return '0';
    return ch === ch.toLowerCase() ? 'x' : 'X';
  });
}

/** Che mọi ô của mọi dòng. Khoá (tên cột) KHÔNG che — nó là bản khai, không phải dữ liệu. */
export function maskSampleRows(rows) {
  return (rows ?? []).map((row) => {
    const out = {};
    for (const [k, v] of Object.entries(row)) out[k] = maskSampleValue(v);
    return out;
  });
}

/* ═══════════════════════════════════════════════════════════════════════════════════════
 * KIỂU LƯỚI
 * ═══════════════════════════════════════════════════════════════════════════════════════ */

/**
 * `grid@type` → nhánh dựng câu lệnh.
 *
 * @returns {'catalog'|'voucher'|'detail'|'report'|'unsupported'}
 */
export function sampleKindOf(type) {
  const t = String(type ?? '').trim().toLowerCase();
  if (t === '') return 'catalog';
  if (t === 'voucher') return 'voucher';
  if (t === 'detail') return 'detail';
  if (t === 'report') return 'report';
  return 'unsupported';
}

/* ═══════════════════════════════════════════════════════════════════════════════════════
 * CỘT
 * ═══════════════════════════════════════════════════════════════════════════════════════ */

/** Kiểu chữ → bọc `rtrim()`. Cùng phép thử với `filter-declare.mjs`, cố ý. */
const STRING_FBO_TYPES = new Set((SQL_CONFIG.stringFboTypes ?? ['', 'string']).concat(['varchar', 'nvarchar', 'char']));

function isTextual(field) {
  return STRING_FBO_TYPES.has(String(field?.attrs?.type ?? '').trim().toLowerCase());
}

const isTrue = (v) => String(v ?? '').trim().toLowerCase() === 'true';

/** Định danh SQL trần — cùng bảng chữ cái với `assertIdent`, hỏi mà KHÔNG ném. */
const BARE_IDENT = /^[A-Za-z_][\w$]*$/;

/**
 * Gỡ escape XML khỏi một mẩu SQL đọc từ THUỘC TÍNH.
 *
 * `defaultValue="case when ma_so_thue &amp;lt;&amp;gt; '' then 0 else 1 end"` — dấu `<>` của SQL
 * phải viết escape trong XML, mà bộ quét trả về NGUYÊN VĂN thuộc tính (nó giữ offset để ghi
 * ngược, nên không được phép đổi độ dài chuỗi). Đưa thẳng vào câu lệnh là `&amp;lt;&amp;gt;` chạy
 * vào SQL Server — lỗi cú pháp ở một chỗ không ai nghĩ tới.
 *
 * `&amp;amp;` gỡ SAU CÙNG: gỡ trước thì `&amp;amp;lt;` (một chuỗi muốn nói `&amp;lt;`) thành `&lt;`.
 */
function unescapeXml(text) {
  return String(text ?? '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');
}

/**
 * Phân giải hậu tố ngôn ngữ ở MỌI tên cột bên trong một biểu thức.
 *
 * `resolveLocaleName` chỉ nhận một cái tên; `defaultValue` và `aliasName` thì là biểu thức —
 * `rtrim(u0.statusname%l)`, `rtrim(r0.cname%l + ' ')`. Bỏ sót là câu lệnh mang một tên cột
 * không tồn tại.
 */
function resolveLocaleIn(text, vi) {
  return String(text ?? '').replace(/([A-Za-z_][\w$]*)%l/g, (_, name) => resolveLocaleName(`${name}%l`, vi));
}

/**
 * Một mẩu SQL nguyên văn PHẢI có tên cột, kể cả khi file không viết `as`.
 *
 * `cast(0 as bit) as tag` tự mang tên rồi; `case when a.x = 1 then …end` thì không, và một cột
 * không tên là một cột không ghép ngược lại được với `<field>` nào — mà ghép ngược là toàn bộ
 * việc của phép xem trước.
 *
 * Nhận ra «đã có tên» bằng đuôi ` as <định danh>`: đó là cách duy nhất FBO đặt tên trong các
 * danh sách cột này, và một phép phân tích SQL đầy đủ ở đây là công sức đổ vào ca không có.
 */
function nameExpression(expr, fieldName) {
  const text = String(expr).trim();
  if (/\bas\s+[A-Za-z_][\w$]*\s*$/i.test(text)) return text;
  const safe = String(fieldName).replace(/[^\w$]/g, '_');
  return `${text} as ${BARE_IDENT.test(safe) ? safe : `c${safe}`}`;
}

/**
 * Danh sách cột đưa vào câu lệnh: MỌI field đã khai, theo thứ tự KHAI TRONG `<fields>`.
 *
 * ═══ THỨ TỰ LÀ CỦA `<fields>`, KHÔNG PHẢI CỦA `<view>` ═══
 *
 * Đối chiếu với câu runtime thật của `Grid/SOTran.xml` (HOATP FBISP2421) — người dùng cung cấp
 * ngày 2026-09-07 — thì `@@textList`/`@@textExternal` xếp đúng bằng thứ tự `<fields>` đã merge:
 *
 *     …, t_sl_hd, ma_nt, ds_ma_lo, ma_nvbh, ten_nvbh, t_ck_nt, …, t_tt_nt, dien_giai, ma_ct, status, u0
 *
 * Thứ tự ấy là: `<fields>` của controller, rồi `<fields>` của từng mảnh `Grid/Config` theo hạng
 * (Fields trước Initialize). Hai chi tiết chỉ khớp khi đi đường `<fields>`:
 *
 *   · `t_ck_nt`…`t_tt_nt` đứng SAU `ten_nvbh`. Trên màn hình chúng đứng trước `ma_nt`, vì
 *     `Config/Fields/SOTran.xml` khai `arrangement="…t_ck_nt:%b(ma_nt);…"` — «đặt trước cột
 *     `ma_nt`». `arrangement` là phép sắp CHỖ NGỒI TRÊN LƯỚI, không phải thứ tự cột trong câu
 *     SQL; đem nó vào câu lệnh là xếp sai đúng bốn cột tiền.
 *   · `ma_ct` nằm GIỮA `dien_giai` và `status`, đúng chỗ nó được khai trong
 *     `Grid/Config/Include/Voucher.Field.Status`. `<view>` của group ấy chỉ liệt kê
 *     `dien_giai, status, u0` — `ma_ct` không có mặt, nên mọi cách xếp theo view đều đẩy nó ra
 *     cuối.
 *
 * Thứ tự cột trong câu SQL KHÔNG ảnh hưởng thứ tự cột trên màn hình: tầng vỏ ghép cột theo VỊ
 * TRÍ rồi khoá dòng dữ liệu theo tên, còn `renderGridHtml` tra ô theo `field@name` của cột nó
 * đang vẽ. Nên lưới vẫn hiện theo `<view>` + `arrangement` như trước.
 *
 * `columns` truyền vào chỉ còn là phần BỔ SUNG, xếp sau: một tên có trong view mà không có
 * `<field>` nào khai thì vẫn phải đi qua đây để được kể tên trong `skipped`, chứ không biến mất
 * im lặng.
 */
function wantedColumns(text, columns, fields) {
  const seen = new Set();
  const out = [];

  for (const f of fields ?? []) {
    if (seen.has(f.name)) continue;
    seen.add(f.name);
    out.push(f.name);
  }

  const view = columns
    ?? ((scanViews(text).find((v) => (v.columns ?? []).length > 0)?.columns ?? []).map((c) => c.name));
  for (const name of view) {
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/**
 * `defaultValue` → mẩu SQL cho cột này, hoặc `null` nếu không phải ca ấy.
 *
 * `defaultValue` trên field của LƯỚI là một mẩu SQL, không phải JavaScript. Đo trên `Grid/` của
 * FBISP24: 1731 lần khai, và mọi giá trị đều là SQL — `''`, `0`, `cast(0 as bit)`,
 * `rtrim(u0.statusname%l)`, `case when … end`. (Trên field của `Dir/`/`Filter/` thì NGƯỢC LẠI:
 * `defaultValue="new Date()"` là JavaScript chạy trên trình duyệt. Đó là lý do
 * `scriptParamFields` cố ý không đụng tới nó.)
 *
 * ĐIỀU KIỆN HẸP, và hẹp có lý do đo được:
 *
 *   NGUỒN CỦA LƯỚI quyết định `external="true"` có nghĩa gì — và đó là ranh giới thật, không
 *   phải `type`:
 *
 *     `Voucher` / `Detail`  đọc BẢNG master/chi tiết (`m64$000000`, `d31$000000`) cộng mấy
 *                           mệnh đề join viết rõ trong câu. Ở đó `external="true"` mà không
 *                           khai `aliasName` nghĩa là cột KHÔNG nằm trên hàng gốc, chấm hết —
 *                           `defaultValue` là nguồn duy nhất còn lại. Hai ca đo được:
 *                           `<field name="ten_dvt%l" external="true" defaultValue="''">` của
 *                           `Grid/SQDetail.f`, và `<field name="u0" external="true"
 *                           defaultValue="rtrim(u0.statusname%l)">` của group Initialize 001 —
 *                           cột `Trạng thái` trên MỌI lưới chứng từ dùng group ấy.
 *
 *     danh mục / báo cáo    đọc MỘT nguồn phẳng, mà nguồn ấy hay là một VIEW đã join sẵn:
 *                           `Grid/Customer.xml` của HOATP đọc `viewdmkh`, nơi `ten_nvbh` là
 *                           cột CÓ THẬT. Field vẫn khai `external="true" defaultValue="''"`
 *                           (nó nói với runtime rằng ô này không nhập tay được), nên ở đây
 *                           `external` KHÔNG nói được gì về việc cột có tồn tại hay không. Lấy
 *                           `''` là làm rỗng một cột đang có dữ liệu.
 *
 *   NGOẠI LỆ của nhánh phẳng: `defaultValue` là BIỂU THỨC (`rtrim(u1.u_name)` của group
 *   Initialize), không phải literal `''`/`0`. Cột ấy cần một join mà câu danh mục không có —
 *   trả về biểu thức để `buildCatalogSelect` BỎ cột (`skip_expression`), thay vì SELECT `u1`
 *   rồi chết cả câu.
 *
 *   `aliasName` PHẢI trống. 622 field khai CẢ HAI — `ten_vt%l` của `Grid/SQDetail.f` khai
 *   `aliasName="b" defaultValue="''"` — và ở đó `aliasName` mới là nguồn thật (`b.ten_vt`),
 *   `defaultValue` chỉ là giá trị dùng khi chưa join được. Ưu tiên `defaultValue` một cách vô
 *   điều kiện là làm rỗng cột `Tên vật tư` của gần như mọi lưới chi tiết.
 *
 *   `external="true"` PHẢI có. Đó là bản khai «cột này không nằm trên hàng gốc». Field KHÔNG
 *   external thì cột có thật trên bảng, và `defaultValue` của nó chỉ là giá trị mặc định lúc
 *   thêm dòng — `so_luong defaultValue="0"` của `Grid/BIAccountAssignmentGrid.f` mà lấy `0`
 *   thì cả cột số lượng về 0 trong khi bảng có số thật.
 *
 * Còn lại chính là ca cần sửa: `<field name="ten_dvt%l" external="true" defaultValue="''">` —
 * không alias, không bảng nào có cột `ten_dvt`, nên `rtrim(a.ten_dvt)` là "Invalid column name"
 * và nó giết CẢ câu lệnh, không chỉ một cột. 1069/1109 field khai `defaultValue` mà không khai
 * `aliasName` đều là ca này.
 */
function isLiteralDefault(raw) {
  const t = String(raw ?? '').trim();
  return t === '' || t === "''" || t === '0' || t === '1' || /^N?'[^']*'$/i.test(t);
}

function defaultSource(field, kind, vi) {
  const raw = String(field?.attrs?.defaultValue ?? '').trim();
  if (raw === '') return null;
  if (!isTrue(field?.attrs?.external)) return null;
  if (String(field?.attrs?.aliasName ?? '').trim() !== '') return null;

  // Bảng master/chi tiết + join viết rõ: `external` không alias = không có trên hàng gốc.
  if (kind === 'voucher' || kind === 'detail') return resolveLocaleIn(unescapeXml(raw), vi);

  // Nguồn phẳng: literal `''` → SELECT cột thật trên view; biểu thức → để nhánh kia bỏ cột.
  if (!isLiteralDefault(raw)) return resolveLocaleIn(unescapeXml(raw), vi);
  return null;
}

/**
 * `view/field` → mô tả cột đủ để ghép vào mọi nhánh.
 *
 * Mỗi cột mang BA cái tên, và lẫn chúng là hỏng ở chỗ khó thấy:
 *   `name`    tên KHAI trong file (`ten_kh%l`) — khoá của dòng dữ liệu, `renderGridHtml` tra
 *             theo đúng tên này.
 *   `column`  tên CỘT DATABASE sau khi phân giải hậu tố ngôn ngữ (`ten_kh` / `ten_kh2`).
 *   `alias`   alias bảng mà cột ấy thuộc về (`a`, `b`, `v0`…), từ `field@aliasName`.
 */
function pickColumns(text, { columns = null, fields = null, vi = true, kind = 'catalog' } = {}) {
  const scanned = fields ?? scanFields(text);
  const byName = new Map(scanned.map((f) => [f.name, f]));
  const picked = [];
  const skipped = [];

  for (const name of wantedColumns(text, columns, scanned)) {
    const field = byName.get(name);
    if (!field) {
      skipped.push(skip('sample.skip_no_field', { name }));
      continue;
    }

    // `%l` là hậu tố NGÔN NGỮ, không thuộc tên cột trên database — `ten_kh%l` là `ten_kh` ở bản
    // tiếng Việt và `ten_kh2` ở bản tiếng Anh. `@@language` quyết định đang xem bản nào.
    const { alias, expression, column } = readAliasName(field.attrs?.aliasName, 'a');
    const resolved = column === null ? resolveLocaleName(name, vi) : resolveLocaleName(column, vi);

    /*
     * Ba lối ra khỏi «cột là một định danh», và cả ba đi cùng một đường: giữ NGUYÊN VĂN. Với ba
     * nhánh chạy query của file thì đó là điều đúng — runtime cũng ghép nguyên vào. Nhánh danh
     * mục thì bỏ, vì nó dựng câu hoàn toàn từ định danh.
     *
     *   `defaultValue`                  cột KHÔNG nằm trên bảng nào cả — xem dưới
     *   `aliasName="case when … end"`   biểu thức không bóc được thành `alias.cot`
     *   `name="cast(0 as bit) as tag"`  chính TÊN FIELD là một mẩu SQL (`Grid/DataCopy.f`,
     *                                   qua entity `&Tag;` — hiếm, nhưng có thật)
     */
    const bare = BARE_IDENT.test(resolved);
    const verbatim = defaultSource(field, kind, vi)
      ?? (column === null && expression !== null ? unescapeXml(expression) : (bare ? null : resolved));

    picked.push({
      name,
      column: resolved,
      alias: alias ?? 'a',
      raw: verbatim === null ? null : nameExpression(verbatim, resolved),
      external: isTrue(field.attrs?.external),
      textual: isTextual(field),
      hidden: isTrue(field.attrs?.hidden),
      label: name,
    });
  }

  return { picked, skipped };
}

/**
 * Một mục trong danh sách `select`.
 *
 * `rtrim()` chỉ bọc cột CHỮ, và bọc là việc đáng làm chứ không phải trang trí: cột `char(16)`
 * trả về đủ 16 ký tự đệm khoảng trắng, và thống kê «cột này dài nhất bao nhiêu ký tự» — thứ cả
 * tính năng sinh ra để trả lời — sẽ đọc ra 16 cho mọi mã.
 *
 * ═══ CỘT CHỮ ĐI DẠNG HEX, VÀ ĐI QUA `nvarchar` TRƯỚC ═══
 *
 * `sqlcmd` ghi stdout theo CODE PAGE CONSOLE, và phép đổi ấy dùng «best-fit» của Windows: chữ
 * nào có chữ cái gốc thì rụng dấu, chữ nào không thì thành `?`. Đó đúng là hình dạng người dùng
 * báo — `CÔNG TY … THƯƠNG MẠI` ra `CONG TY … THUONG M?I`, mất dấu chứ không phải mất hết. Hex
 * chỉ gồm `0-9A-F` nên đi qua bất kỳ code page nào cũng nguyên vẹn.
 *
 * Bọc thêm một lớp `convert(nvarchar(4000), …)` ở TRONG CÙNG, và đó không phải thừa: không có
 * nó thì dãy byte trả về phụ thuộc KIỂU CỘT — `nvarchar` ra UTF-16LE, `varchar` ra code page của
 * collation — và tầng vỏ phải ĐOÁN mình đang cầm cái nào. Bản trước đoán bằng cách đếm byte lẻ
 * bằng 0; một tên toàn tiếng Việt (`Ạ` = A0 1E) có ít byte 0 hơn hẳn tên tiếng Anh, nên phép
 * đoán ấy lật đúng vào chuỗi khó nhất. Ép về `nvarchar` là hex LUÔN LUÔN UTF-16LE, và tầng vỏ
 * hết phải đoán.
 *
 * ═══ BẬT CHO VẾ CHIẾU CUỐI CÙNG, TẮT CHO `@@textList` ═══
 *
 * Đọc `FastBusiness$App$Voucher$Loading` (bản HOATP FBISP2421) mới thấy hai danh sách cột của
 * lưới chứng từ KHÔNG cùng vai:
 *
 *     insert into #t select <@@textList> from m64$<kỳ> where stt_rec in (select c from #r)
 *     select <@@textExternal> from #t a left join dmkh b on a.ma_kh = b.ma_kh …
 *
 * `@@textList` dựng BẢNG TẠM `#t`, rồi `#t` được đặt alias `a` và JOIN bằng chính giá trị của
 * nó. Bọc hex ở đó là hỏng hai lần cùng lúc:
 *
 *   · `a.ma_kh` thành chuỗi hex, nên `on a.ma_kh = b.ma_kh` không bao giờ khớp — mọi cột đến
 *     từ bảng join (`ten_kh`, `ten_nvbh`, `u0.statusname`) về NULL.
 *   · `@@textExternal` bọc hex LẦN NỮA lên giá trị đã là hex — mã hoá hai lớp.
 *
 * Nên: `@@textList` để TRẦN (nó là dữ liệu trung gian, không ai đọc), `@@textExternal` và
 * `@@fieldExternal` mới bọc hex — chúng là vế chiếu CUỐI CÙNG, thứ thật sự chảy ra `sqlcmd`.
 * Nhánh danh mục và báo cáo cũng là vế chiếu cuối cùng nên vẫn bọc.
 *
 * @param {boolean} qualify  có ghép `alias.` vào trước tên cột không
 * @param {{hexText?: boolean}} [opts]
 */
function selectItem(c, qualify, { hexText = false } = {}) {
  // Chỉ bọc hex cột CHỮ — tầng vỏ chỉ giải hex cho cột chữ. Bọc một cột số là nó hiện ra
  // đúng dãy hex, và hỏng ở chỗ không ai nghĩ tới.
  if (c.raw) return hexText && c.textual ? hexWrap(c.raw) : c.raw;
  const col = assertIdent(c.column, 'tên cột');
  const ref = qualify ? `${assertIdent(c.alias, 'alias cột')}.${col}` : col;
  if (!c.textual) return ref;
  const trimmed = `rtrim(${ref})`;
  if (!hexText) return `${trimmed} as ${col}`;
  return `${HEX_OPEN}${trimmed}${HEX_CLOSE} as ${col}`;
}

const HEX_OPEN = 'convert(varchar(8000), convert(varbinary(8000), convert(nvarchar(4000), ';
const HEX_CLOSE = ')), 2)';

/**
 * Bọc hex cho một mẩu SQL NGUYÊN VĂN (`c.raw`) — biểu thức tự mang tên qua `… as x`.
 *
 * Tách phần ` as <tên>` ra rồi mới bọc: bọc cả cụm là `convert(…, x as ten_kh)`, tức một câu
 * không biên dịch được. Không tách được tên thì trả nguyên — thà một cột hỏng tiếng Việt còn hơn
 * một câu lệnh không chạy.
 */
function hexWrap(raw) {
  const m = /^([\s\S]*?)\s+as\s+([A-Za-z_][\w$]*)\s*$/i.exec(String(raw));
  if (!m) return raw;
  return `${HEX_OPEN}${m[1]}${HEX_CLOSE} as ${m[2]}`;
}

/**
 * `order by` lấy từ `grid@order` — một danh sách cột, không phải một biểu thức tự do.
 *
 * Chặn bằng bảng chữ cái hẹp thay vì `assertIdent` từng mẩu: `order="a.ma_kh desc, ngay_ct"` là
 * hợp lệ và có thật, mà `assertIdent` thì không cho dấu chấm lẫn từ khoá `desc`.
 */
const ORDER_LIST = /^[A-Za-z_][\w$]*(\.[A-Za-z_][\w$]*)?(\s+(asc|desc))?(\s*,\s*[A-Za-z_][\w$]*(\.[A-Za-z_][\w$]*)?(\s+(asc|desc))?)*$/i;

function readOrder(root) {
  const raw = String(root.attrs?.order ?? '').trim();
  if (raw === '') return null;
  if (!ORDER_LIST.test(raw)) return null;
  return raw.replace(/\s+/g, ' ');
}

/* ═══════════════════════════════════════════════════════════════════════════════════════
 * THAY BIẾN @@…
 * ═══════════════════════════════════════════════════════════════════════════════════════ */

const RE_ESCAPE = /[.*+?^${}()|[\]\\]/g;

/**
 * Thay mọi `@@tên` bằng giá trị trong `values`, rồi thay `$partition$current|previous` bằng kỳ.
 *
 * Khớp theo KHOÁ DÀI NHẤT TRƯỚC, không theo `@@\w+`. Corpus có `@@prime000000` — sáu chỗ — mà
 * `@@\w+` đọc thành một biến tên `prime000000` không tồn tại; khớp `@@prime` rồi để `000000`
 * lại thì ra đúng tên bảng.
 *
 * Biến không có trong `values` giữ NGUYÊN VĂN và được kể tên trong `unknown`. Thay bằng chuỗi
 * rỗng là dựng ra một câu chạy được nhưng sai — im lặng đúng vào chỗ tệ nhất.
 *
 * `%l` cũng phân giải ở đây, vì hậu tố ngôn ngữ KHÔNG chỉ nằm trên `<field>`: câu Loading của
 * `Grid/CustomerParameterDetail.f` viết thẳng `isnull(a.val_view%l, b.val_view%l)` trong thân
 * câu. `like '%l…'` không bị đụng tới — phép thay đòi một định danh đứng NGAY TRƯỚC `%l`, mà
 * trong một chuỗi LIKE thì đứng trước là dấu nháy.
 */
export function substituteParams(sql, values, { period = null, vi = null } = {}) {
  const keys = Object.keys(values).sort((a, b) => b.length - a.length);
  const unknown = new Set();

  const pattern = keys.length === 0
    ? /@@\$?\w+/g
    : new RegExp(`${keys.map((k) => k.replace(RE_ESCAPE, '\\$&')).join('|')}|@@\\$?\\w+`, 'g');

  let out = String(sql ?? '').replace(pattern, (token) => {
    if (Object.prototype.hasOwnProperty.call(values, token)) return String(values[token]);
    unknown.add(token);
    return token;
  });

  if (period !== null) out = out.replace(/\$partition\$(current|previous)/gi, period);
  if (vi !== null) out = resolveLocaleIn(out, vi);

  return { text: out, unknown: [...unknown] };
}

/** `'abc'` — nháy đơn cho một mẩu SQL. Nhân đôi nháy bên trong, không escape kiểu C. */
function quote(value) {
  return `'${String(value ?? '').replace(/'/g, "''")}'`;
}

/** Đầu mọi câu lệnh: không chặn ai đang làm việc thật, không in dòng đếm. */
const PREAMBLE = [
  'SET NOCOUNT ON;',
  'SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;',
];

const sentinel = () => `select ${quote(SAMPLE_SENTINEL)};`;

/* ═══════════════════════════════════════════════════════════════════════════════════════
 * QUERY CỦA FILE
 * ═══════════════════════════════════════════════════════════════════════════════════════ */

/** Bóc `<![CDATA[…]]>` ra khỏi một khối văn bản SQL, giữ nguyên phần còn lại. */
function stripCdata(text) {
  return String(text ?? '').replace(/<!\[CDATA\[/g, '').replace(/\]\]>/g, '');
}

/**
 * `<query event="…">` (hoặc `<command event="…">`) cấp lưới → văn bản SQL.
 *
 * Thẻ có thể bọc thêm một lớp `<text>` — `Grid/SVTran.xml` bọc, `Grid/APDetail.xml` cũng bọc,
 * còn fixture thì hay viết trần. Nhận cả hai, và bóc CDATA ở cả hai.
 *
 * @returns {{ok: true, sql: string} | {ok: false, code: string}}
 */
export function readControllerQuery(text, tag, event) {
  const re = new RegExp(`<${tag}\\s+event="${event}"\\s*>([\\s\\S]*?)</${tag}>`, 'i');
  const m = re.exec(String(text ?? ''));
  if (!m) return { ok: false, code: 'sample.no_query' };
  if (/<Encrypted>/i.test(m[1])) return { ok: false, code: 'sample.query_encrypted' };

  const inner = /<text\s*>([\s\S]*?)<\/text>/i.exec(m[1]);
  const sql = stripCdata(inner ? inner[1] : m[1]).trim();
  if (sql === '') return { ok: false, code: 'sample.no_query' };
  return { ok: true, sql };
}

/**
 * Áp bản khai VÁ CHUỖI của `Grid/Config` lên câu query của controller.
 *
 * Đây là cách FBO thêm join vào một câu query mà KHÔNG sửa file controller, và bỏ qua nó là câu
 * mẫu tham chiếu một alias không hề được join. `Grid/SOTran.xml` của HOATP là ca đủ cả hai mảnh:
 * cấu hình thêm cột `ten_nvbh%l aliasName="v0"` và cột `u0`, rồi vá câu Loading để `v0` và `u0`
 * thật sự có mặt trong mệnh đề join truyền cho `FastBusiness$App$Voucher$Loading`.
 *
 * Thay MỌI lần xuất hiện, và thay bằng `split`/`join` chứ không bằng `RegExp`: `source` là một
 * mẩu SQL thường (`a left join dmkh b on a.ma_kh = b.ma_kh`, `', @@textOrderBy`), đầy ký tự có
 * nghĩa trong biểu thức chính quy. Dựng regex từ nó là để dấu `(` của một câu `case when` đổi
 * hẳn ý nghĩa phép tìm.
 *
 * Áp TRƯỚC khi thay `@@…`, vì bản khai neo vào chính tên biến — `source="', @@textOrderBy"` chỉ
 * còn tìm thấy khi `@@textOrderBy` vẫn nguyên văn.
 */
function applyQueryRewrites(sql, rewrites, notes) {
  let out = String(sql ?? '');
  let hit = 0;
  for (const r of rewrites ?? []) {
    const source = String(r?.source ?? '');
    if (source === '' || !out.includes(source)) continue;
    out = out.split(source).join(String(r?.destination ?? ''));
    hit += 1;
  }
  if (hit > 0) notes.push(msg('sample.note_config_query', { count: hit }));
  return out;
}

/**
 * Tham số `@x` một script cần người dùng cấp — tức những cái nó DÙNG mà không tự khai.
 *
 * `@@x` không tính (đó là biến của engine, thay bằng `substituteParams`). Biến do chính script
 * `declare` cũng không tính — khai lại là lỗi biên dịch, và đó là ca có thật: câu Processing của
 * `rptStockBalance` mở đầu bằng `declare @c varchar(1024)`.
 *
 * @returns {string[]} tên không kèm `@`, theo thứ tự xuất hiện lần đầu
 */
export function scanScriptParams(sql) {
  const text = String(sql ?? '');
  const declared = new Set();
  for (const d of text.matchAll(/\bdeclare\b([^\n\r]*)/gi)) {
    for (const v of d[1].matchAll(/@(\w+)/g)) declared.add(v[1].toLowerCase());
  }
  const seen = new Set();
  const out = [];
  for (const m of text.matchAll(/(?<!@)@(\w+)/g)) {
    const name = m[1];
    const key = name.toLowerCase();
    if (declared.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/**
 * Khai `declare @x` cho mọi tham số script cần mà người dùng đã cấp — hoặc nói ra còn thiếu gì.
 *
 * Dùng chung cho cả ba nhánh chạy query của file, không riêng báo cáo. 6 lưới chi tiết của
 * FBISP24 cũng hỏi tham số (`@ma_vt` của `Grid/BIItemParameterDetail.f` — khoá của hàng cha mà
 * runtime bơm vào), và bỏ qua chúng là dựng ra một câu chắc chắn chết ở "Must declare the scalar
 * variable".
 *
 * @returns {{ok: true, needed: string[], declares: string[]}
 *          | {ok: false, needed: string[], missing: string[]}}
 */
function paramPrelude(sql, params) {
  const needed = scanScriptParams(sql);
  const missing = needed.filter((n) => !Object.prototype.hasOwnProperty.call(params, n));
  if (missing.length > 0) return { ok: false, needed, missing };
  return {
    ok: true,
    needed,
    declares: needed.map((name) => {
      const p = params[name];
      return `declare @${assertIdent(name, 'tên tham số')} ${p.type};\nset @${name} = ${p.literal};`;
    }),
  };
}

/* ═══════════════════════════════════════════════════════════════════════════════════════
 * BỐN NHÁNH
 * ═══════════════════════════════════════════════════════════════════════════════════════ */

/**
 * DANH MỤC — không có query nào, dữ liệu là chính `grid@table`.
 *
 * Đây là nhánh duy nhất còn giữ luật cũ trọn vẹn: mọi mẩu ghép vào câu lệnh đều là ĐỊNH DANH đã
 * qua `assertIdent`. Không cần nới, vì một danh mục đọc từ MỘT bảng (hoặc một view đã join sẵn
 * — `viewdmkh` chứ không phải `dmkh`, và đó là lý do lấy nguyên `grid@table` chứ không suy).
 */
function buildCatalogSelect(root, picked, { top, notes, skipped }) {
  const table = String(root.attrs?.table ?? '').trim();
  if (table === '') return { ok: false, code: 'sample.no_table', params: {} };
  if (isPartitionPrefix(table)) {
    return { ok: false, code: 'sample.partition_no_period', params: { table } };
  }

  /*
   * MỘT bảng, nên cột trỏ đi chỗ khác thì BỎ, không đoán.
   *
   * 18/555 lưới danh mục của FBISP24 có `aliasName` trên field, và chúng nói một trong hai
   * điều: cột lấy từ alias khác (`b`), hoặc cột là một biểu thức. Cả hai đều tham chiếu một
   * alias không tồn tại trong câu `from <bảng>` ta dựng — ghép vào là "The multi-part
   * identifier could not be bound", giết cả câu vì một cột.
   */
  const usable = [];
  for (const c of picked) {
    if (c.raw) { skipped.push(skip('sample.skip_expression', { name: c.name, alias: c.raw })); continue; }
    if (c.alias !== 'a') { skipped.push(skip('sample.skip_foreign_alias', { name: c.name, alias: c.alias })); continue; }
    usable.push(c);
  }
  if (usable.length === 0) return { ok: false, code: 'sample.no_columns', params: { skipped: skipped.length } };

  const t = assertIdent(table, 'tên bảng');
  const list = usable.map((c) => selectItem(c, false, { hexText: true })).join(', ');
  const order = readOrder(root);
  if (String(root.attrs?.order ?? '').trim() !== '' && order === null) {
    notes.push(msg('sample.note_order_dropped', { order: String(root.attrs.order).trim() }));
  }

  return {
    ok: true,
    table: t,
    columns: usable,
    textAsHex: true,
    sql: [
      ...PREAMBLE,
      sentinel(),
      `select top ${top} ${list}`,
      `from ${t}`,
      ...(order ? [`order by ${order}`] : []),
      ';',
    ].join('\n'),
  };
}

/**
 * CHỨNG TỪ — chạy lại lời gọi `FastBusiness$App$Voucher$Loading` của chính file.
 *
 * Hai danh sách cột, và chúng KHÁC nhau ở đúng một điều: `@@textList` là cột của bảng gốc, còn
 * `@@textExternal` thêm cột `external="true"` (cột đến từ bảng join) và ghép `alias.` vào trước
 * mọi cột. Đọc ra được từ `Grid/SVTran.xml`: `ten_kh%l` khai `external="true" aliasName="b"`, và
 * trong câu runtime nó chỉ có mặt ở vế ngoài.
 *
 * Ghép `alias.` vào MỌI cột chứ không chỉ cột nhập nhằng: runtime chỉ ghép khi tên cột có ở cả
 * hai bảng (`rtrim(a.ma_kh)` nhưng `rtrim(stt_rec)`), mà biết được điều đó thì phải có lược đồ.
 * Ghép hết luôn đúng, chỉ dài hơn.
 */
function buildVoucherSelect(text, root, picked, { top, values, period, notes, vi, params, rewrites }) {
  const q = readControllerQuery(text, 'query', 'Loading');
  if (!q.ok) return { ok: false, code: q.code, params: { event: 'Loading' } };
  const patched = applyQueryRewrites(q.sql, rewrites, notes);

  const partition = scanPartition(text) ?? {};
  const inner = picked.filter((c) => !c.external);

  const derived = {
    '@@id': quote(String(root.attrs?.id ?? '').trim()),
    '@@table': quote(String(root.attrs?.table ?? '').trim()),
    '@@master': quote(String(partition.table ?? root.attrs?.table ?? '').trim()),
    '@@prime': quote(String(partition.prime ?? '').trim()),
    '@@inquiry': quote(String(partition.inquiry ?? '').trim()),
    '@@partition': quote(String(partition.field ?? '').trim()),
    '@@expression': quote(String(partition.expression ?? '').trim()),
    '@@extension': quote(String(partition.default ?? '').trim()),
    '@@increase': quote(String(partition.increase ?? '').trim()),
    '@@pageCount': String(top),
    /*
     * TRẦN, không hex: danh sách này dựng bảng tạm `#t` và `#t` được JOIN bằng chính giá trị
     * của nó (`on a.ma_kh = b.ma_kh`). Xem `selectItem`.
     */
    '@@textList': quote(inner.map((c) => selectItem(c, false)).join(',')),
    '@@textExternal': quote(picked.map((c) => selectItem(c, true, { hexText: true })).join(',')),
    '@@textOrderBy': quote(readOrder(root) ?? String(root.attrs?.code ?? '').trim()),
  };

  const { text: sql, unknown } = substituteParams(patched, { ...derived, ...values }, { period, vi });
  if (unknown.length > 0) return { ok: false, code: 'sample.unknown_params', params: { names: unknown.join(', ') } };

  const prelude = paramPrelude(sql, params);
  if (!prelude.ok) {
    return { ok: false, code: 'sample.need_params', params: { names: prelude.missing.join(', ') }, needsParams: prelude.needed };
  }

  notes.push(msg('sample.note_runs_file_query'));
  return {
    ok: true,
    table: String(partition.table ?? root.attrs?.table ?? '').trim(),
    textAsHex: true,
    sql: [...PREAMBLE, ...prelude.declares, sentinel(), sql, ';'].join('\n'),
  };
}

/* ═══════════════════════════════════════════════════════════════════════════════════════
 * BƯỚC 1 — CÂU DÒ CỦA LƯỚI CHI TIẾT
 * ═══════════════════════════════════════════════════════════════════════════════════════ */

/**
 * `partition@expression` → biểu thức đổi NGÀY thành hậu tố kỳ, đã cắm tên cột ngày vào.
 *
 * `expression="convert(char(6), {0}, 112)"` — `{0}` là chỗ giữ cho `partition@field`. Không khai
 * thì lấy chính biểu thức ấy làm mặc định: nó là bản của gần như mọi controller có chia kỳ, và
 * `112` (`yyyymmdd`) cắt 6 ký tự đầu ra đúng `yyyymm`.
 *
 * @returns {string|null} `null` = không dựng được (thiếu `field`, hoặc `expression` không có `{0}`)
 */
function partitionExpression(partition) {
  const field = String(partition?.field ?? '').trim();
  if (!BARE_IDENT.test(field)) return null;
  const raw = unescapeXml(String(partition?.expression ?? '').trim());
  if (raw === '') return `convert(char(6), ${field}, 112)`;
  if (!raw.includes('{0}')) return null;
  return raw.split('{0}').join(field);
}

/**
 * BƯỚC 1: câu DÒ của lưới chi tiết — hỏi database xem lấy dữ liệu của CHỨNG TỪ NÀO.
 *
 * Lưới `Detail` không tự đứng được: runtime bơm vào nó HAI thứ mà màn hình cha đang giữ — khoá
 * chính của chứng từ đang mở (`@@whereClause`) và kỳ của chứng từ ấy (`$partition$current`).
 * Không có màn hình cha thì phải ĐI HỎI, và hỏi thì phải hỏi TRƯỚC — hai giá trị này quyết định
 * câu bước 2 đọc bảng nào, nên không có cách nào nhét chúng vào cùng một câu.
 *
 * Luật (xác nhận của người dùng 2026-09-08) — hai hình dạng, theo có hay không có `<partition>`:
 *
 *     select top 1 convert(char(6), ngay_ct, 112) as partition, stt_rec
 *     from c64$000000 where status not in ('*', 'L')      ← có <partition>: bảng là `partition@table`
 *
 *     select top 1 ma_kh from dmkh             ← không <partition>: bảng là `grid@table`
 *
 * `status not in ('*', 'L')` CHỈ có ở nhánh trên, và đó không phải chi tiết trang trí: `partition@table` là
 * bảng CHỨNG TỪ, nơi `status` chắc chắn có (một trong năm cột mọi bảng chứng từ đều có — xem
 * `VOUCHER_INQUIRY_COLUMNS` của `filter-declare.mjs`) và nơi `'*'`/`'L'` nghĩa là không dùng được (đã xoá / đang khoá). Nhánh dưới
 * đọc một bảng danh mục (`dmkh`) — hỏi `status` ở đó là "Invalid column name", tức giết cả câu.
 *
 * KẾT QUẢ ĐI ĐÂU: tầng vỏ chạy câu này rồi truyền `{period, key}` vào `buildSampleSelect` qua
 * tuỳ chọn `probe`. Không chạy được, hay chạy mà bảng rỗng, thì bước 2 quay về hành vi cũ:
 * `@@whereClause` = `1 = 1` và kỳ = tháng hiện tại. Kém hơn, nhưng không hỏng.
 *
 * @returns {{ok: true, kind, sql, columns, table, keyColumn, hasPeriod}
 *          | {ok: false, kind, code, reason}}
 */
export function buildSampleProbe(text, { now = new Date() } = {}) {
  const root = scanRoot(text);
  const kind = sampleKindOf(root.attrs?.type);
  const fail = (code, p = {}) => ({ ok: false, kind, code, reason: msg(code, p) });

  if (kind !== 'detail') return fail('sample.probe_not_detail', { kind: kind === 'unsupported' ? String(root.attrs?.type ?? '').trim() : kind });

  const column = String(root.attrs?.code ?? '').trim();
  if (!BARE_IDENT.test(column)) return fail('sample.probe_no_key', { reason: `grid@code = "${column}"` });

  const partition = scanPartition(text);
  const raw = String(partition?.table ?? '').trim() || String(root.attrs?.table ?? '').trim();
  // Tiền tố chia kỳ trần (`c64$`) chưa phải một bảng. Ở ĐÂY không còn gì để dò ra kỳ — chính câu
  // này mới đang đi tìm kỳ — nên cắm tháng hiện tại vào, đúng như bản trước vẫn làm.
  const table = isPartitionPrefix(raw) ? `${raw}${partitionPeriod(now)}` : raw;
  if (!BARE_IDENT.test(table)) return fail('sample.probe_no_key', { reason: `bảng nguồn = "${table}"` });

  const periodExpr = partition ? partitionExpression(partition) : null;
  const items = [...(periodExpr ? [`${periodExpr} as partition`] : []), column];

  return {
    ok: true,
    kind,
    table,
    keyColumn: column,
    hasPeriod: periodExpr !== null,
    // Thứ tự CỐ ĐỊNH: tầng vỏ ghép cột theo VỊ TRÍ, không theo tên.
    columns: [
      ...(periodExpr ? [{ label: 'period', textual: false }] : []),
      { label: 'key', textual: false },
    ],
    sql: [
      ...PREAMBLE,
      sentinel(),
      `select top 1 ${items.join(', ')} from ${table}${partition ? " where status not in ('*', 'L')" : ''};`,
    ].join('\n'),
  };
}

/** Kỳ đọc từ câu dò đi thẳng vào TÊN BẢNG (`d64$` + kỳ) — chặn bằng bảng chữ cái, không tin. */
const PROBE_PERIOD = /^\w{1,20}$/;

/**
 * BƯỚC 2: khoá đã dò được → mẩu SQL thay cho `@@whereClause`.
 *
 * Ghép `a.` bằng CÙNG alias gốc mà `@@fieldExternal` đã dùng (`pickColumns` lấy `'a'` làm mặc
 * định). Nếu `a` sai thì danh sách cột đã sai từ trước, chứ không phải mệnh đề này mới làm sai.
 *
 * Không có khoá thì `1 = 1` — hành vi cũ — và nói ra ở `notes`. Đổi `where` chứ không bỏ nó: câu
 * của file viết sẵn chữ `where`, bỏ giá trị đi là ra `where order by`.
 */
function detailKeyClause(root, probeKey, { notes }) {
  const column = String(root.attrs?.code ?? '').trim();
  const key = probeKey === null || probeKey === undefined ? '' : String(probeKey).trim();
  if (key === '' || !BARE_IDENT.test(column)) {
    notes.push(msg('sample.note_detail_no_key'));
    return '1 = 1';
  }
  notes.push(msg('sample.note_detail_key', { column, key }));
  return `a.${column} = ${quote(key)}`;
}

/**
 * LƯỚI CHI TIẾT — `select @@fieldExternal from @@prime$partition$current a left join … where
 * @@whereClause order by @@orderByClause`.
 *
 * `@@whereClause` runtime là «chỉ dòng của chứng từ đang mở», và `$partition$current` là kỳ của
 * chính chứng từ ấy. Ở đây không có chứng từ nào đang mở, nên cả HAI đến từ câu dò bước 1
 * (`buildSampleProbe`) mà tầng vỏ đã chạy xong và truyền vào qua `probe` — xem `buildSampleProbe`
 * về vì sao không gộp được vào một câu.
 *
 * ═══ KHÔNG CHẶN SỐ DÒNG Ở SQL — CHẶN LÚC HIỆN LÊN MÀN HÌNH ═══
 *
 * Bản đầu chèn `top N` vào chữ `select` ĐẦU TIÊN, đọc từ 14 file `Detail` văn bản thường mà lúc
 * ấy nhìn thấy. Bung entity ra thì con số thật là 92, và 42 trong số đó KHÔNG phải một câu
 * `select` trần: chúng là script nhiều câu có `declare`, `if … else`, bảng tạm, tới 43 chữ
 * `select` (`Grid/BillDetail.f`). Chèn vào chữ đầu tiên ở đó là chèn vào
 * `select @whereKey = '…'` — một phép gán, không phải câu trả dữ liệu — nên câu thật vẫn kéo về
 * cả bảng. Không có luật regex nào chọn đúng «câu select trả dữ liệu» trong một script như thế,
 * và một bộ phân tích SQL đầy đủ thì vượt xa giá trị của việc.
 *
 * Bản kế `SET ROWCOUNT N` — chặn MỌI bộ kết quả của cả batch mà không đụng một ký tự nào vào SQL
 * của file. Cái giá (xác nhận của người dùng 2026-09-08, sau khi thấy hỏng ở lưới báo cáo): nó
 * cũng chặn các câu `insert into #tmp` Ở GIỮA script — một script tự dựng bảng tạm rồi tổng hợp
 * sẽ ra con số của N dòng đầu của BẢNG TẠM, không phải N dòng đầu của kết quả cuối, và với script
 * càng phức tạp thì càng dễ ra một con số không liên quan gì tới thứ người dùng đang xem.
 *
 * Nay câu lệnh chạy KHÔNG giới hạn số dòng — an toàn hơn, vì không đụng gì vào cách một script
 * nhiều câu tự vận hành — và TẦNG VỎ cắt còn đúng số dòng cấu hình (`fboDesigner.sampleRowCount`,
 * mặc định `SAMPLE_TOP_DEFAULT`) trước khi đưa vào lưới. Đánh đổi: câu lệnh có thể kéo về NHIỀU
 * hơn số dòng cần hiện — chấp nhận được cho một phép xem trước, không chấp nhận được nếu bảng
 * chi tiết có hàng triệu dòng (khi đó `sqlcmd` tự chạm hạn giờ, và người dùng thấy lỗi timeout
 * thay vì dữ liệu — đọc được hơn một con số sai lặng lẽ).
 */
function buildDetailSelect(text, root, picked, { top, values, period, notes, vi, params, rewrites, probeKey }) {
  const q = readControllerQuery(text, 'query', 'Loading');
  if (!q.ok) return { ok: false, code: q.code, params: { event: 'Loading' } };
  const patched = applyQueryRewrites(q.sql, rewrites, notes);

  const partition = scanPartition(text) ?? {};
  const derived = {
    '@@id': quote(String(root.attrs?.id ?? '').trim()),
    '@@table': String(root.attrs?.table ?? '').trim(),
    '@@master': String(partition.table ?? '').trim(),
    '@@prime': String(partition.prime ?? root.attrs?.table ?? '').trim(),
    '@@inquiry': String(partition.inquiry ?? '').trim(),
    '@@fieldExternal': picked.map((c) => selectItem(c, true, { hexText: true })).join(', '),
    '@@whereClause': detailKeyClause(root, probeKey, { notes }),
    '@@orderByClause': readOrder(root) ?? String(root.attrs?.code ?? 'stt_rec').trim(),
  };

  const { text: substituted, unknown } = substituteParams(patched, { ...derived, ...values }, { period, vi });
  if (unknown.length > 0) return { ok: false, code: 'sample.unknown_params', params: { names: unknown.join(', ') } };

  const prelude = paramPrelude(substituted, params);
  if (!prelude.ok) {
    return { ok: false, code: 'sample.need_params', params: { names: prelude.missing.join(', ') }, needsParams: prelude.needed };
  }

  notes.push(msg('sample.note_runs_file_query'));
  notes.push(msg('sample.note_render_cap', { top }));
  return {
    ok: true,
    table: derived['@@prime'],
    textAsHex: true,
    sql: [
      ...PREAMBLE,
      ...prelude.declares,
      sentinel(),
      substituted,
      ';',
    ].join('\n'),
  };
}

/** Vị trí chữ `select`/`exec`/`execute` — ranh giới GIỮA hai câu, dùng để tách thân script. */
const RE_STMT_KEYWORD = /\b(select|exec(?:ute)?)\b/gi;

/**
 * Tách thân câu Processing thành CÂU riêng — ranh giới là mỗi lần gặp lại `select`/`exec`.
 *
 * Không có dấu `;` đáng tin cậy để tách (ví dụ đầu file này không hề có: `select … as …\nexec
 * …` — hai câu liền nhau, cách nhau đúng một dòng trắng). Bù lại, MỌI câu ở đây bắt đầu bằng
 * đúng hai chữ: `select` (dò/gán biến, hay đổ ra một bảng) hoặc `exec`/`execute` (gọi proc báo
 * cáo). Quét vị trí hai chữ ấy, và văn bản GIỮA hai lần quét liên tiếp là MỘT câu trọn vẹn.
 *
 * Sai lệch có thật (một `case when (select …)` lồng bên trong cột của một `select` khác sẽ bị
 * tách nhầm thành câu riêng) — chấp nhận được, vì corpus báo cáo của FBISP24 không viết kiểu đó
 * ở đây; `RE_EXEC`/`EXEC_RE` của bản trước cũng chịu cùng rủi ro với TỪ đầu tiên.
 */
function splitReportStatements(body) {
  const hits = [];
  RE_STMT_KEYWORD.lastIndex = 0;
  let m;
  while ((m = RE_STMT_KEYWORD.exec(body)) !== null) {
    hits.push({ index: m.index, kw: m[1].toLowerCase().startsWith('exec') ? 'exec' : 'select' });
  }
  return hits.map((h, i) => ({
    kw: h.kw,
    start: h.index,
    end: i + 1 < hits.length ? hits[i + 1].index : body.length,
  }));
}

/** `select @x = …` KHÔNG sinh resultset — nó gán biến, không đổ dòng nào ra ngoài. */
function isAssignmentOnlySelect(text) {
  return /^select\s+@\w+\s*=/i.test(text.trim()) && !/\bfrom\b/i.test(text);
}

/**
 * Câu nào trong thân Processing THẬT SỰ sinh ra một bảng kết quả (một "dataset") — bỏ những câu
 * chỉ gán biến (`select @c = case …`). Đây chính là danh sách mà `dir@id` của Filter đánh số:
 * `dataset[0]`, `dataset[1]`, … theo ĐÚNG thứ tự chúng chạy.
 */
function reportResultsets(body) {
  return splitReportStatements(body)
    .filter((s) => s.kw === 'exec' || !isAssignmentOnlySelect(body.slice(s.start, s.end)));
}

/**
 * BÁO CÁO — chạy `<command event="Processing">` của FILE FILTER, rồi đọc ĐÚNG bảng runtime lấy.
 *
 * Hai hình dạng khác hẳn nhau, tuỳ proc báo cáo NHẬN hay KHÔNG NHẬN một bảng đích:
 *
 *   1. CÓ `'#$query'` — runtime truyền tên bảng cho proc, proc dựng `select … into <tên>` bằng
 *      SQL động và đổ dữ liệu vào đó. Ta thay `'#$query'` bằng một bảng tạm TOÀN CỤC (`##`),
 *      không phải cục bộ (`#`): bảng `#` tạo trong một `exec()` chết ngay khi `exec()` ấy kết
 *      thúc, còn `##` sống hết phiên kết nối. Đọc dữ liệu bằng một `select` RIÊNG sau khi proc
 *      chạy xong — xem `buildQueryTableSelect`.
 *   2. KHÔNG `'#$query'` — script tự in ra NHIỀU bảng (dữ liệu ADO.NET nhận về là một
 *      `DataSet` nhiều `DataTable`), và Filter nói RÕ lấy bảng nào bằng `dir@id`: chạy
 *      `zcrptPurchaseDiscount.xml` (HOATP/FBISP2421) sinh đúng hai bảng — `select @tu_ngay as
 *      tu_ngay, @den_ngay as den_ngay` là `dataset[0]`, kết quả của `exec
 *      zc_rptPurchaseDiscount …` là `dataset[1]` — và `Filter/zcrptPurchaseDiscount.xml` khai
 *      `<dir id="1">`, tức lấy `dataset[1]`. Xem `buildResultsetSelect`.
 *
 * Tham số `@x` KHÔNG đoán ở cả hai nhánh: chúng là điều kiện lọc của người dùng (từ ngày, đến
 * ngày, kho nào), và đoán một khoảng ngày là chạy một báo cáo trên khoảng dữ liệu không ai yêu
 * cầu. Tầng vỏ hỏi, hàm này chỉ khai `declare` cho đúng thứ đã hỏi.
 */
function buildReportSelect(filterText, picked, { top, values, params, notes, vi }) {
  if (!filterText) return { ok: false, code: 'sample.no_filter_file', params: {} };

  const q = readControllerQuery(filterText, 'command', 'Processing');
  if (!q.ok) {
    return {
      ok: false,
      code: q.code === 'sample.query_encrypted' ? 'sample.processing_encrypted' : 'sample.no_processing',
      params: {},
    };
  }

  const prelude = paramPrelude(q.sql, params);
  if (!prelude.ok) {
    return { ok: false, code: 'sample.need_params', params: { names: prelude.missing.join(', ') }, needsParams: prelude.needed };
  }

  const { text: body, unknown } = substituteParams(q.sql, values, { period: null, vi });
  if (unknown.length > 0) {
    return { ok: false, code: 'sample.unknown_params', params: { names: unknown.join(', ') } };
  }

  // `'#$query'` và `'#…$query'` đều xuất hiện; thay cả cụm nằm trong nháy để không đụng vào
  // bất kỳ chữ `#` nào khác của script.
  const withTable = body.replace(/'#[^']*\$query'/g, quote(REPORT_TABLE));
  if (withTable !== body) return buildQueryTableSelect(withTable, picked, { top, prelude, notes });

  if (reportResultsets(body).length === 0) {
    // Không '#$query', không một câu nào sinh resultset — không có luật nào đọc được kịch bản
    // này. Quay về nhánh bảng tạm cũ (nó sẽ rỗng, nhưng không NÉM), kèm ghi chú vì sao.
    notes.push(msg('sample.note_no_query_table'));
    return buildQueryTableSelect(body, picked, { top, prelude, notes });
  }

  return buildDirectResultsetSelect(filterText, body, picked, { top, prelude, notes });
}

/**
 * NHÁNH 1 — proc nhận `'#$query'`: đọc lại bằng một `select` riêng sau khi proc chạy xong.
 *
 * Cái giá của `##`: tên là hằng, nên hai người cùng chạy một lúc trên cùng server đụng nhau.
 * `drop` ở cả hai đầu làm nó tự lành sau một nhịp; với một công cụ xem trước thì đó là đánh đổi
 * đúng, và nói ra ở đây để không ai phải phát hiện lại.
 */
function buildQueryTableSelect(withTable, picked, { top, prelude, notes }) {
  const list = picked.map((c) => selectItem(c, false, { hexText: true })).join(', ');
  const drop = `if object_id('tempdb..${REPORT_TABLE}') is not null drop table ${REPORT_TABLE};`;

  notes.push(msg('sample.note_runs_report_proc'));
  return {
    ok: true,
    table: REPORT_TABLE,
    columns: picked,
    textAsHex: true,
    sql: [
      ...PREAMBLE,
      drop,
      ...prelude.declares,
      withTable,
      sentinel(),
      `select top ${top} ${list} from ${REPORT_TABLE};`,
      drop,
    ].join('\n'),
  };
}

/**
 * NHÁNH 2 — proc KHÔNG nhận bảng đích: chạy NGUYÊN VĂN script, KHÔNG SỬA MỘT KÝ TỰ NÀO — không
 * mốc, không bảng tạm, không dò schema trước.
 *
 * Ba lần đo trên `zc_rptPurchaseDiscount` của HOATP qua MCP (2026-09-08), ba bài học:
 *   1. Dò schema trước (`sys.dm_exec_describe_first_result_set`) rồi hex-hoá qua bảng tạm — SQL
 *      Server của khách là 2008 R2, không có hàm ấy, chết ngay từ bước dò.
 *   2. Cắm một mốc RIÊNG trước mỗi câu, cắt script để CHỈ chạy tới bảng đã chọn — sai với chính
 *      chuẩn tắc đã chốt ("chạy đủ script"), và mốc cho bảng CUỐI trở nên "vô dụng" nếu MỘT câu
 *      (một `exec`) tự sinh ra NHIỀU HƠN một bảng bên trong nó — ta không biết trước điều đó chỉ
 *      bằng cách đếm SỐ CÂU của script.
 *   3. `dir@id` là chỉ số vào DANH SÁCH BẢNG THẬT SỰ mà lần chạy này trả về — đúng cách ADO.NET
 *      đánh số `DataSet.Tables[N]` — CHỈ BIẾT ĐƯỢC SAU KHI CHẠY, không phải chỉ số vào số câu
 *      lệnh của TA đếm được trên văn bản. Nên: chạy đủ, không sửa gì, và ĐỂ TẦNG VỎ (JS) tự đếm
 *      có bao nhiêu bảng SAU KHI ĐÃ NHẬN VỀ, rồi mới chọn đúng bảng thứ `dir@id` — xem
 *      `sql-host.js: runSampleQueryDataset`/`splitResultsets`.
 *
 * KHÔNG hex-hoá: không cần nữa — `sqlcmd -i/-o <file> -f 65001` (xem `sql-host.js: runSqlcmd`)
 * đã ra đúng dấu tiếng Việt mà không cần bọc gì. KHỚP CỘT THEO TÊN (không theo vị trí): tầng vỏ
 * đọc dòng tiêu đề thật của bảng đã chọn — field nào lưới khai mà bảng không có cột trùng tên
 * thì BỎ, không đoán.
 */
function buildDirectResultsetSelect(filterText, body, picked, { top, prelude, notes }) {
  const datasetId = Number.parseInt(String(scanRoot(filterText).attrs?.id ?? '').trim(), 10);
  const label = /\bexec(?:ute)?\b\s+([\w.$#]+)/i.exec(body)?.[1] ?? 'báo cáo';

  notes.push(msg('sample.note_report_dataset', {
    id: Number.isInteger(datasetId) ? datasetId : 'không khai (mặc định bảng cuối)',
  }));
  notes.push(msg('sample.note_render_cap', { top }));

  return {
    ok: true,
    table: label,
    columns: picked,
    textAsHex: false,
    headerMapped: true,
    datasetIndex: Number.isInteger(datasetId) && datasetId >= 0 ? datasetId : null,
    sql: [...PREAMBLE, ...prelude.declares, body].join('\n'),
  };
}

/* ═══════════════════════════════════════════════════════════════════════════════════════
 * CỬA VÀO
 * ═══════════════════════════════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════════════════════════════
 * THAM SỐ SCRIPT
 * ═══════════════════════════════════════════════════════════════════════════════════════ */

/** Kiểu SQL để `declare` một tham số, suy từ `field@type` của Filter. */
function sqlTypeOf(field) {
  const t = String(field?.attrs?.type ?? '').trim().toLowerCase();
  const mapped = (SQL_CONFIG.typeByFbo ?? {})[t];
  if (mapped) return mapped;
  return t === 'integer' || t === 'int' ? 'int' : 'nvarchar(1024)';
}

/** Nhãn đọc được cho một tham số: `<header v e>` của field cùng tên, không có thì chính tên. */
function labelOf(field, vi) {
  const h = field?.header ?? {};
  const text = String((vi ? h.v : h.e) ?? '').trim();
  return text;
}

/**
 * Tham số `@x` của câu Processing → bản khai đủ để hỏi người dùng.
 *
 * Ghép với `<field>` của chính file Filter — đó là màn hình người dùng vẫn điền khi chạy báo
 * cáo thật, nên nhãn và giá trị mặc định ở đó là nhãn và giá trị mặc định đúng.
 *
 * `defaultValue` KHÔNG dùng làm giá trị: nó là JavaScript (`new Date()`, `getUnit()`) chạy trên
 * trình duyệt, không phải một hằng. `clientDefault` mới là hằng. Field kiểu ngày không có hằng
 * thì lấy hôm nay — một báo cáo tính tới ngày rỗng không trả về gì, và ai cũng phải sửa nó.
 *
 * @returns {Array<{name, label, sqlType, value}>} theo đúng thứ tự `names`
 */
export function scriptParamFields(filterText, names, { vi = true, now = new Date(), formats = {} } = {}) {
  const fields = filterText ? scanFields(filterText) : [];
  const byName = new Map();
  for (const f of fields) {
    byName.set(f.name.toLowerCase(), f);
    byName.set(resolveLocaleName(f.name, vi).toLowerCase(), f);
  }
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  return (names ?? []).map((name) => {
    const field = byName.get(String(name).toLowerCase()) ?? null;
    const sqlType = field ? sqlTypeOf(field) : 'nvarchar(1024)';
    const declared = String(field?.attrs?.clientDefault ?? '').trim();
    const value = declared !== '' ? declared : (/date|time/i.test(sqlType) ? today : '');
    /*
     * MẶT NẠ hiện trên hộp thoại — CHỈ cho cột ngày, và chỉ để tầng vỏ biết HIỆN theo định dạng
     * nào (`dd/MM/yyyy`…) thay vì chuỗi SQL trần (`2026-09-07`). `value` ở trên KHÔNG đổi —
     * nó vẫn là mẩu SQL/ISO gốc; định dạng hiển thị là việc riêng của tầng vỏ (`formatDate` /
     * `parseDisplayDate`), giữ đúng luật "thuần, không chạm đĩa" của file này.
     */
    const mask = field && isDateField(field)
      ? (resolveMask(field.attrs?.dataFormatString, formats) || 'dd/MM/yyyy')
      : '';
    return {
      name, label: field ? labelOf(field, vi) : '', sqlType, value, mask,
    };
  });
}

/**
 * Giá trị người dùng gõ → MẨU SQL đặt vào `set @x = …`.
 *
 * Quy đổi ở đây chứ không bắt người dùng tự gõ nháy: hộp thoại hỏi một GIÁ TRỊ, và một người
 * đang chọn kho không nên phải nhớ luật escape của SQL. Rỗng thành `null` cho ngày và số, thành
 * chuỗi rỗng cho chữ — đúng như một ô lọc bỏ trắng trên màn hình báo cáo thật.
 */
export function scriptParamLiteral(sqlType, value) {
  const t = String(sqlType ?? '').toLowerCase();
  const v = String(value ?? '').trim();
  if (/date|time/.test(t)) return v === '' ? 'null' : `'${v.replace(/'/g, "''")}'`;
  if (/int|numeric|decimal|money|float|real|bit/.test(t)) return v === '' || !/^-?\d+(\.\d+)?$/.test(v) ? '0' : v;
  return `N'${v.replace(/'/g, "''")}'`;
}


/**
 * Văn bản controller lưới → câu lệnh lấy `top` dòng đầu.
 *
 * @param {string} text  văn bản ĐÃ BUNG entity của file Grid
 * @param {object} opts
 *   `top`         số dòng, trần `SAMPLE_TOP_MAX`
 *   `columns`     tên cột theo ĐÚNG thứ tự muốn hiện; bỏ trống thì lấy view đầu tiên có cột
 *   `fields`      `scanFields` đã có sẵn, tránh quét lại
 *   `params`      đè lên `core/config/sample-params.json` — khoá `@@…`, giá trị là MẨU SQL
 *   `filterText`  văn bản ĐÃ BUNG của file `Filter/<Controller>` — bắt buộc cho lưới báo cáo
 *   `scriptParams` `{ tên: {type, literal} }` giá trị người dùng nhập cho tham số `@x`
 *   `rewrites`    `[{source, destination}]` bản khai vá chuỗi của `Grid/Config`, sự kiện
 *                 `Loading` — xem `applyQueryRewrites`
 *   `probe`       `{period, key}` đọc được từ câu dò BƯỚC 1 (`buildSampleProbe`) — chỉ lưới
 *                 `Detail` dùng; bỏ trống thì kỳ lấy tháng hiện tại và `@@whereClause` = `1 = 1`
 *   `now`         mốc tính kỳ `$partition$current` khi không có `probe`
 *
 * @returns {{ok: true, kind, sql, columns, skipped, notes, table, top}
 *          | {ok: false, kind, code, reason, skipped, notes, needsParams?}}
 */
export function buildSampleSelect(text, {
  top = SAMPLE_TOP_DEFAULT,
  columns = null,
  fields = null,
  params = {},
  filterText = null,
  scriptParams = {},
  rewrites = null,
  probe = null,
  now = new Date(),
} = {}) {
  const notes = [];
  const root = scanRoot(text);
  const kind = sampleKindOf(root.attrs?.type);

  const values = { ...SAMPLE_PARAMS, ...params };
  // `@@language` là công tắc `%l`: 1 = bản tiếng Việt (`ten_kh`), khác 1 = bản tiếng Anh
  // (`ten_kh2`). Một công tắc cho cả câu lệnh, cùng chỗ với mọi biến `@@…` khác — chứ không
  // phải một tuỳ chọn thứ hai để hai bên lệch nhau.
  const vi = String(values['@@language'] ?? '1').replace(/'/g, '').trim() !== '2';

  const n = Math.max(1, Math.min(Math.trunc(Number(top) || SAMPLE_TOP_DEFAULT), SAMPLE_TOP_MAX));

  const fail = (code, p = {}, extra = {}) => ({
    ok: false, kind, code, reason: msg(code, p), skipped: [], notes, ...extra,
  });

  if (kind === 'unsupported') {
    return fail('sample.unsupported_type', { type: String(root.attrs?.type ?? '').trim() });
  }

  const { picked, skipped } = pickColumns(text, { columns, fields, vi, kind });
  if (picked.length === 0) {
    return { ...fail('sample.no_columns', { skipped: skipped.length }), skipped };
  }

  /*
   * Cả khối nằm trong `try`: `assertIdent` NÉM khi gặp thứ không phải định danh, và đó là hành
   * vi đúng của nó — nhưng một lệnh của người dùng thì không được chết vì một tên cột lạ trong
   * file khách. Bắt lại, trả về một lời từ chối đọc được, giữ nguyên lý do.
   */
  let built;
  try {
    /*
     * Kỳ của câu dò THẮNG kỳ lịch, và đó là cả lý do có bước 1: `$partition$current` phải là kỳ
     * của CHỨNG TỪ đã chọn, không phải tháng người ta đang ngồi xem. Chọn chứng từ tháng trước
     * mà đọc bảng tháng này là đọc một bảng không có dòng nào của nó.
     *
     * Giá trị ấy đi thẳng vào TÊN BẢNG (`d64$` + kỳ), nên nó phải qua `PROBE_PERIOD` trước —
     * database trả về gì thì cũng là dữ liệu, không phải mẩu SQL được tin.
     */
    const probed = String(probe?.period ?? '').trim();
    const period = PROBE_PERIOD.test(probed) ? probed : partitionPeriod(now);
    if (kind === 'detail' && period !== partitionPeriod(now)) notes.push(msg('sample.note_detail_period', { period }));
    const shared = {
      top: n, values, notes, skipped, vi, params: scriptParams, rewrites, period,
      probeKey: probe?.key ?? null,
    };
    if (kind === 'catalog') built = buildCatalogSelect(root, picked, shared);
    else if (kind === 'voucher') built = buildVoucherSelect(text, root, picked, shared);
    else if (kind === 'detail') built = buildDetailSelect(text, root, picked, shared);
    else built = buildReportSelect(filterText, picked, shared);
  } catch (err) {
    return { ...fail('sample.bad_identifier', { reason: err.message }), skipped };
  }

  if (!built.ok) {
    return {
      ...fail(built.code, built.params ?? {}),
      skipped,
      ...(built.needsParams ? { needsParams: built.needsParams } : {}),
    };
  }

  return {
    ok: true,
    kind,
    sql: built.sql,
    // Nhánh danh mục có thể BỎ BỚT cột (alias lạ, biểu thức). Trả về danh sách THẬT SỰ có trong
    // câu `select`, vì tầng vỏ ghép cột-theo-vị-trí — thừa một nhãn là lệch hết từ đó về sau.
    columns: built.columns ?? picked,
    // Cột chữ đi dạng hex qua sqlcmd rồi tầng vỏ decode Windows-1258 — xem `selectItem`.
    textAsHex: built.textAsHex === true,
    // CHỈ báo cáo không `'#$query'`: script chạy NGUYÊN VĂN, không có `select` nào của ta bọc
    // quanh nên phải khớp cột theo TÊN THẬT của bảng đã chọn — xem
    // `buildDirectResultsetSelect`/`sql-host.js: runSampleQueryDataset`.
    headerMapped: built.headerMapped === true,
    // CHỈ khi `headerMapped` — `dir@id` (có thể `null` = không khai, mặc định bảng cuối). Số
    // bảng THẬT SỰ có chỉ biết được SAU KHI CHẠY, nên không có gì khác để truyền kèm ở đây.
    ...(built.headerMapped ? { datasetIndex: built.datasetIndex } : {}),
    skipped,
    notes,
    table: built.table,
    top: n,
  };
}
