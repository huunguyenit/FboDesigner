// lint.mjs — luật chẩn đoán về CHẤT LƯỢNG BẢN KHAI, tách khỏi luật về phép vẽ.
//
// Khác biệt đáng giữ: `render.mjs`/`grid.mjs` cảnh báo những gì chúng VẤP PHẢI trên đường dựng
// màn hình — token không tra ra field, pattern lệch số cột, list px hỏng. Chúng nói «tôi không
// vẽ được cái này». File này thì đi tìm: bản khai vẽ ra bình thường, nhưng có chỗ sai mà chỉ
// lộ ra lúc chạy thật, hoặc không lộ ra bao giờ.
//
// ═══ LUẬT CHUNG CỦA MỌI RULE Ở ĐÂY: KHÔNG BIẾT THÌ IM ═══
//
// Một luật chẩn đoán sai chỉ cần vài lần là người dùng thôi đọc cả bảng Problems, và khi ấy nó
// kéo theo cả những luật đúng xuống cùng. Nên mỗi rule dưới đây đều có một cửa thoát rõ ràng
// cho ca «không đủ thông tin để kết luận», và cửa ấy được đi thường xuyên hơn ta tưởng:
//
//   · không đọc được `<query event="Finding">` (thiếu, hoặc `<Encrypted>`) → không xét alias
//   · `aliasName` là biểu thức phức tạp không bóc được → không xét
//   · field khai ở file Include → không xét «khai chết» (controller KHÁC đang dùng nó)
//   · tên field xuất hiện ở chỗ nào khác trong tài liệu → không xét (có thể JS đang gọi)
//   · `view@height` hoặc `field@rows` không khai → không xét chiều cao
//
// Thà bỏ sót một lỗi thật còn hơn kêu oan một bản khai đúng.

import * as warn from './warn.mjs';
import { sourceRange } from './entities.mjs';
import { scanFindingJoin, readAliasName, isLocalTempTable } from './filter-declare.mjs';
import { VIEWS_CONFIG } from './msg.mjs';

/** Dải nguồn của một thuộc tính; `null` khi chưa bung entity (test gọi thẳng). */
function spanRange(segments, span) {
  return span && segments ? sourceRange(segments, span.start, span.end) : null;
}

/** Thoát ký tự đặc biệt của regex — tên field có thể chứa `%`, `$`, `.`. */
function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Tên này xuất hiện bao nhiêu lần trong tài liệu, tính theo BIÊN TỪ?
 *
 * Biên phải rộng hơn `\b` của regex: `\b` coi `%` và `$` là ranh giới, nên `ten_kh` sẽ khớp cả
 * bên trong `ten_kh%l` và ta đếm nhầm hai field khác nhau thành một. Chặn luôn dấu chấm để
 * `e1.so_ct` không bị đọc thành `so_ct`.
 */
function countOccurrences(text, name) {
  const re = new RegExp(`(?<![\\w%$.])${escapeRe(name)}(?![\\w%$.])`, 'g');
  let n = 0;
  while (re.exec(text) !== null) n++;
  return n;
}

/**
 * `<field>` khai mà không chỗ nào dùng — khai chết.
 *
 * Đây là luật DỄ KÊU OAN NHẤT trong cả file, nên nó có hai lớp chặn chồng lên nhau:
 *
 * 1. CHỈ xét field khai trong CHÍNH file controller đang mở. Một `Include` dùng chung khai năm
 *    chục field cho hai chục controller, mỗi controller dùng dăm cái — kêu phần còn lại là
 *    "khai chết" thì vừa sai (controller khác đang dùng) vừa đủ ồn để chôn vùi mọi luật khác.
 *    Không có `segments` thì tài liệu chỉ có một file, và khi ấy mọi field đều là của nó.
 *
 * 2. Tên field chỉ được xuất hiện ĐÚNG MỘT LẦN trong cả tài liệu — chính chỗ `name="…"` khai ra
 *    nó. Field có thể được dùng ở những chỗ bộ quét này không đọc: `<query>`, `arrangement`,
 *    một hàm JS trong `Include\Javascript`, một lookup. Xuất hiện lần thứ hai ở bất cứ đâu là
 *    đủ để im lặng — ta không chứng minh được nó chết.
 *
 * @param {{text, fields, used: Set<string>, segments, hostFile}} args
 *   `used` — tên field mà tầng trên đã BIẾT CHẮC là có dùng (token của hàng, cột của lưới, field
 *   neo vùng). Hai lớp chặn trên chỉ chạy cho những cái không nằm trong tập này.
 */
export function deadFieldWarnings({ text, fields, used, segments = null, hostFile = '' }) {
  const out = [];
  for (const f of fields) {
    if (used.has(f.name)) continue;

    const range = spanRange(segments, f.attrSpans?.name) ?? spanRange(segments, { start: f.start, end: f.start + 1 });
    // Lớp 1: field đến từ file khác thì không phải chuyện của controller này.
    if (segments && hostFile && range && range.file !== hostFile) continue;
    // Lớp 2: còn dấu vết ở đâu đó thì không kết luận.
    if (countOccurrences(text, f.name) !== 1) continue;

    out.push(warn.anchored('lint.field_unused', { name: f.name }, { range }));
  }
  return out;
}

/**
 * `aliasName` của cột lưới có tra ra một phép join thật không, và bảng nó trỏ tới có sống được
 * ngoài phiên tạo ra nó không.
 *
 * Đọc `aliasName` bằng CHÍNH `readAliasName` mà bản sinh SQL dùng, không tự tách lấy: thuộc
 * tính ấy mang hai nghĩa (alias trần, hoặc biểu thức SQL), và một bản đọc thứ hai chỉ chờ ngày
 * lệch khỏi bản thứ nhất.
 *
 * Duyệt trên `<fields>`, KHÔNG trên cột của `<view>`: `aliasName` khai ở thẻ `<field>` trong
 * khối `<fields>`, còn `<view>` chỉ liệt kê TÊN cột để xếp thứ tự. Đọc nhầm chỗ là luật này
 * không bao giờ tìm thấy gì trên file thật — im lặng và trông như đang chạy.
 *
 * Chỉ xét field ĐANG HIỆN thành cột (`shown`). Một `aliasName` hỏng trên field không hiện cũng
 * là bản khai sai, nhưng nó không làm cột nào mất dữ liệu, và field không hiện thì đã có luật
 * «khai chết» lo — hai cảnh báo cho cùng một dòng là một cảnh báo thừa.
 *
 * @param {{text, fields, shown: Set<string>, segments}} args
 */
export function aliasWarnings({ text, fields, shown, segments = null }) {
  const finding = scanFindingJoin(text);
  // Không đọc được câu Finding (không có, hoặc `<Encrypted>`) thì KHÔNG biết alias nào hợp lệ.
  // Kêu hết mọi cột lên ở đây là biến một câu «tôi không đọc được» thành một câu «bạn sai».
  if (!finding.ok) return [];

  const byAlias = new Map(finding.joins.map((j) => [j.alias, j]));
  const out = [];
  for (const col of fields ?? []) {
    if (shown && !shown.has(col.name)) continue;
    const raw = col.attrs?.aliasName;
    if (raw === undefined || String(raw).trim() === '') continue;

    const { alias, expression, column } = readAliasName(raw, finding.base);
    // Biểu thức phức tạp không bóc được thành `alias.cot`: `readAliasName` trả `alias` là thứ
    // đoán được từ dấu chấm đầu tiên, quá mong manh để dựa vào. Bỏ qua.
    if (expression && column === null) continue;
    if (!alias) continue;
    // Alias gốc (`a`) luôn hợp lệ — nó là chính bảng của lưới, không nằm trong danh sách join.
    if (alias === finding.base) continue;

    const range = spanRange(segments, col.attrSpans?.aliasName);
    const join = byAlias.get(alias);
    if (!join) {
      out.push(warn.anchored('lint.alias_not_joined', { alias }, { range }));
      continue;
    }
    if (isLocalTempTable(join.table)) {
      out.push(warn.anchored('lint.alias_local_temp', { alias, table: join.table }, { range }));
    }
  }
  return out;
}

/**
 * Chiều cao CẢ KHỐI của một lưới có `<field rows="N">`, theo phép cộng đã đo trên runtime.
 *
 * Cùng một công thức với `renderGridHtml`, và cố ý sống ở một chỗ duy nhất: hai bản sao của một
 * phép cộng geometry là hai bản sẽ lệch nhau ở lần đo lại tiếp theo.
 *
 *   toolbar 30 + rows N + split 8 + cuộn 22   (`rows` đã gồm divHeader + divGrid)
 */
export function gridBlockPx(bodyHeight) {
  if (bodyHeight === null || bodyHeight === undefined || !Number.isFinite(bodyHeight)) return null;
  return VIEWS_CONFIG.gridToolbarPx + bodyHeight + VIEWS_CONFIG.gridSplitPx + VIEWS_CONFIG.gridFooterPx;
}

/**
 * Lưới nhúng trong một tab khai `rows` cao hơn vùng chứa nó.
 *
 * Mốc đo lấy nguyên từ ghi chú của `renderGridHtml`: `<view height="302">` đi với
 * `<field rows="242">` là VỪA KHÍT (30 + 242 + 8 + 22 = 302). Nên phép so là chặt: lớn hơn
 * mới kêu, bằng thì đúng.
 *
 * Không khai `view@height` thì vùng co theo nội dung và không có gì để tràn ra khỏi — im.
 *
 * @param {{regions, fieldByName, mainHeight, segments}} model model của form.
 */
export function gridHeightWarnings(model) {
  const height = model?.mainHeight;
  if (!Number.isFinite(height)) return [];

  const out = [];
  for (const region of model.regions ?? []) {
    if (region.kind !== 'category') continue;
    for (const row of region.rows ?? []) {
      for (const t of row.row.tokens) {
        const f = t.field ? model.fieldByName.get(t.field) : null;
        if (String(f?.items?.style ?? '').toLowerCase() !== 'grid') continue;

        const rows = Number.parseInt(f.attrs?.rows, 10);
        const block = gridBlockPx(Number.isInteger(rows) ? rows : null);
        if (block === null || block <= height) continue;

        out.push(warn.anchored(
          'lint.grid_overflows_view',
          { rows, block, height, excess: block - height },
          { range: spanRange(model.segments, f.attrSpans?.rows) },
        ));
      }
    }
  }
  return out;
}
