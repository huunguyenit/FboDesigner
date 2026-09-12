// edit-move.mjs — DỜI / ĐỔI CHỖ TỰ DO: qua hàng khác, qua vùng khác, qua tab khác. Tách từ
// edit.mjs (Phase 3 audit) — cụm LỚN NHẤT và liên kết chặt nhất, xem lý do ở dưới.
//
// Ba việc tách bạch nhau, và trộn chúng là chỗ mọi lỗi ở đây sinh ra:
//
//   1. GHI     `valuePatch` — ghi lại `<item value>` bằng `textPatch`, tức chỉ vá đúng mấy ký
//              tự đã đổi, ở đúng file sở hữu chúng. Đây là thứ THAY THẾ `sourceRow`: không còn
//              luật "hàng có entity thì từ chối", chỉ còn "chỗ SẮP ĐỔI vắt qua ranh giới entity
//              thì từ chối". Chỉ số ô và chỉ số token vẫn tính trên bản ĐÃ BUNG — đó luôn là
//              bản đúng để suy luận về cột — còn việc quy ngược về file thật là của `segments`.
//   2. BỐ CỤC  `removeCell` / `placeCell` trên hàng nguồn và hàng đích. Thuần, không biết file.
//   3. VÙNG    `reconcileRegions` — vùng của một hàng KHÔNG khai trên `<item>` mà suy ra từ
//              `<field categoryIndex>`, nên dời một token qua hàng khác có thể lặng lẽ hất cả
//              một hàng sang vùng khác. Phần nguy hiểm nhất, và nó được xử bằng cách MÔ PHỎNG
//              rồi so, chứ không bằng cách đoán.
//
// Cũng chứa `planRemoveControl` (Shift+Delete — xoá control cùng Label/Footer/Description): nó
// dùng chung `COMPANION_KINDS` và `sourceRow`/`emptyRowSplice` với cụm này, và về bản chất là
// "xoá một cụm control có thể trải nhiều hàng/file" — cùng họ với đổi chỗ/dời hơn là với sửa
// một hàng đơn ở `edit-row.mjs`.

import {
  resolvePattern, buildCells, removeCell, placeCell, setSpan, parseRow, serializeRow,
  takeRowHalf, joinRowHalves,
} from './item-value.mjs';
import { fieldCategories, rowCategoryIndex } from './render.mjs';
import { msg } from './msg.mjs';
import {
  reindentPattern, textPatch, sourceRow, rowHasEmbeddedGrid, emptyRowSplice, lineSpanAround,
} from './edit-shared.mjs';

/** Số cột trống (`-`) liền nhau từ `fromCol` — «span slot đích» khi thả vào chỗ trống. */
function emptyRunFrom(row, widths, fromCol) {
  const chars = Array.from(resolvePattern(row.pattern, widths.length).pattern);
  let n = 0;
  for (let c = fromCol; c < chars.length; c++) {
    if (chars[c] !== '-') break;
    n++;
  }
  return n;
}

/** Ba kind đi kèm một control: chúng chỉ tô điểm cho ô Input, không sống độc lập. */
const COMPANION_KINDS = new Set(['label', 'footer', 'description']);

/**
 * Ghi lại `<item value>` của một hàng — bản thay thế cho `sourceRow`.
 *
 * `sourceRow` đọc lại văn bản gốc rồi đòi nó khớp NGUYÊN VĂN với bản đã bung, nên nó chặn sạch
 * mọi hàng có entity: pattern viết bằng entity, hay một `&Grp;` bung ra ba token, đều làm phép
 * so thất bại và phép sửa bị từ chối — dù chỗ thật sự đổi chẳng liên quan gì tới entity. Đó là
 * cái khoá sai chỗ: nó xét HÀNG, trong khi thứ đáng xét là ĐOẠN SẮP GHI.
 *
 * Ở đây làm theo lối `patternPlan` đã làm đúng từ trước cho gộp/tách: tính giá trị MỚI trên bản
 * đã bung, đưa cả `before`/`after` cho `textPatch` để nó tự cắt ra đúng đoạn đã đổi rồi quy đoạn
 * ấy về file sở hữu. Hệ quả:
 *
 *   - Hàng đến từ Include → splice rơi vào Include, `warning` bật để tầng vỏ hỏi.
 *   - Đoạn đổi nằm trong `&Split;` → splice rơi thẳng vào file khai `Split`.
 *   - Đoạn đổi nằm ngoài mọi entity, dù hàng có cả tá entity chỗ khác → ghi bình thường.
 *   - Đoạn đổi VẮT QUA ranh giới hai nguồn → từ chối, vì một splice không cắt hai file được.
 *
 * Thụt lề của pattern giữ nguyên (`reindentPattern`): không giữ thì hàng viết `value=" 1101 : …"`
 * bị nắn lại lề, và diff hiện một thay đổi người dùng không hề yêu cầu.
 */
function valuePatch(model, row, nextRow, what) {
  if (!row.item?.valueSpan || !model.segments) {
    return { ok: false, reason: msg('edit.what_pos_unknown', { what }) };
  }
  const tokens = nextRow.tokens.map((t) => t.raw).join(nextRow.separator ?? ', ');
  const pattern = reindentPattern(row.row.patternRaw, nextRow.pattern);
  const after = !nextRow.hasColon && tokens === ''
    ? pattern
    : `${pattern}:${nextRow.afterColon ?? ' '}${tokens}`;
  if (after === row.item.value) return { ok: false, reason: msg('common.no_change') };
  return textPatch(model.segments, row.item.valueSpan.start, row.item.value, after, what);
}

/** Chỉ số token mà một ô đang giữ = số ô KHÔNG TRỐNG đứng trước nó. */
function tokenIndexOfCell(cells, cell) {
  let n = 0;
  for (const c of cells) {
    if (c === cell) return n;
    if (!c.empty) n++;
  }
  return -1;
}

/** Ô nào của hàng đang giữ token `.Label` / `.Footer` / `.Description` của field `name`. */
function companionCells(row, name) {
  return (row.cells ?? []).filter((c) => !c.empty
    && c.token
    && c.token.field === name
    && COMPANION_KINDS.has(c.token.kind));
}

/**
 * Dải [start, start+span) trên pattern đích có toàn `-` không.
 * Cùng luật với `placeCell` — dùng để thử neo trước khi ghi.
 */
function rangeFree(pattern, columnCount, start, span) {
  if (start < 0 || start + span > columnCount) return false;
  const chars = Array.from(resolvePattern(pattern, columnCount).pattern);
  for (let c = start; c < start + span; c++) {
    if (chars[c] !== '-') return false;
  }
  return true;
}

/**
 * Neo cột cho ô ĐƯỢC KÉO (`src`) khi đặt cả cụm lên hàng đích.
 *
 * Ưu tiên đúng `preferredCol` (chỗ thả). Nếu cụm lệch tương đối (vd `.Label` ở cột trước)
 * đụng control sẵn có trong khi bên phải còn slot trống — trượt neo tới chỗ gần nhất mà CẢ
 * cụm nằm gọn trên `-`. Không đổi khoảng cách tương đối trong cụm.
 *
 * @returns {{ok:true, anchor:number} | {ok:false, reason:string}}
 */
function clusterDropAnchor(dstRow, widths, members, src, preferredCol) {
  const columnCount = widths.length;
  const pattern = dstRow.pattern;
  const fits = (anchor) => members.every((c) =>
    rangeFree(pattern, columnCount, anchor + (c.col - src.col), c.span));

  if (fits(preferredCol)) return { ok: true, anchor: preferredCol };

  let best = null;
  for (let a = 0; a < columnCount; a++) {
    if (a === preferredCol || !fits(a)) continue;
    const dist = Math.abs(a - preferredCol);
    if (!best || dist < best.dist) best = { a, dist };
  }
  if (best) return { ok: true, anchor: best.a };

  const blockers = [];
  for (const c of members) {
    const at = preferredCol + (c.col - src.col);
    if (rangeFree(pattern, columnCount, at, c.span)) continue;
    const kind = c === src ? (c.token?.kind || 'input') : (c.token?.kind || '?');
    blockers.push(`.${kind}@cột ${at + 1}`);
  }
  return {
    ok: false,
    reason: msg('edit.cluster_no_fit', { p0: src.token?.field, p1: preferredCol + 1 })
      + (blockers.length ? ` — ${blockers.join(', ')} đang bị chiếm hoặc vượt hàng` : '')
      + '; kéo tới dải trống đủ rộng cho cả nhãn và ô nhập',
  };
}

/**
 * Vùng của MỌI hàng, tính lại trên một thế giới GIẢ ĐỊNH.
 *
 * `tokensByRow` — hàng nào đã có danh sách token mới (sau khi dời).
 * `catOverride`  — field nào đã được ghi lại `categoryIndex`.
 *
 * Dùng CHUNG `fieldCategories`/`rowCategoryIndex` với `render.mjs` chứ không chép luật lại: đây
 * là phép so giữa "form sẽ trông thế nào" và "form đang trông thế nào", nên hai vế bắt buộc phải
 * do cùng một hàm tính ra. Chép lại là mở đường cho hai bản đọc lệch nhau, và lệch ở đây nghĩa
 * là designer hứa một đằng còn runtime vẽ một nẻo.
 */
function regionsAfter(model, tokensByRow, catOverride) {
  const cat = fieldCategories([...model.fieldByName.values()]);
  for (const [name, n] of catOverride) cat.set(name, n);

  const out = new Map();
  for (const r of model.rows) {
    const tokens = tokensByRow.has(r.index) ? tokensByRow.get(r.index) : r.row.tokens;
    // Hàng không còn token nào sẽ bị bỏ hẳn thẻ `<item>` — nó không còn vùng để mà lệch.
    if (tokens.length === 0) continue;
    out.set(r.index, rowCategoryIndex({ tokens }, cat));
  }
  return out;
}

/**
 * Sau phép dời, có hàng nào bị hất sang vùng khác không — và ghi cái gì để nó ở nguyên chỗ cũ.
 *
 * Đây là phần dễ hỏng im lặng nhất của cả tính năng, nên nó làm bằng MÔ PHỎNG chứ không bằng suy
 * đoán: dựng thế giới sau phép dời, tính lại vùng của mọi hàng, so với vùng hiện tại. Mọi hàng
 * đều phải giữ nguyên vùng — kể cả hàng đích, kể cả hàng chẳng liên quan gì.
 *
 * GHI TỐI THIỂU. Không phải cứ dời qua vùng khác là ghi `categoryIndex`, và rất nhiều ca không
 * cần ghi gì cả: field không khai `categoryIndex` thì nó chẳng cầm lái vùng của hàng nào, dời
 * đi đâu cũng không hất ai — control cứ thế hiện ở vùng của hàng đích. Chỉ khi mô phỏng CHỈ RA
 * một hàng sắp lệch thì mới ghi, và ghi đúng cái tối thiểu để kéo nó về:
 *
 *   hàng ĐÍCH lệch  → field vừa dời tới đang cầm lái sai; ghi `categoryIndex` của nó = vùng đích
 *   hàng NGUỒN lệch → nó vừa mất field duy nhất khai vùng; GHIM bằng cách ghi `categoryIndex`
 *                     lên một field còn lại trong hàng
 *   không ghim được → TỪ CHỐI. Ghi thêm nữa để chữa là bắt đầu sửa những chỗ người dùng không
 *                     nhìn vào, và mỗi lần ghi lại có thể kéo theo một hàng khác nữa.
 *
 * Mỗi lần ghim đều mô phỏng LẠI toàn bộ trước khi nhận: một `categoryIndex` ghi lên field dùng
 * chung có thể hất một hàng thứ ba, và ghim mù thì đúng là cách tạo ra chuyện đó.
 *
 * @returns {{ok:true, overrides:Map<string,number>, pinned:string[]}|{ok:false, reason:string}}
 */
function reconcileRegions(model, tokensByRow) {
  const before = new Map(model.rows.map((r) => [r.index, r.categoryIndex]));
  const rowAt = new Map(model.rows.map((r) => [r.index, r]));
  const overrides = new Map();
  const pinned = [];

  const offenders = (over) => [...regionsAfter(model, tokensByRow, over).entries()]
    .filter(([index, region]) => region !== before.get(index));

  let bad = offenders(overrides);

  // Chặn cứng: mỗi vòng ghi đúng MỘT field, và không bao giờ ghi lại field đã ghi — nên số vòng
  // không thể vượt số field.
  for (let guard = 0; bad.length > 0 && guard <= model.fieldByName.size; guard++) {
    const [index, got] = bad[0];
    const target = before.get(index);
    const tokens = tokensByRow.has(index) ? tokensByRow.get(index) : rowAt.get(index)?.row.tokens ?? [];

    /*
     * THỨ TỰ THỬ có chủ ý, và bản trước sai đúng ở đây.
     *
     * Field ĐANG KHAI `categoryIndex` được thử TRƯỚC, vì nó chính là thứ cầm lái vùng của hàng —
     * dời `ma_nvbh` (khai 1) vào một hàng header thì thủ phạm là nó, và cái đúng để ghi là
     * `ma_nvbh` = 0. Duyệt token theo thứ tự cột như bản trước thì `ma_kh` (chẳng khai gì, chẳng
     * liên quan) được ghi trước chỉ vì nó đứng đầu: hàng vẫn về đúng vùng, nhưng designer vừa
     * thêm một thuộc tính lên một field vô can, còn `ma_nvbh` thì ở lại header mà vẫn khai là
     * thuộc tab 1 — đọc file sau này không hiểu nổi.
     *
     * Field CHƯA khai chỉ tới lượt khi không còn ai khai: đó đúng là ca GHIM hàng nguồn, nơi
     * hàng vừa mất field duy nhất khai vùng và phải nhờ một field còn lại đứng ra giữ chỗ.
     */
    const declared = new Set(fieldCategories([...model.fieldByName.values()]).keys());
    const candidates = [
      ...tokens.filter((t) => t.field && declared.has(t.field)),
      ...tokens.filter((t) => t.field && !declared.has(t.field)),
    ];

    let fixed = false;
    for (const t of candidates) {
      if (!t.field || overrides.has(t.field)) continue;
      const trial = new Map(overrides);
      trial.set(t.field, target);
      const still = offenders(trial);
      // Chỉ nhận khi bản mô phỏng THẬT SỰ tốt lên. Không thì thử field khác — ghi một thuộc tính
      // mà tình hình không khá hơn là ghi vô ích lên file của khách.
      if (still.length < bad.length) {
        overrides.set(t.field, target);
        pinned.push(t.field);
        bad = still;
        fixed = true;
        break;
      }
    }

    if (!fixed) {
      return {
        ok: false,
        reason: msg('edit.region_kick', { p0: index + 1, p1: before.get(index), got })
          + ' và không field nào trong hàng ghim lại được —'
          + ' sửa categoryIndex bằng tay trước, hoặc chọn chỗ thả khác',
      };
    }
  }

  if (bad.length > 0) {
    return { ok: false, reason: msg('edit.region_side_effects', { length: bad.length }) };
  }
  return { ok: true, overrides, pinned };
}

/**
 * Splice ghi `categoryIndex="n"` lên một `<field>` — sửa tại chỗ, hoặc chèn mới sau tên thẻ.
 *
 * Không dùng lại `planNumericAttr` vì nó chặn số âm, mà `-1` là giá trị THẬT của vùng footer.
 */
function categoryPatch(model, name, value) {
  const field = model.fieldByName.get(name);
  if (!field) return { ok: false, reason: msg('edit.no_field_for_category', { name }) };
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) return { ok: false, reason: msg('edit.category_invalid', { value }) };

  if (field.categoryRange) {
    return {
      ok: true,
      file: field.categoryRange.file,
      splice: { start: field.categoryRange.start, end: field.categoryRange.end, text: String(n) },
      expect: String(field.attrs?.categoryIndex ?? ''),
      wrote: `${name}.categoryIndex = ${n}`,
    };
  }
  // Chưa khai → chèn ngay sau tên thẻ, chỗ chắc chắn nằm trong thẻ mở.
  if (!field.tagStart) return { ok: false, reason: msg('edit.field_tag_not_found', { name }) };
  const at = field.tagStart.start + '<field'.length;
  return {
    ok: true,
    file: field.tagStart.file,
    splice: { start: field.tagStart.start, end: at, text: `<field categoryIndex="${n}"` },
    expect: '<field',
    wrote: `${name}.categoryIndex = ${n} (thêm mới)`,
  };
}

/**
 * Ghi lại hàng NGUỒN — hoặc bỏ hẳn thẻ `<item>` nếu nó vừa mất control cuối cùng.
 *
 * Cùng lý do với `emptyRowSplice`: một `<item value="----: "/>` không token nào vẫn CHIẾM một
 * hàng trên form. Ở tầng này chưa có văn bản nguồn để soi thẻ, nên chỗ đó chỉ đánh dấu `dropRow`
 * và để `verifyPatches` kiểm nốt.
 */
function rowWritePatch(model, row, nextRow, what) {
  const at = row.itemRange;
  const canDrop = nextRow.tokens.length === 0
    && at && row.range
    && at.file === row.range.file
    && at.start <= row.range.start && at.end >= row.range.end;
  if (!canDrop) return valuePatch(model, row, nextRow, what);
  return {
    ok: true,
    file: at.file,
    splice: { start: at.start, end: at.end, text: '' },
    expect: null,
    dropRow: true,
  };
}

/**
 * Phần THUẦN, KHÔNG CẦN VĂN BẢN của phép dời — trả danh sách patch kèm `expect`.
 *
 * Mỗi token giữ span gốc, thu về `min(span, số cột trống liền từ cột thả)`. Multi-select gửi
 * `targets` (Shift+click); mỗi ô đặt lần lượt, cột kế tiếp sau span đã giữ của ô trước.
 *
 * Tách khỏi phần đối chiếu vì có đúng cái vòng luẩn quẩn mà `rowEditTargetFile` đã gỡ một lần:
 * muốn so nguyên văn thì phải đọc file, mà biết đọc file nào thì phải tính xong patch. Tính
 * trước, rồi tầng vỏ mở đúng bấy nhiêu file — xem `moveControlFiles`.
 */
function buildMovePatches(model, op, getText) {
  const { item, cell, toItem, toCol, targets } = op;
  const list = Array.isArray(targets) && targets.length > 0
    ? targets
    : [{ item, cell }];
  return buildMoveManyPatches(model, list, toItem ?? item, toCol, getText);
}

/**
 * Dời một hoặc nhiều ô tới hàng đích.
 * `targets`: [{ item, cell }] — thứ tự giữ nguyên; mỗi ô giữ span gốc (thu về chỗ trống còn lại).
 */
function buildMoveManyPatches(model, targets, toItem, baseCol, getText) {
  const to = model.rows.find((r) => r.index === toItem);
  if (!to) return { ok: false, reason: msg('edit.row_item_not_found', { item: toItem }) };

  const base = Math.trunc(Number(baseCol));
  if (!Number.isFinite(base) || base < 0) return { ok: false, reason: msg('common.target_col_invalid', { col: baseCol }) };

  const picks = [];
  for (const t of targets) {
    const row = model.rows.find((r) => r.index === t.item);
    if (!row) return { ok: false, reason: msg('edit.row_item_not_found', { item: t.item }) };
    const src = row.cells?.[t.cell];
    if (!src || src.empty || !src.token) return { ok: false, reason: msg('common.empty_move') };
    picks.push({ row, src, token: src.token });
  }

  // Gỡ nguồn: mỗi hàng theo cột GIẢM DẦN để cột bên trái không bị lệch chỉ số.
  const rowState = new Map();
  for (const p of picks) rowState.set(p.row.index, p.row.row);

  const removeOrder = [...picks].sort((a, b) => {
    if (a.row.index !== b.row.index) return a.row.index - b.row.index;
    return b.src.col - a.src.col;
  });
  const rowIndexes = [...new Set(removeOrder.map((p) => p.row.index))];
  for (const ri of rowIndexes) {
    const group = removeOrder.filter((p) => p.row.index === ri).sort((a, b) => b.src.col - a.src.col);
    let cur = rowState.get(ri);
    const widths = group[0].row.widths;
    for (const p of group) {
      const { cells } = buildCells(cur, widths);
      const idx = cells.findIndex((x) => x.col === p.src.col && !x.empty);
      if (idx === -1) return { ok: false, reason: msg('edit.cell_not_relocated', { p0: p.src.col + 1 }) };
      const done = removeCell(cur, widths, idx, { allowEntity: true });
      if (!done.ok) return done;
      cur = done.row;
    }
    rowState.set(ri, cur);
  }

  // Đặt lên đích: mỗi token giữ span gốc, thu về min(span, số slot trống liền từ cột thả).
  let dst = rowState.has(to.index) ? rowState.get(to.index) : to.row;
  let at = base;
  for (const p of picks) {
    if (at >= to.widths.length) {
      return {
        ok: false,
        reason: msg('item.place_overflow', { p0: at + 1, n: 1, columnCount: to.widths.length }),
      };
    }
    const avail = emptyRunFrom(dst, to.widths, at);
    const keep = Math.min(p.src.span, avail);
    if (keep < 1) {
      // Probe span 1 để lấy lý do chi tiết của placeCell (ô đang có người / vượt hàng…).
      const probe = placeCell(dst, to.widths, at, 1, p.token, { allowEntity: true });
      return probe.ok
        ? { ok: false, reason: msg('edit.no_empty_slot', { p0: at + 1, p1: p.token?.field ?? '?' }) }
        : probe;
    }
    const done = placeCell(dst, to.widths, at, keep, p.token, { allowEntity: true });
    if (!done.ok) return done;
    dst = done.row;
    at += keep;
  }
  rowState.set(to.index, dst);

  const tokenMap = new Map();
  for (const [ri, parsed] of rowState) tokenMap.set(ri, parsed.tokens);
  const fixed = reconcileRegions(model, tokenMap);
  if (!fixed.ok) return fixed;

  /*
   * TOKEN ĐI ĐÂU — truy bằng CHÍNH ĐỐI TƯỢNG token, không bằng chỉ số.
   *
   * `removeCell` lọc mảng, `placeCell` chèn vào mảng — cả hai chuyển nguyên tham chiếu chứ
   * không dựng token mới. Nên sau khi gỡ và đặt xong, mỗi phần tử của mảng token mới vẫn CHÍNH
   * LÀ một phần tử của mảng token cũ của một hàng nào đó, và đối chiếu bằng identity là cách
   * duy nhất còn đúng khi chỉ số đã xáo trộn.
   *
   * Có bản đồ ấy thì `rowRewritePatches` chép được chữ NGUYÊN VĂN từ file: một token viết
   * `[&k;]` đáp xuống hàng mới vẫn là `[&k;]`, không bung thành `[ma_kh]`. Bản trước dựng chuỗi
   * từ token của model (đã bung) nên mỗi phép dời lặng lẽ cắt đứt một tham chiếu dùng chung.
   */
  const originOf = new Map();
  for (const ri of rowState.keys()) {
    const row = model.rows.find((r) => r.index === ri);
    if (!row) continue;
    row.row.tokens.forEach((t, i) => {
      if (!originOf.has(t)) originOf.set(t, { row: ri, index: i });
    });
  }

  const states = [];
  for (const [ri, parsed] of rowState) {
    const row = model.rows.find((r) => r.index === ri);
    if (!row) continue;
    const origins = parsed.tokens.map((t) => originOf.get(t) ?? null);
    if (origins.some((o) => o === null)) return { ok: false, reason: msg('edit.token_unmap') };
    // Hàng ĐÍCH không bao giờ bị bỏ thẻ — nó vừa nhận thêm token. Hàng nguồn thì có thể.
    states.push({ row, next: parsed, origins, allowDrop: ri !== to.index });
  }

  /*
   * KHÔNG có văn bản = lời gọi dò FILE của `moveControlFiles` — cùng vòng luẩn quẩn với đổi
   * chỗ: muốn ghi thì phải đọc, muốn biết đọc file nào thì phải tính xong. Tới đây đã đủ tên.
   */
  if (typeof getText !== 'function') {
    const files = states.flatMap((st) => [st.row.range?.file, st.row.itemRange?.file]);
    for (const [field, n] of fixed.overrides) {
      const cp = categoryPatch(model, field, n);
      if (cp.ok) files.push(cp.file);
    }
    return { ok: true, patches: [], files: [...new Set(files.filter(Boolean))], pinned: fixed.pinned };
  }

  const written = rowRewritePatches(model, states, getText);
  if (!written.ok) return written;

  const patches = [];
  for (const patch of written.patches) {
    if (!patches.some((x) => x.file === patch.file && x.splice?.start === patch.splice?.start)) {
      patches.push(patch);
    }
  }

  for (const [field, n] of fixed.overrides) {
    const cp = categoryPatch(model, field, n);
    if (!cp.ok) return cp;
    patches.push(cp);
  }

  if (patches.length === 0) return { ok: false, reason: msg('common.no_change') };

  const touched = [...rowState.keys()].map((i) => model.rows.find((r) => r.index === i)).filter(Boolean);
  return {
    ok: true,
    patches,
    warning: touched.find((r) => r.foreign)?.range?.file ?? null,
    pinned: fixed.pinned,
    moved: picks.length,
    dropAnchor: base,
    dropPreferred: base,
  };
}

/**
 * Phần THUẦN của phép ĐỔI CHỖ MỘT cặp — chỉ là ca N = 1 của `buildSwapGroupPatches`.
 *
 * Gộp về một luật chứ không giữ hai bản: mọi thứ phân biệt hai bên trước đây (hoán token, thu
 * span về `min`, chặn cụm Label khi qua vùng khác, ghi bằng chữ NGUYÊN VĂN của file nguồn) đều
 * đúng cho cả N = 1 lẫn N > 1. Hai bản song song là hai chỗ để hai luật trôi khỏi nhau — và
 * chúng đã trôi một lần: bản một cặp đếm chỉ số token bằng số ký tự `1`, bản nhiều cặp đếm
 * bằng số ô không rỗng.
 */
function buildSwapPatches(model, { item, cell, toItem, other }, getText) {
  return buildSwapGroupPatches(model, {
    pairs: [{ item, cell, toItem: toItem ?? item, other }],
  }, getText);
}

/**
 * ĐỔI CHỖ HAI DẢI CỘT — và đây là phép đo ĐÚNG cho việc "đổi chỗ hai cụm".
 *
 * Bản trước ghép CONTROL với CONTROL: cụm nguồn n ô đổi với n ô đầu tiên bên đích, cặp thứ i
 * đổi với cặp thứ i. Nghe hợp lý, nhưng nó đo sai đại lượng. Người dùng nhìn form thấy CHỖ, mà
 * chỗ thì đo bằng CỘT:
 *
 *   [ty_gia].Label, [ma_nt], [ty_gia]   ba control, nhưng 4 cột (1 + 2 + 1)
 *   [ngay_ct].Label, [ngay_ct]          hai control, cũng 4 cột (1 + 3)
 *
 * Hai cụm ấy vừa khít nhau — đổi chỗ là chuyện hiển nhiên phải làm được. Luật ghép theo control
 * thì đếm 3 với 2, không ghép nổi; mà có ghép được cũng sai, vì nó thu span về `min` từng cặp,
 * cụm bốn cột trở về ba và để lại một cột trống không ai yêu cầu.
 *
 * Nên luật ở đây là: hai DẢI CỘT cùng bề rộng đổi chỗ cho nhau, NGUYÊN KHỐI. Mỗi control giữ
 * đúng span của nó và đúng vị trí tương đối trong cụm, chỉ cả cụm dời sang chỗ kia. Không ô nào
 * bị thu hẹp, không cột nào thừa ra — hai dải bằng nhau từng cột thì phép đổi luôn khít.
 *
 * Về mặt dữ liệu: hoán hai ĐOẠN pattern cùng độ dài, và hoán hai LÁT của danh sách token. Phần
 * ngoài hai dải không bị chạm tới một ký tự nào.
 *
 * TỪ CHỐI ba ca, và cả ba đều không có câu trả lời đúng:
 *   · hai dải khác bề rộng — phần dư biết đi đâu;
 *   · một dải CẮT ĐÔI một control (control bắt đầu trước dải, hoặc trải ra ngoài dải);
 *   · hai dải giẫm lên nhau trong cùng một hàng.
 *
 * @param op {a:{item,col,span}, b:{item,col,span}} — `col` đếm từ 0, `span` tính bằng SỐ CỘT
 */
function buildSwapBlockPatches(model, { a, b }, getText) {
  const ra = model.rows.find((r) => r.index === Number(a?.item));
  if (!ra) return { ok: false, reason: msg('edit.row_item_not_found', { item: a?.item }) };
  const rb = model.rows.find((r) => r.index === Number(b?.item));
  if (!rb) return { ok: false, reason: msg('edit.row_item_not_found', { item: b?.item }) };

  const aCol = Math.trunc(Number(a.col));
  const bCol = Math.trunc(Number(b.col));
  const span = Math.trunc(Number(a.span));
  const spanB = Math.trunc(Number(b.span));
  if (!Number.isInteger(span) || span < 1 || !Number.isInteger(spanB) || spanB < 1 || span !== spanB) {
    return { ok: false, reason: msg('edit.swap_block_width', { n: span, n2: spanB }) };
  }

  const partA = blockInRow(ra, aCol, span);
  if (!partA.ok) return partA;
  const partB = blockInRow(rb, bCol, span);
  if (!partB.ok) return partB;
  if (partA.cells.length === 0 && partB.cells.length === 0) {
    return { ok: false, reason: msg('common.no_change') };
  }

  const charsA = Array.from(resolvePattern(ra.row.pattern, ra.widths.length).pattern);
  const charsB = Array.from(resolvePattern(rb.row.pattern, rb.widths.length).pattern);
  const sliceA = charsA.slice(aCol, aCol + span);
  const sliceB = charsB.slice(bCol, bCol + span);

  // Chỉ số token = số ký tự `1` đứng trước. Hai lát token đều LIỀN NHAU trong mảng — dải cột
  // liền nhau và không control nào bị cắt đôi — nên hoán chúng chỉ là hai phép `splice`.
  const iA = onesBefore(charsA, aCol);
  const nA = sliceA.filter((ch) => ch === '1').length;
  const iB = onesBefore(charsB, bCol);
  const nB = sliceB.filter((ch) => ch === '1').length;
  const tokA = ra.row.tokens.slice(iA, iA + nA);
  const tokB = rb.row.tokens.slice(iB, iB + nB);
  if (tokA.length !== nA || tokB.length !== nB) return { ok: false, reason: msg('edit.token_unmap') };

  const sameRow = ra.index === rb.index;
  if (sameRow && aCol < bCol + span && bCol < aCol + span) {
    return { ok: false, reason: msg('edit.swap_block_overlap') };
  }

  /*
   * Cụm Label/Footer/Description nằm NGOÀI hai dải thì đổi chỗ sẽ bỏ nó lại một mình, trỏ vào
   * một control vừa đi sang vùng khác. Companion nằm TRONG dải thì không sao — nó đi cùng cụm,
   * và đó chính là điều người dùng đang làm khi quét cả `[x].Label, [x]` vào vùng chọn.
   */
  if (ra.categoryIndex !== rb.categoryIndex) {
    const moving = new Set([...tokA, ...tokB]);
    for (const tok of moving) {
      if (!tok.field || tok.kind !== 'input') continue;
      for (const r of model.rows) {
        const stray = companionCells(r, tok.field).filter((c) => !moving.has(c.token));
        if (stray.length === 0) continue;
        return {
          ok: false,
          reason: msg('edit.has_companion_cells', { field: tok.field, p1: r.index + 1 })
            + ' đổi chỗ qua vùng khác không chở cụm đi cùng được (chỗ bên kia đã có người);'
            + ' quét cả cụm vào vùng chọn, hoặc đổi chỗ trong cùng một vùng',
        };
      }
    }
  }

  const states = [];
  if (sameRow) {
    const chars = [...charsA];
    for (let i = 0; i < span; i++) {
      chars[aCol + i] = sliceB[i];
      chars[bCol + i] = sliceA[i];
    }
    // Lát ĐỨNG SAU phải splice trước: cắt lát trước là mọi chỉ số phía sau chạy đi một nấc.
    const tokens = [...ra.row.tokens];
    const left = aCol < bCol ? { i: iA, n: nA, t: tokB } : { i: iB, n: nB, t: tokA };
    const right = aCol < bCol ? { i: iB, n: nB, t: tokA } : { i: iA, n: nA, t: tokB };
    tokens.splice(right.i, right.n, ...right.t);
    tokens.splice(left.i, left.n, ...left.t);
    states.push({ row: ra, next: { ...ra.row, pattern: chars.join(''), tokens } });
  } else {
    const nextA = [...charsA];
    const nextB = [...charsB];
    for (let i = 0; i < span; i++) {
      nextA[aCol + i] = sliceB[i];
      nextB[bCol + i] = sliceA[i];
    }
    const tokensA = [...ra.row.tokens];
    tokensA.splice(iA, nA, ...tokB);
    const tokensB = [...rb.row.tokens];
    tokensB.splice(iB, nB, ...tokA);
    states.push({ row: ra, next: { ...ra.row, pattern: nextA.join(''), tokens: tokensA } });
    states.push({ row: rb, next: { ...rb.row, pattern: nextB.join(''), tokens: tokensB } });
  }

  // Token đi bằng THAM CHIẾU qua mấy phép `slice`/`splice` trên, nên truy nguồn bằng identity —
  // cùng cách với phép DỜI, và cùng lý do: để chép được chữ NGUYÊN VĂN (`&k;`) từ file.
  const originOf = new Map();
  for (const r of sameRow ? [ra] : [ra, rb]) {
    r.row.tokens.forEach((t, i) => {
      if (!originOf.has(t)) originOf.set(t, { row: r.index, index: i });
    });
  }
  for (const st of states) {
    st.origins = st.next.tokens.map((t) => originOf.get(t) ?? null);
    if (st.origins.some((o) => o === null)) return { ok: false, reason: msg('edit.token_unmap') };
  }

  const fixed = reconcileRegions(model, new Map(states.map((st) => [st.row.index, st.next.tokens])));
  if (!fixed.ok) return fixed;

  const category = [];
  for (const [field, n] of fixed.overrides) {
    const cp = categoryPatch(model, field, n);
    if (!cp.ok) return cp;
    category.push(cp);
  }

  const foreignRow = states.map((st) => st.row).find((r) => r.foreign)?.range?.file ?? null;
  if (typeof getText !== 'function') {
    const files = states.map((st) => st.row.range?.file).filter(Boolean);
    return {
      ok: true,
      patches: category,
      files: [...new Set([...files, ...category.map((c) => c.file)])],
      warning: foreignRow,
      pinned: fixed.pinned,
    };
  }

  const written = rowRewritePatches(model, states, getText);
  if (!written.ok) return written;

  const patches = [...written.patches, ...category];
  if (patches.length === 0) return { ok: false, reason: msg('common.no_change') };

  return {
    ok: true,
    patches,
    warning: foreignRow
      ?? patches.map((x) => x.file).find((f) => f && model.hostFile && f !== model.hostFile)
      ?? null,
    pinned: fixed.pinned,
    moved: tokA.length + tokB.length,
  };
}

/** Số ký tự `1` đứng trước cột `col`. */
function onesBefore(chars, col) {
  let n = 0;
  for (let c = 0; c < col && c < chars.length; c++) if (chars[c] === '1') n++;
  return n;
}

/**
 * Control nào nằm trong dải `[col, col+span)` của một hàng — và TỪ CHỐI nếu dải cắt đôi cái nào.
 *
 * Cắt đôi không phải ca hiếm: thả vào giữa một control trải 3 cột thì dải đích bắt đầu ngay
 * trong thân nó, và phép hoán pattern sau đó ghi ra một `0` chẳng có `1` nào mở đầu — form vẫn
 * vẽ ra, chỉ mất một control mà không ai báo.
 */
function blockInRow(row, col, span) {
  const columnCount = row.widths.length;
  if (!Number.isInteger(col) || col < 0 || col + span > columnCount) {
    return {
      ok: false,
      reason: msg('edit.swap_block_range', { p0: col + 1, n: span, columnCount, index: row.index + 1 }),
    };
  }
  const { cells } = buildCells(row.row, row.widths);
  const inside = [];
  for (const c of cells) {
    if (c.empty) continue;
    const end = c.col + c.span;
    if (!(c.col < col + span && col < end)) continue;
    if (c.col < col || end > col + span) {
      return {
        ok: false,
        reason: msg('edit.swap_block_cuts', { raw: c.token?.raw ?? '?', p0: c.col + 1, n: c.span }),
      };
    }
    inside.push(c);
  }
  return { ok: true, cells: inside };
}

/** Tham chiếu `&Name;` nằm bên trong một token — `[&k;]`, `[&Revert.Field.1;].Label`. */
const RE_ENTITY_IN_TOKEN = /&[A-Za-z_][\w.:-]*;/;

/**
 * Ghi lại các hàng của một phép ĐỔI CHỖ — đọc token từ VĂN BẢN NGUỒN, không từ model.
 *
 * Đây là điểm khác duy nhất, và là cả lý do hàm này tồn tại tách khỏi `valuePatch`.
 *
 * `valuePatch` dựng chuỗi mới từ token của MODEL (đã bung entity) rồi nhờ `textPatch` quy về
 * file nguồn. Với hàng như
 *
 *   <item value="110--------100100: [ma_kh].Label, [ma_kh], [&Revert.Field.1;].Label, [&Revert.Field.1;]"/>
 *
 * model chỉ còn thấy `[so_ct]`, nên đoạn chữ phải ghi lại vắt qua ranh giới giữa file chủ và
 * file khai entity — `textPatch` từ chối, và người dùng nhận «chỗ cần sửa vắt qua ranh giới
 * entity» cho một phép chẳng đổi giá trị nào cả.
 *
 * Mà đúng là chẳng đổi gì: ĐỔI CHỖ là hoán vị, `a ↔ b`. Chữ trong mỗi token đi nguyên vẹn,
 * chỉ đổi chỗ đứng. Nên đọc token thô từ nguồn (`&Revert.Field.1;` vẫn là `&Revert.Field.1;`),
 * hoán vị mấy chuỗi ấy, rồi ghi lại — không ô nào phải bung ra, không file entity nào bị đụng.
 *
 * PATTERN thì ngược lại, và đó là ranh giới:
 *   · span hai bên BẰNG nhau → pattern không đổi → chỉ ghi lại DANH SÁCH TOKEN, phần pattern
 *     giữ nguyên văn. Hàng có pattern ghép từ entity (`110&Split;-----101-`) cũng đổi chỗ được,
 *     vì mấy ký tự ấy không hề bị chạm tới.
 *   · span KHÁC nhau → phải viết lại pattern. Pattern viết bằng entity thì từ chối ở đây; tầng
 *     vỏ đã có đường «phân giải entity theo `fboDesigner.entityEditTarget`» cho hàng đến từ
 *     `&ENTITY;`, và đó là chỗ đúng để hỏi.
 *
 * @param states  Array<{row, next, assign:Map<slot, {row, index}>}> — `assign` nói slot nào
 *                nhận token của (hàng nào, slot nào) TRƯỚC khi hoán vị.
 */
function rowRewritePatches(model, states, getText) {
  const src = new Map();
  for (const st of states) {
    const row = st.row;
    if (!row.range) return { ok: false, reason: msg('edit.row_pos_unknown', { index: row.index }) };
    const text = typeof getText === 'function' ? getText(row.range.file) : null;
    if (typeof text !== 'string') return { ok: false, reason: msg('edit.file_unread', { file: row.range.file }) };
    const value = text.slice(row.range.start, row.range.end);
    const parsed = parseRow(value);
    /*
     * Hàng không có dấu `:` thì không cầm token nào — nhưng nó VẪN là đích hợp lệ của phép dời
     * (hàng trống `--------` là chỗ người ta hay thả xuống nhất). Chỉ chặn khi hàng thật sự
     * đang cầm token mà nguồn lại không có danh sách nào để đọc.
     */
    if (!parsed.hasColon && row.row.tokens.length > 0) {
      return { ok: false, reason: msg('common.empty_swap') };
    }
    /*
     * Một entity bung ra NHIỀU token thì chỉ số token của nguồn và của model không còn khớp
     * nhau — và cả phép hoán vị này chạy bằng chỉ số. Từ chối chứ không ghi lệch một nấc.
     */
    if (parsed.tokens.length !== row.row.tokens.length) {
      return {
        ok: false,
        reason: msg('edit.token_count_mismatch', {
          length: parsed.tokens.length, length2: row.row.tokens.length,
        }) + ' — có entity bung ra nhiều token, không map được chỉ số',
      };
    }
    src.set(row.index, { value, parsed });
  }

  const patches = [];
  for (const st of states) {
    const me = src.get(st.row.index);

    /*
     * Hàng mất token CUỐI CÙNG → bỏ hẳn thẻ `<item>` thay vì để lại một hàng rỗng chiếm chỗ.
     * Cùng luật với `rowWritePatch`; chỉ hàng NGUỒN của phép dời mới bật cờ này.
     */
    if (st.allowDrop && st.next.tokens.length === 0) {
      const drop = rowWritePatch(model, st.row, st.next, `hàng ${st.row.index + 1}`);
      if (!drop.ok) {
        if (drop.reason === msg('common.no_change')) continue;
        return drop;
      }
      if (drop.dropRow) {
        patches.push(drop);
        continue;
      }
    }

    // Chữ NGUYÊN VĂN của từng token, đọc từ file mà nó ĐANG nằm — `&k;` vẫn là `&k;`.
    const raws = [];
    for (const from of st.origins) {
      const donor = from ? src.get(from.row) : null;
      const token = donor?.parsed.tokens[from.index];
      if (!token) return { ok: false, reason: msg('edit.token_unmap') };

      /*
       * Chở một token viết bằng `&ENTITY;` sang FILE KHÁC — chốt chặn của cả tính năng này.
       *
       * Giữ nguyên văn `&k;` là đúng khi token ở lại chỗ cũ. Nhưng dời nó vào một Include thì
       * Include ấy bỗng chứa `&k;`, và MỌI controller khác include file đó phải khai `k` —
       * cái nào không khai là hỏng ngay ở tầng parse XML, ở một màn hình không ai vừa sửa.
       *
       * Hai đích an toàn: chính file nó đang nằm (tham chiếu vốn đã ở đó), và controller ĐANG
       * MỞ (nó phải khai `k`, nếu không thì bản đã bung trong tay đây đã không có chữ nào).
       */
      if (from.row !== st.row.index && RE_ENTITY_IN_TOKEN.test(token.raw)) {
        const donorRow = states.find((x) => x.row.index === from.row)?.row;
        const toFile = st.row.range.file;
        if (donorRow && toFile !== donorRow.range.file && toFile !== model.hostFile) {
          return {
            ok: false,
            reason: msg('edit.entity_token_foreign_target', { raw: token.raw, file: toFile }),
          };
        }
      }
      raws.push(token.raw);
    }

    // Khoảng trắng sau dấu `:` lấy từ chính hàng đang sửa — hàng viết `:[a]` không tự dưng
    // mọc thêm một dấu cách chỉ vì vừa bị sửa. Hàng chưa từng có `:` thì theo nếp của corpus.
    const lead = me.parsed.hasColon ? /^\s*/.exec(me.parsed.tokensRaw)[0] : ' ';
    const tokensText = `${lead}${raws.join(me.parsed.separator)}`;
    const patternChanged = st.next.pattern !== st.row.row.pattern;

    /*
     * MỘT splice cho cả hàng — đường thường, và là đường của gần hết mọi hàng.
     *
     * Điều kiện: pattern trong FILE đọc ra đúng bằng pattern của model. Bằng nhau nghĩa là
     * pattern nằm trọn trong file chủ, không ghép từ `&ENTITY;` nào — nên viết lại cả `value`
     * là một dải liền, một chỗ, một dòng diff.
     */
    if (me.parsed.pattern === st.row.row.pattern) {
      const patternRaw = patternChanged
        ? reindentPattern(me.parsed.patternRaw, st.next.pattern)
        : me.parsed.patternRaw;
      const body = raws.length > 0 || me.parsed.hasColon ? `:${tokensText}` : '';
      const nextValue = `${patternRaw}${body}`;
      if (nextValue === me.value) continue;
      patches.push({
        file: st.row.range.file,
        splice: { start: st.row.range.start, end: st.row.range.end, text: nextValue },
        expect: me.value,
      });
      continue;
    }

    /*
     * Pattern GHÉP TỪ ENTITY (`110&Split;-----101-`) — hai splice, mỗi phần về đúng nhà của nó.
     *
     * Danh sách token vẫn ghi ở `<item value>` của file chủ. Còn pattern thì vá ĐÚNG mấy ký tự
     * đã đổi, ngay tại nơi chúng thật sự nằm — cùng đường với `patternPlan` của phép kéo giãn:
     * ký tự đổi nằm gọn trong file chủ thì ghi ở file chủ, nằm trong khai báo `&Split;` thì
     * splice rơi vào file khai entity và tầng vỏ hỏi trước khi ghi (`confirmForeign`, theo
     * `fboDesigner.entityEditTarget`). Vắt qua ĐÚNG ranh giới giữa hai nguồn thì `textPatch` từ
     * chối — ca ấy không có cách ghi nào đúng cho cả hai bên.
     *
     * Hai splice không bao giờ chồng nhau: pattern đứng trước dấu `:`, token đứng sau.
     */
    if (me.parsed.hasColon && tokensText !== me.parsed.tokensRaw) {
      const colonAt = st.row.range.start + me.parsed.patternRaw.length + 1;
      patches.push({
        file: st.row.range.file,
        splice: { start: colonAt, end: st.row.range.end, text: tokensText },
        expect: me.parsed.tokensRaw,
      });
    } else if (!me.parsed.hasColon && raws.length > 0) {
      patches.push({
        file: st.row.range.file,
        splice: { start: st.row.range.end, end: st.row.range.end, text: `:${tokensText}` },
        expect: '',
      });
    }

    if (patternChanged) {
      if (!st.row.item?.valueSpan || !model.segments) {
        return { ok: false, reason: msg('edit.item_pos_unknown', { index: st.row.index }) };
      }
      const before = st.row.row.patternRaw;
      const after = reindentPattern(before, st.next.pattern);
      const pp = textPatch(model.segments, st.row.item.valueSpan.start, before, after,
        `pattern của item ${st.row.index}`);
      if (!pp.ok) return pp;
      patches.push(pp);
    }
  }

  return { ok: true, patches };
}

/**
 * ĐỔI CHỖ theo CẶP Ô — hoán token giữa từng cặp `(ô nguồn, ô đích)`.
 *
 * LUẬT: SLOT đứng yên, TOKEN đổi chỗ. Mỗi token giữ span gốc và chỉ thu về
 * `min(span mình, span slot đích)` khi chỗ mới hẹp hơn — cùng luật với `swapCells`.
 *
 * Đây là engine của phép đổi chỗ MỘT cặp (`planSwapControl`), và chỉ của nó. Đổi chỗ cả cụm
 * KHÔNG đi đường này nữa: ghép ô-với-ô đo sai đại lượng, vì cái người dùng đang đổi là hai DẢI
 * CỘT chứ không phải hai danh sách control — xem `buildSwapBlockPatches`.
 *
 * @param op {pairs:Array<{item,cell,toItem,other}>}
 */
function buildSwapGroupPatches(model, { pairs }, getText) {
  const list = (Array.isArray(pairs) ? pairs : []).map((p) => ({
    item: Number(p.item),
    cell: Number(p.cell),
    toItem: Number.isFinite(Number(p.toItem)) ? Number(p.toItem) : Number(p.item),
    other: Number(p.other),
  }));
  if (list.length === 0) return { ok: false, reason: msg('common.no_change') };

  const resolved = [];
  const seen = new Set();
  for (const p of list) {
    const ra = model.rows.find((r) => r.index === p.item);
    if (!ra) return { ok: false, reason: msg('edit.row_item_not_found', { item: p.item }) };
    const rb = model.rows.find((r) => r.index === p.toItem);
    if (!rb) return { ok: false, reason: msg('edit.row_item_not_found', { item: p.toItem }) };

    const a = ra.cells?.[p.cell];
    const b = rb.cells?.[p.other];
    if (!a || a.empty || !a.token) return { ok: false, reason: msg('common.empty_swap') };
    if (!b || b.empty || !b.token) return { ok: false, reason: msg('common.empty_swap') };
    if (ra.index === rb.index && a.col === b.col) return { ok: false, reason: msg('common.no_change') };

    // Khoá theo (hàng, CỘT) chứ không theo chỉ số ô: cùng một ô đến từ hai cặp khác nhau vẫn
    // là cùng một chỗ trên form, và đó chính là ca phải chặn.
    for (const key of [`${ra.index}:${a.col}`, `${rb.index}:${b.col}`]) {
      if (seen.has(key)) return { ok: false, reason: msg('edit.swap_group_overlap') };
      seen.add(key);
    }
    resolved.push({ ra, rb, a, b });
  }

  /*
   * Qua VÙNG khác thì cụm Label/Footer/Description phải đi cùng — mà đổi chỗ không chở cụm đi
   * được. Cùng lời từ chối, cùng lý do với `buildSwapPatches`.
   */
  for (const { ra, rb, a, b } of resolved) {
    if (ra.categoryIndex === rb.categoryIndex) continue;
    for (const tok of [a.token, b.token]) {
      if (!tok.field || tok.kind !== 'input') continue;
      for (const r of model.rows) {
        if (companionCells(r, tok.field).length === 0) continue;
        return {
          ok: false,
          reason: msg('edit.has_companion_cells', { field: tok.field, p1: r.index + 1 })
            + ' đổi chỗ qua vùng khác không chở cụm đi cùng được (chỗ bên kia đã có người);'
            + ' dùng phép DỜI cho từng ô, hoặc đổi chỗ trong cùng một vùng',
        };
      }
    }
  }

  /*
   * HOÁN TOKEN trước, THU SPAN sau — và thứ tự ấy là bắt buộc.
   *
   * Chỉ số token đọc từ mảng ô GỐC (`tokenIndexOfCell`), nên mọi phép hoán phải tính trên cùng
   * một ảnh chụp: thu span của một ô sớm hơn là vẽ lại pattern, và mọi chỉ số tính sau đó
   * thuộc về một hàng khác với hàng người dùng đang nhìn.
   */
  const work = new Map();
  const rowOf = (r) => {
    if (!work.has(r.index)) {
      work.set(r.index, {
        row: r,
        next: { ...r.row, tokens: [...r.row.tokens] },
        shrink: [],
        // slot thứ i của hàng SAU khi sửa lấy token của (hàng nào, slot nào) TRƯỚC khi sửa —
        // để `rowRewritePatches` chép ĐÚNG CHỮ trong file nguồn, kể cả khi chữ ấy là `&ENTITY;`.
        origins: r.row.tokens.map((_, i) => ({ row: r.index, index: i })),
      });
    }
    return work.get(r.index);
  };
  for (const { ra, rb, a, b } of resolved) {
    const ai = tokenIndexOfCell(ra.cells, a);
    const bi = tokenIndexOfCell(rb.cells, b);
    const sa = rowOf(ra);
    const sb = rowOf(rb);
    if (ai === -1 || bi === -1 || !sa.next.tokens[ai] || !sb.next.tokens[bi]) {
      return { ok: false, reason: msg('edit.token_unmap') };
    }
    const tokenA = ra.row.tokens[ai];
    const tokenB = rb.row.tokens[bi];
    sa.next.tokens[ai] = tokenB;
    sb.next.tokens[bi] = tokenA;
    sa.origins[ai] = { row: rb.index, index: bi };
    sb.origins[bi] = { row: ra.index, index: ai };

    const keep = Math.min(a.span, b.span);
    if (keep < a.span) sa.shrink.push({ col: a.col, span: keep });
    if (keep < b.span) sb.shrink.push({ col: b.col, span: keep });
  }

  /*
   * Thu span theo cột GIẢM DẦN. Thu một ô là biến phần đuôi của nó thành `-`, tức đẻ thêm ô
   * trống — mọi chỉ số ô BÊN PHẢI chạy đi một nấc, còn bên trái đứng yên. Đi từ phải sang trái
   * là mỗi lần tra lại chỉ số theo cột đều tra trên phần chưa bị đụng tới.
   */
  for (const state of work.values()) {
    for (const { col, span } of [...state.shrink].sort((x, y) => y.col - x.col)) {
      const { cells } = buildCells(state.next, state.row.widths);
      const idx = cells.findIndex((c) => !c.empty && c.col === col);
      if (idx === -1) return { ok: false, reason: msg('edit.token_unmap') };
      const shrunk = setSpan(state.next, state.row.widths, idx, span, { allowEntity: true });
      if (!shrunk.ok) return shrunk;
      state.next = shrunk.row;
    }
  }

  const fixed = reconcileRegions(model, new Map([...work.values()].map((s) => [s.row.index, s.next.tokens])));
  if (!fixed.ok) return fixed;

  const category = [];
  for (const [field, n] of fixed.overrides) {
    const cp = categoryPatch(model, field, n);
    if (!cp.ok) return cp;
    category.push(cp);
  }

  const foreignRow = [...work.values()].map((s) => s.row).find((r) => r.foreign)?.range?.file ?? null;

  /*
   * KHÔNG có văn bản = lời gọi dò FILE của `moveControlFiles`.
   *
   * Vòng luẩn quẩn quen thuộc: muốn ghi thì phải đọc file, muốn biết đọc file nào thì phải
   * tính xong. Mọi phần trên đây chạy được bằng model thuần, nên tới đây đã biết đủ tên file —
   * trả danh sách rồi để tầng vỏ mở, xong nó gọi lại với `getText` thật.
   */
  if (typeof getText !== 'function') {
    const files = [...work.values()].map((s) => s.row.range?.file).filter(Boolean);
    return { ok: true, patches: category, files: [...new Set([...files, ...category.map((c) => c.file)])], warning: foreignRow, pinned: fixed.pinned };
  }

  const written = rowRewritePatches(model, [...work.values()], getText);
  if (!written.ok) return written;

  const patches = [...written.patches, ...category];
  if (patches.length === 0) return { ok: false, reason: msg('common.no_change') };

  return {
    ok: true,
    patches,
    /*
     * Hỏi trước khi ghi vào BẤT KỲ file nào không phải file đang mở — không riêng hàng đến từ
     * Include. Phần pattern có thể rơi vào một khai báo `&ENTITY;`, và sửa ở đó là đổi cho mọi
     * controller dùng chung nó; im lặng đúng ở chỗ ấy là loại hỏng đắt nhất của cả tính năng.
     */
    warning: foreignRow
      ?? patches.map((x) => x.file).find((f) => f && model.hostFile && f !== model.hostFile)
      ?? null,
    pinned: fixed.pinned,
    moved: resolved.length,
  };
}

/**
 * Đối chiếu từng patch với văn bản THẬT rồi trả danh sách splice cho tầng vỏ.
 *
 * Phép so nguyên văn này là thứ DUY NHẤT chặn việc ghi nhầm chỗ khi offset đã cũ (người dùng vừa
 * gõ tay vào XML, hay một Include vừa đổi). Không bao giờ được bỏ.
 */
function verifyPatches(built, getText) {
  if (!built.ok) return built;

  const edits = [];
  for (const p of built.patches) {
    const text = getText(p.file);
    if (typeof text !== 'string') {
      return { ok: false, reason: msg('edit.file_unread', { file: p.file }) };
    }
    const actual = text.slice(p.splice.start, p.splice.end);

    if (p.dropRow) {
      // Bỏ hẳn thẻ `<item>`: dải phải THẬT SỰ là một thẻ item, lệch là offset đã cũ.
      if (!/^<item\b[^>]*>$/i.test(actual.trim())) {
        return {
          ok: false,
          reason: msg('edit.drop_expect_mismatch', { p0: actual.slice(0, 40) }),
        };
      }
      const line = lineSpanAround(text, p.splice.start, p.splice.end);
      edits.push({ file: p.file, start: line.start, end: line.end, text: '' });
      continue;
    }

    if (actual !== p.expect) {
      return {
        ok: false,
        reason: msg('edit.patch_expect_mismatch', { actual, expect: p.expect }),
      };
    }
    edits.push({ file: p.file, ...p.splice });
  }

  if (edits.length === 0) return { ok: false, reason: msg('common.no_change') };
  return {
    ok: true,
    edits,
    warning: built.warning ?? null,
    pinned: built.pinned ?? [],
    wrote: built.patches.filter((p) => p.wrote).map((p) => p.wrote),
    dropAnchor: built.dropAnchor,
    dropPreferred: built.dropPreferred,
    moved: built.moved,
  };
}

/**
 * DỜI một control sang hàng khác / vùng khác / tab khác — hoặc sang cột khác trong cùng hàng.
 *
 * @param op       {item, cell, toItem, toCol}
 * @param getText  (file) => string|null — tầng vỏ đọc sẵn, core không chạm đĩa
 */
export function planMoveControl(model, op, getText) {
  return verifyPatches(buildMovePatches(model, op, getText), getText);
}

/**
 * Dời khối theo NỬA split — ghi lại giá trị của từng dòng trong dải bị ảnh hưởng.
 *
 * Đọc lại nửa từ VĂN BẢN NGUỒN chứ không từ model: token viết bằng entity (`[&Revert.Field.0;]`)
 * chỉ còn nguyên văn ở đó. Lấy từ model là ghi ra bản đã bung, tức lặng lẽ cắt đứt một tham
 * chiếu dùng chung mà không ai yêu cầu — cùng lý do `planSplitHalfCascade` cũng đọc từ nguồn.
 */
function planMoveRowBlockHalf(model, { items, toItem, side, half }, getText) {
  const plan = planHalfBlock(model, { items, toItem, side, half });
  if (!plan.ok) return plan;

  const widths = plan.region.widths;
  const other = half === 'left' ? 'right' : 'left';

  const parsed = new Map();
  const read = (row) => {
    if (parsed.has(row.index)) return parsed.get(row.index);
    if (!row.range) {
      const bad = { ok: false, reason: msg('edit.row_pos_unknown', { index: row.index }) };
      parsed.set(row.index, bad);
      return bad;
    }
    const text = typeof getText === 'function' ? getText(row.range.file) : null;
    const got = typeof text === 'string'
      ? sourceRow(row, text, model)
      : { ok: false, reason: msg('edit.file_unread', { file: row.range.file }) };
    parsed.set(row.index, got);
    return got;
  };

  const edits = [];
  let warning = null;
  for (const { row, fromRow } of plan.span) {
    const here = read(row);
    if (!here.ok) return here;
    const there = read(fromRow);
    if (!there.ok) return there;
    if (row.foreign) warning = row.range.file;

    const moved = takeRowHalf(there.parsed, widths, plan.split, half);
    const stay = takeRowHalf(here.parsed, widths, plan.split, other);
    const merged = joinRowHalves(
      half === 'left' ? moved : stay,
      half === 'left' ? stay : moved,
      widths, plan.split, here.parsed,
    );
    const text = serializeRow({
      ...merged,
      pattern: reindentPattern(here.parsed.patternRaw, merged.pattern),
    });
    if (text === here.value) continue;
    edits.push({
      file: row.range.file,
      start: row.range.start,
      end: row.range.end,
      text,
      expect: here.value,
    });
  }

  if (edits.length === 0) return { ok: false, reason: msg('common.no_change') };

  // Đối chiếu nguyên văn trước khi ghi — cùng chốt với mọi phép sửa hàng khác.
  for (const e of edits) {
    const text = getText(e.file);
    if (typeof text !== 'string') return { ok: false, reason: msg('edit.file_unread', { file: e.file }) };
    const actual = text.slice(e.start, e.end);
    if (actual !== e.expect) {
      return { ok: false, reason: msg('edit.patch_expect_mismatch', { actual, expect: e.expect }) };
    }
  }

  return {
    ok: true,
    edits: edits.map(({ file, start, end, text }) => ({ file, start, end, text })),
    warning,
    pinned: [],
    moved: [...new Set((items ?? []).map(Number))].length,
  };
}

/**
 * Dời NỬA hàng khi vùng có `view@split` — phần tính được mà KHÔNG cần văn bản nguồn.
 *
 * Vì sao phải có phép riêng: một `<item>` của vùng split là HAI nửa nằm chung một dòng XML.
 * Dời cả thẻ `<item>` (`planMoveRowBlock` thường) là kéo luôn nửa bên kia đi theo — người dùng
 * chọn ba hàng ở cột trái, thả xuống, và ba hàng bên phải cũng đổi thứ tự dù không ai đụng
 * vào chúng. Runtime vẽ hai nửa như hai bảng độc lập, nên designer cũng phải sửa được từng nửa.
 *
 * Phép này KHÔNG dời dòng nào cả: số hàng đứng yên, chỉ NỬA ĐANG CHỌN xoay vòng giữa các dòng
 * trong dải bị ảnh hưởng — đúng như runtime nhìn thấy. Nửa kia của mỗi dòng ở nguyên chỗ cũ.
 *
 * @returns {{ok:true, region, split, span:Array<{row, fromRow}>}|{ok:false, reason:string}}
 */
function planHalfBlock(model, { items, toItem, side = 'before', half }) {
  if (half !== 'left' && half !== 'right') {
    return { ok: false, reason: msg('edit.block_half_mixed') };
  }
  const uniq = [...new Set((items ?? []).map(Number))]
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  if (uniq.length < 1) return { ok: false, reason: msg('edit.block_min_rows') };

  const region = (model.regions ?? []).find((r) => r.rows.some((x) => x.index === uniq[0]));
  if (!region) return { ok: false, reason: msg('edit.region_unknown') };

  const split = Number(region.split);
  if (!Number.isFinite(split) || split <= 0 || split >= region.widths.length) {
    return { ok: false, reason: msg('edit.block_half_no_split') };
  }

  const rows = [...region.rows].sort((a, b) => a.index - b.index);
  const posOf = (index) => rows.findIndex((r) => r.index === index);

  const blockPos = uniq.map(posOf);
  if (blockPos.some((i) => i < 0)) return { ok: false, reason: msg('edit.block_half_out_of_region') };
  for (let i = 1; i < blockPos.length; i++) {
    if (blockPos[i] !== blockPos[i - 1] + 1) return { ok: false, reason: msg('edit.block_not_contiguous') };
  }

  const destPos = posOf(Number(toItem));
  if (destPos < 0) return { ok: false, reason: msg('edit.block_half_out_of_region') };
  if (blockPos.includes(destPos)) return { ok: false, reason: msg('common.no_change') };

  const lo = Math.min(blockPos[0], destPos);
  const hi = Math.max(blockPos[blockPos.length - 1], destPos);

  // Hàng nhúng lưới Detail cắt ngang cụm form — nửa của nó không phải một nửa hàng nhập, và
  // xoay nó vào giữa cụm chứng từ là trộn hai thứ không cùng loại. Cùng chốt chặn với
  // `planSplitHalfCascade`.
  for (let i = lo; i <= hi; i++) {
    if (rowHasEmbeddedGrid(rows[i], model)) return { ok: false, reason: msg('edit.block_half_grid') };
  }

  const seq = [];
  for (let i = lo; i <= hi; i++) seq.push(i);
  const inBlock = new Set(blockPos);
  const rest = seq.filter((i) => !inBlock.has(i));
  const at = rest.indexOf(destPos) + (side === 'after' ? 1 : 0);
  const next = [...rest.slice(0, at), ...blockPos, ...rest.slice(at)];

  const span = seq.map((slot, k) => ({ row: rows[slot], fromRow: rows[next[k]] }))
    .filter((x) => x.row.index !== x.fromRow.index);
  if (span.length === 0) return { ok: false, reason: msg('common.no_change') };

  // Dải bị ảnh hưởng gồm cả hàng cho lẫn hàng nhận, để tầng vỏ mở đủ file trước khi ghi.
  const touched = seq.map((slot) => rows[slot]);
  return { ok: true, region, split, half, span, touched };
}

/**
 * Dời một KHỐI hàng `<item>` liền kề (Shift+click nhiều hàng) tới trước/sau hàng đích.
 *
 * Khác `planMoveControl`: không gỡ token khỏi pattern rồi nhét sang hàng khác — cả thẻ `<item>`
 * đi nguyên, các hàng còn lại dịch theo trong file. Chỉ nhận hàng liền kề trên file nguồn.
 *
 * @param op {items:number[], toItem:number, side?:'before'|'after'}
 */
export function planMoveRowBlock(model, { items, toItem, side = 'before', half = null }, getText) {
  // Vùng có `view@split` và người dùng chọn gọn trong MỘT nửa → chỉ nửa ấy xoay, xem
  // `planHalfBlock`. Không có `half` thì vẫn là phép dời cả thẻ `<item>` như cũ.
  if (half === 'left' || half === 'right') {
    return planMoveRowBlockHalf(model, { items, toItem, side, half }, getText);
  }
  const uniq = [...new Set((items ?? []).map(Number))]
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  if (uniq.length < 2) return { ok: false, reason: msg('edit.block_min_rows') };

  const blockRows = uniq.map((i) => model.rows.find((r) => r.index === i));
  if (blockRows.some((r) => !r)) return { ok: false, reason: msg('edit.block_row_missing') };
  if (blockRows.some((r) => !r.itemRange)) {
    return { ok: false, reason: msg('edit.block_item_unknown') };
  }

  const file = blockRows[0].itemRange.file;
  if (blockRows.some((r) => r.itemRange.file !== file)) {
    return { ok: false, reason: msg('edit.block_multi_file') };
  }

  const dest = model.rows.find((r) => r.index === toItem);
  if (!dest?.itemRange) return { ok: false, reason: msg('edit.row_item_not_found', { item: toItem }) };
  if (dest.itemRange.file !== file) {
    return { ok: false, reason: msg('edit.block_target_file') };
  }
  if (uniq.includes(toItem)) return { ok: false, reason: msg('common.no_change') };

  const text = typeof getText === 'function' ? getText(file) : null;
  if (typeof text !== 'string') {
    return { ok: false, reason: msg('edit.source_unread') };
  }

  const spans = blockRows
    .map((r) => lineSpanOfItem(text, r.itemRange))
    .sort((a, b) => a.start - b.start);
  for (let i = 1; i < spans.length; i++) {
    const gap = text.slice(spans[i - 1].end, spans[i].start);
    if (!/^[\r\n \t]*$/.test(gap)) {
      return { ok: false, reason: msg('edit.block_not_contiguous') };
    }
  }

  const blockStart = spans[0].start;
  const blockEnd = spans[spans.length - 1].end;
  const blockText = text.slice(blockStart, blockEnd);
  if (blockText.trim() === '') return { ok: false, reason: msg('edit.block_empty') };

  const destSpan = lineSpanOfItem(text, dest.itemRange);
  const insertAt = side === 'after' ? destSpan.end : destSpan.start;
  if (insertAt > blockStart && insertAt < blockEnd) {
    return { ok: false, reason: msg('edit.drop_inside_block') };
  }

  let splice;
  if (insertAt <= blockStart) {
    splice = {
      start: insertAt,
      end: blockEnd,
      text: blockText + text.slice(insertAt, blockStart),
    };
  } else {
    splice = {
      start: blockStart,
      end: insertAt,
      text: text.slice(blockEnd, insertAt) + blockText,
    };
  }

  if (splice.text === text.slice(splice.start, splice.end)) {
    return { ok: false, reason: msg('common.no_change') };
  }

  return {
    ok: true,
    edits: [{ file, start: splice.start, end: splice.end, text: splice.text }],
    warning: blockRows.find((r) => r.foreign)?.range?.file
      ?? (blockRows.find((r) => r.foreign) ? file : null),
    pinned: [],
    moved: uniq.length,
  };
}

/** Thẻ `<item>` + thụt lề dòng + xuống dòng sau thẻ — đơn vị dịch chuyển cả hàng. */
function lineSpanOfItem(text, itemRange) {
  const lineStart = text.lastIndexOf('\n', itemRange.start - 1) + 1;
  let end = itemRange.end;
  if (text.slice(end, end + 2) === '\r\n') end += 2;
  else if (text[end] === '\n') end += 1;
  return { start: lineStart, end };
}

/** ĐỔI CHỖ hai control, cùng hàng hoặc khác hàng. @param op {item, cell, toItem, other} */
export function planSwapControl(model, op, getText) {
  return verifyPatches(buildSwapPatches(model, op, getText), getText);
}

/**
 * ĐỔI CHỖ HAI DẢI CỘT — cụm nào cũng được, miễn hai dải cùng SỐ CỘT. Xem
 * `buildSwapBlockPatches` để biết vì sao đo bằng cột chứ không ghép control với control.
 * @param op {a:{item,col,span}, b:{item,col,span}}
 */
export function planSwapBlock(model, op, getText) {
  return verifyPatches(buildSwapBlockPatches(model, op, getText), getText);
}

/**
 * File nào tầng vỏ phải mở trước khi gọi `planMoveControl` / `planSwapControl`.
 *
 * Chạy đúng phần THUẦN rồi gom `file` của từng patch — không đoán, không mở thừa. Kế hoạch hỏng
 * thì trả mảng rỗng và để hàm plan nói lý do, chứ không nói hộ ở đây.
 */
export function moveControlFiles(model, op) {
  if (op.kind === 'moveBlock') {
    // Dời theo nửa split đụng CẢ DẢI giữa khối và hàng đích, không chỉ khối với đích: mỗi dòng
    // trong dải nhận nửa của dòng kế bên. Mở thiếu một file là phép so nguyên văn từ chối.
    if (op.half === 'left' || op.half === 'right') {
      const plan = planHalfBlock(model, op);
      if (!plan.ok) return [];
      return [...new Set(plan.touched.map((r) => r.range?.file).filter(Boolean))];
    }
    const rows = (op.items ?? []).map((i) => model.rows.find((r) => r.index === i)).filter(Boolean);
    const dest = model.rows.find((r) => r.index === op.toItem);
    const files = [...rows, dest].map((r) => r?.itemRange?.file ?? r?.range?.file).filter(Boolean);
    return [...new Set(files)];
  }
  const built = op.kind === 'swapBlock'
    ? buildSwapBlockPatches(model, op)
    : op.kind === 'swap' ? buildSwapPatches(model, op) : buildMovePatches(model, op);
  if (!built.ok) return [];
  // Đổi chỗ trả sẵn `files` khi gọi mà chưa có văn bản — xem cuối `buildSwapGroupPatches`.
  return [...new Set([...(built.files ?? []), ...built.patches.map((p) => p.file)])];
}

/**
 * Xoá một control CÙNG với Label / Footer / Description của nó — lối Shift+Delete.
 *
 * Khác `planRowEdit({kind:'remove'})` ở hai chỗ, và cả hai là lý do nó phải là hàm riêng:
 *
 *   1. Nó đụng NHIỀU HÀNG. `[x].Description` hay nằm ở hàng dưới, `[x].Footer` ở hàng cuối vùng
 *      — cùng một control nhưng ba thẻ `<item>` khác nhau. Một splice không nói hết được.
 *   2. Mỗi hàng nằm ở một FILE khác nhau được: hàng chính ở controller, hàng phụ ở Include.
 *      Nên nó nhận `getText(file)` chứ không nhận một `sourceText`.
 *
 * Chỉ ô INPUT mới kéo theo cả cụm. Bấm Shift+Delete trên chính ô `.Label` thì chỉ ô đó đi —
 * xoá cả control vì người dùng nhắm vào cái nhãn là làm nhiều hơn họ yêu cầu.
 *
 * Mốc để tìm lại ô sau mỗi lần cắt là CỘT (`cell.col`), không phải chỉ số ô: bỏ một ô trải 2
 * cột biến nó thành HAI ô trống, nên mọi chỉ số phía sau chạy đi một nấc. Cột thì đứng yên.
 *
 * @param getText  (file) => string|null — văn bản nguồn của từng file có hàng bị đụng
 * @returns {{ok:true, edits:Array<{file,start,end,text}>, warning:string|null, fieldName:string|null}
 *          |{ok:false, reason:string}}
 */
export function planRemoveControl(model, { item, cell, companions = false }, getText) {
  const row = model.rows.find((r) => r.index === item);
  if (!row) return { ok: false, reason: msg('edit.row_not_found') };
  const target = row.cells?.[cell];
  if (!target || target.empty || !target.token) return { ok: false, reason: msg('common.empty_delete') };

  const name = target.token.field;
  const takeAll = companions === true && target.token.kind === 'input' && !!name;

  // (hàng → cột cần bỏ). Ô đang chọn luôn có mặt; cụm đi kèm chỉ khi Shift.
  const byRow = new Map();
  const mark = (r, col) => {
    if (!byRow.has(r.index)) byRow.set(r.index, { row: r, cols: new Set() });
    byRow.get(r.index).cols.add(col);
  };
  mark(row, target.col);

  if (takeAll) {
    for (const r of model.rows) {
      for (const c of r.cells ?? []) {
        if (!c.token || c.empty) continue;
        if (c.token.field !== name) continue;
        if (!COMPANION_KINDS.has(c.token.kind)) continue;
        mark(r, c.col);
      }
    }
  }

  const edits = [];
  let warning = null;
  for (const { row: r, cols } of byRow.values()) {
    if (!r.range) return { ok: false, reason: msg('edit.row_pos_unknown', { index: r.index }) };
    const text = getText(r.range.file);
    if (typeof text !== 'string') {
      return { ok: false, reason: msg('edit.file_unread', { file: r.range.file }) };
    }
    const src = sourceRow(r, text, model);
    if (!src.ok) return { ok: false, reason: msg('edit.row_reason', { index: r.index, reason: src.reason }) };

    let current = src.parsed;
    // Giảm dần theo cột: hai ô cùng hàng thì bỏ ô phải trước, ô trái sau — cột của ô trái không
    // bị lay chuyển bởi việc ô phải biến thành `-`.
    for (const col of [...cols].sort((a, b) => b - a)) {
      const { cells } = buildCells(current, r.widths);
      const idx = cells.findIndex((c) => c.col === col && !c.empty);
      if (idx === -1) continue; // đã đi cùng một ô trải nhiều cột ở vòng trước
      const done = removeCell(current, r.widths, idx, { allowEntity: true });
      if (!done.ok) return { ok: false, reason: msg('edit.row_reason', { index: r.index, reason: done.reason }) };
      current = done.row;
    }

    const drop = emptyRowSplice(r, current, text);
    const next = drop ?? { start: r.range.start, end: r.range.end, text: serializeRow(current) };
    if (!drop && next.text === src.value) continue; // hàng này rốt cuộc không đổi gì

    edits.push({ file: r.range.file, ...next });
    if (src.warning) warning = warning ?? src.warning;
  }

  if (edits.length === 0) return { ok: false, reason: msg('common.no_change') };
  return { ok: true, edits, warning, fieldName: name ?? null };
}
