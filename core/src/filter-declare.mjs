// filter-declare.mjs — khai báo LỌC NHANH cho một lưới: sinh dòng `sysfilterdeclares` và
// các splice XML đi kèm.
//
// Vì sao cần cả hai vế: ô lọc trên màn hình chỉ hiện ra khi XML khai đủ ba thứ
// (`allowFilter`, `<query>&InsertCommandFilter;</query>`, và `<query event="Declare">`), còn
// điều kiện người dùng gõ vào ô đó chỉ dịch được thành SQL khi database `sys` có dòng tương
// ứng trong `sysfilterdeclares`. Thiếu vế XML thì không có ô để gõ; thiếu vế database thì gõ
// xong lọc không ra gì. Hai vế phải đi cùng nhau, nên chúng nằm cùng một file.
//
// ĐƯỜNG ĐI CỦA MỘT ĐIỀU KIỆN LỌC (đọc từ `Include\FilterInitialize.xml` của FBISP24):
//
//   1. người dùng gõ vào ô lọc của cột `ten_kh`
//   2. client sinh   insert into #filter select 'ten_kh', 0, N'(((((ÿten_kh like N''%Tổng%'')))))'
//      — `ÿ` là `char(255)`, chỗ giữ sẵn cho tên cột thật
//   3. `FilterInitialize` join `#filter` với `sysfilterdeclares` theo
//         b.controller = &Controller;  và  a.field = replace(b.name, '%2', '%l')
//      rồi thay `ÿten_kh` bằng `%[a].` + `exname` (hoặc chính tên field nếu không khai exname)
//   4. `FastBusiness$System$GetDynamicFilter` đổi `%[a]` thành alias thật và ghép ra mệnh đề
//         a left join m64$%Partition m3 on … left join dmkh m1 on m3.ma_kh = m1.ma_kh
//         where … (isnull(m1.ten_kh, '') like N'%Tổng%') …
//
// Nên `sysfilterdeclares` KHÔNG lưu câu SQL — nó lưu bản đồ «field trên màn hình → bảng nào,
// join bằng khoá nào». Sinh sai bản đồ ấy thì lọc chạy nhưng ra sai dữ liệu, tệ hơn hẳn lọc
// không chạy. Đó là lý do mỗi dòng ở đây mang theo `confidence` và `notes`.
//
// NGUỒN CỦA MỌI LUẬT TRONG FILE NÀY là hai stored proc, không phải suy từ dữ liệu:
//
//   `FastBusiness$System$GetDynamicFilter`  đọc `#_f` (đã nạp từ `sysfilterdeclares`) rồi dựng
//        mệnh đề join thật. Ba điều nó nói ra mà không nhìn vào là không đoán được:
//
//        · `#_f.datasource = isnull(b.xtable, '')`, và MỌI phép dựng join đều lọc
//          `datasource <> '' and datasource <> '%inquiryTable'`. Nên `xtable` trống = KHÔNG
//          join gì cả, cột đọc thẳng từ hàng gốc `a`; `%inquiryTable` = chính bảng gốc ấy.
//        · dòng có `xtable` mà KHÔNG có `fieldkey` được nối bằng
//          `left join <xtable> <alias> on a.stt_rec = <alias>.stt_rec`.
//        · `joinClause` bị thay CHUỖI: `replace(replace(joinClause, 'a.', <refalias>+'.'),
//          'b.', <alias>+'.')`. Nên nó BẮT BUỘC viết bằng đúng hai alias `a` và `b` — chép
//          alias của file (`e1`, `m3`) sang là runtime ghép ra một câu trỏ vào alias không có.
//
//   `FastBusiness$App$Voucher$Finding`      lời gọi mang mệnh đề join của lưới dưới dạng chuỗi
//        hằng — nguồn duy nhất trong file nói ra «alias nào là bảng nào». Xem `scanFindingJoin`.
//
// LUẬT CỦA FILE NÀY: thuần, không chạm đĩa, không nối database. Nó trả về DỮ LIỆU (dòng khai
// báo + splice + script). Ghi file, chạy SQL, hỏi người dùng là việc của tầng vỏ — cùng giao
// kèo với `edit.mjs`.

import { findInternalSubset } from './entities.mjs';
import { msg, SQL_CONFIG } from './msg.mjs';


const RE_ATTR = /([\w:%.-]+)\s*=\s*(["'])([\s\S]*?)\2/g;

function attrsOf(attrText) {
  const attrs = {};
  RE_ATTR.lastIndex = 0;
  let m;
  while ((m = RE_ATTR.exec(attrText)) !== null) {
    if (!(m[1] in attrs)) attrs[m[1]] = m[3];
  }
  return attrs;
}

/**
 * `<partition table="c21$000000" prime="m21$" inquiry="i21$" …/>` — bản khai CHIA KỲ của lưới
 * chứng từ.
 *
 * `prime` là tiền tố bảng master (`m21$`), `inquiry` là bảng tra nhanh (`i21$`), `table` là
 * bảng chi tiết. Câu lọc runtime nhắc tới bảng master dưới dạng `m21$%Partition` — `%Partition`
 * là chỗ giữ để runtime cắm hậu tố kỳ vào, không phải một cái tên bảng có thật.
 */
export function scanPartition(text) {
  const m = /<partition\b([^>]*?)\/?>/i.exec(text);
  if (!m) return null;
  const a = attrsOf(m[1]);
  return {
    table: a.table ?? null,
    prime: a.prime ?? null,
    inquiry: a.inquiry ?? null,
    field: a.field ?? null,
    primeTable: a.prime ? `${a.prime}%Partition` : null,
    // `increase`/`default` trần — thô, không diễn giải gì thêm ở đây. `add-column.mjs` đọc hai
    // thứ này để phân biệt "chia kỳ thật" (bảng xoay theo tháng/năm) với "khai <partition> nhưng
    // bảng tĩnh" (VD `prime="bid02$000000"` hay `prime="bigia01"`, `default=""`) — filter-declare
    // không cần phân biệt vì `%Partition` là chỗ giữ hợp lệ cho cả hai trường hợp.
    increase: a.increase ?? null,
    default: a.default ?? null,
  };
}

/**
 * Bảng ghép alias → bảng, đọc từ chuỗi join trong `<query event="Finding">`.
 *
 * Câu Finding của lưới chứng từ là một lời gọi `exec FastBusiness$App$Voucher$Finding` với
 * mệnh đề join truyền vào dưới dạng MỘT chuỗi hằng:
 *
 *   'a left join dmkh b on a.ma_kh = b.ma_kh'
 *
 * Đó chính là chỗ duy nhất trong controller nói ra «cột `ten_kh` lấy từ bảng nào, nối bằng
 * khoá nào» — `<field aliasName="b">` chỉ trỏ tới alias, không nói alias ấy là bảng gì.
 *
 * GIỚI HẠN PHẢI NÓI RÕ: trong FBISP24 chỉ 31/401 câu Finding của `Grid/` là văn bản thường;
 * 370 câu còn lại nằm trong `<![CDATA[<Encrypted>…</Encrypted>]]>`. Với chúng, hàm này trả
 * `ok:false` kèm lý do — KHÔNG đoán. Con số 31 ấy phần lớn là controller đã customize, tức
 * đúng loại file người ta thêm lọc vào; nên giới hạn này hẹp hơn vẻ ngoài của nó.
 */
export function scanFindingJoin(text) {
  const q = /<query\s+event="Finding"\s*>([\s\S]*?)<\/query>/i.exec(text);
  if (!q) return { ok: false, base: 'a', joins: [], reason: msg('filter.no_finding_query') };
  if (/<Encrypted>/i.test(q[1])) {
    return {
      ok: false,
      base: 'a',
      joins: [],
      reason: msg('filter.finding_encrypted'),
    };
  }

  /*
   * Lời gọi Finding có NHIỀU HƠN MỘT mệnh đề join, và bản trước chỉ đọc cái đầu tiên.
   *
   * Mệnh đề chính đi ở một tham số; phần mở rộng hoá đơn điện tử đi ở một tham số KHÁC, tận
   * cuối lời gọi — `&EIGridQuery;` của `Include\Invoice.ent` bung ra đúng ba tham số:
   *
   *     , 'stt_rec, so_seri_hddt, so_ct_hddt, tinh_trang_hddt, xac_thuc'   cột lấy từ bảng EI
   *     , 'hddt00$'                                                        tiền tố bảng chia kỳ
   *     , ' left join hddt00$ e1 on a.stt_rec = e1.stt_rec
   *         left join dmtthddt e2 on e1.tinh_trang_hddt = e2.status'       mệnh đề join của EI
   *
   * Chỉ lấy chuỗi đầu là `e1`/`e2` không tra ra bảng nào, và mọi cột hoá đơn điện tử rơi xuống
   * nhánh «alias lạ» — sinh ra dòng khai `char(254)` + biểu thức thay vì khai bảng nguồn.
   *
   * Gom HẾT mọi chuỗi hằng có chữ `join`. Các chuỗi hằng còn lại của lời gọi là danh sách cột
   * (`'stt_rec, so_ct'`) nên không dính: `\bjoin\b` có neo biên từ, một cột tên `join_date`
   * không khớp.
   */
  const literals = [...q[1].matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1]);
  const clauses = literals.filter((s) => /\bjoin\b/i.test(s));
  if (clauses.length === 0) {
    return { ok: false, base: 'a', joins: [], reason: msg('filter.no_joins') };
  }

  // Alias gốc chỉ được khai ở mệnh đề CHÍNH (`a left join …`). Mệnh đề EI mở đầu thẳng bằng
  // `left join`, nên đọc alias gốc từ nó là ra chữ `left`.
  let base = null;
  const joins = [];
  const RE_JOIN = /\b(?:(left|right|inner|full)\s+)?(?:outer\s+)?join\s+([\w$#%.[\]]+)\s+(\w+)\s+on\s+([\s\S]+?)(?=\s+(?:left|right|inner|full|cross)?\s*(?:outer\s+)?join\b|$)/gi;

  for (const clause of clauses) {
    const lead = /^\s*(\w+)\s+(?:(?:left|right|inner|full|cross)\s+)?(?:outer\s+)?join\b/i.exec(clause);
    if (lead && base === null) base = lead[1];

    RE_JOIN.lastIndex = 0;
    let j;
    while ((j = RE_JOIN.exec(clause)) !== null) {
      const on = j[4].trim();
      // Khoá join lấy từ vế `X.col = Y.col` ĐẦU TIÊN. Join nhiều điều kiện (`… and m3.status =
      // m2.status`) vẫn giữ nguyên `on` đầy đủ ở `joinclause`; chỉ cặp khoá chính mới tách ra.
      const keys = /(\w+)\.(\w+)\s*=\s*(\w+)\.(\w+)/.exec(on);
      joins.push({
        kind: (j[1] ?? 'inner').toLowerCase(),
        table: j[2],
        alias: j[3],
        on,
        leftAlias: keys?.[1] ?? null,
        leftKey: keys?.[2] ?? null,
        rightAlias: keys?.[3] ?? null,
        rightKey: keys?.[4] ?? null,
      });
    }
  }

  const clause = clauses.join(' ');
  if (joins.length === 0) {
    return { ok: false, base: base ?? 'a', joins: [], reason: msg('filter.parse_join_fail', { clause }) };
  }
  return { ok: true, base: base ?? 'a', joins, clause, reason: null };
}

/**
 * Tên controller — khoá join của `sysfilterdeclares`.
 *
 * Runtime truyền `&Controller;` vào câu lọc, và trong corpus entity ấy hầu như luôn được khai
 * là `<!ENTITY Controller "&TransferID;">` với `<!ENTITY TransferID "SOTran">`. Đọc từ chính
 * khai báo entity chứ không suy từ tên file: có controller mà tên file khác `TransferID`, và
 * lấy nhầm là mọi dòng sinh ra join hụt.
 */
export function scanControllerName(text, fallback = '') {
  const subset = findInternalSubset(text);
  const scope = subset && subset.subsetStart !== -1
    ? text.slice(subset.subsetStart, subset.subsetEnd)
    : text;
  const direct = /<!ENTITY\s+Controller\s+"([^"]*)"/i.exec(scope)?.[1];
  const transfer = /<!ENTITY\s+TransferID\s+"([^"]*)"/i.exec(scope)?.[1];
  if (direct && !/^&/.test(direct)) return direct;
  if (direct && /^&TransferID;$/i.test(direct.trim()) && transfer) return transfer;
  if (transfer) return transfer;
  return fallback;
}

/** `ten_kh%l` → `ten_kh%2`: `sysfilterdeclares.name` lưu `%2`, runtime đổi ngược lại khi join. */
function toDeclaredName(fieldName) {
  return String(fieldName ?? '').replace(/%l/gi, '%2');
}

/*
 * Hai ký tự MỐC của tầng lọc, đọc từ `FilterInitialize`:
 *
 *   `char(255)` (ÿ) chỗ giữ cho tên cột trong `#filter.conditional`. Client sinh
 *                   `(((ÿten_kh like N'%x%')))`, runtime thay `ÿten_kh` bằng `m1.ten_kh`.
 *   `char(254)` (þ) cờ «exname ĐÃ có alias của riêng nó». Runtime kiểm
 *                   `charindex(char(254), exname) > 0` rồi bỏ tiền tố `%[a].`. Thiếu cờ này thì
 *                   một biểu thức như `rtrim(e2.statusname)` bị ghép thành `%[a].rtrim(e2.…)`.
 */
const MARK_COLUMN = 'ÿ';
const MARK_OWN_ALIAS = 'þ';

/**
 * Bảng tra nhanh của lưới chứng từ, dưới dạng CHỖ GIỮ — runtime cắm tên thật vào.
 *
 * `sysfilterdeclares` của bản chuẩn viết đúng chuỗi này ở `reftable` cho mọi cột join xuất phát
 * từ bảng inquiry (đo trên `SVTran` của SEAVNFBO: `SVTran.CreatedBy` → `%inquiryTable`). Nó
 * KHÔNG phải `i81$%Partition`: bảng inquiry không chia kỳ.
 */
const INQUIRY_TABLE = '%inquiryTable';

/**
 * SÁU cột nằm sẵn trên bảng inquiry của MỌI lưới `type="Voucher"`.
 *
 * Không phải suy đoán, cũng không phải thứ phải hỏi database từng chương trình: bảng inquiry
 * (`i??$…`) có schema CỐ ĐỊNH trong cả sản phẩm. Đo trên `i81$000000` của SEAVNFBO, nó có đúng
 * mười cột — sáu cột dưới đây cộng bốn cột sổ sách `c$ m$ d$ e$` mà không màn hình nào lọc theo.
 *
 * Vì sao chúng khiến `xtable` phải TRỐNG, đọc từ `FastBusiness$System$GetDynamicFilter`:
 *
 *   `#_f.datasource` nhận `isnull(b.xtable, '')`, và mọi phép dựng join của proc đều lọc
 *   `datasource <> '' and datasource <> '%inquiryTable'`. Nên `xtable` trống nghĩa là KHÔNG
 *   join gì cả — cột đọc thẳng từ hàng gốc `a`. Khai một `xtable` cho chúng là bắt proc
 *   `left join` thêm bảng master chỉ để lấy một cột đã nằm sẵn trong tay.
 *
 * Ngược lại, cột KHÔNG có ở đây mà nằm trên bảng master thì phải khai `xtable` — proc nối nó
 * bằng `left join <xtable> <alias> on a.stt_rec = <alias>.stt_rec` cho những dòng không có
 * `fieldkey`. Đó là lý do `ma_kh`, `t_tt_nt`, `ma_nt` đều mang `m81$%Partition`.
 *
 * Đối chiếu trên 115 controller lưới Voucher của SEAVNFBO: 357 dòng khai đúng theo luật này,
 * 17 dòng lệch (màn hình có bảng gốc không phải bảng inquiry chuẩn). Nên đây là MẶC ĐỊNH tốt,
 * không phải luật tuyệt đối — `inquiryColumns` vẫn ghi đè được.
 */
const VOUCHER_INQUIRY_COLUMNS = ['stt_rec', 'ngay_ct', 'so_ct', 'ma_dvcs', 'status', 'user_id0'];

/** Lưới chứng từ — bảng gốc của nó là bảng inquiry, xem `VOUCHER_INQUIRY_COLUMNS`. */
function isVoucherText(text) {
  return /<grid\b[^>]*\btype\s*=\s*(["'])Voucher\1/i.test(String(text ?? ''));
}

/**
 * Tên bảng CHIA KỲ luôn viết dưới dạng chỗ giữ `<tiền tố>$%Partition`, không bao giờ viết trần.
 *
 * `%Partition` là chỗ runtime cắm hậu tố kỳ vào (`hddt00$` → `hddt00$202601`). Câu Finding thì
 * viết tên TRẦN vì nó đã ở trong ngữ cảnh của một kỳ cụ thể — `left join hddt00$ e1 on …` — nên
 * chép thẳng tên ấy sang `sysfilterdeclares` là khai một bảng không tồn tại ở tầng lọc.
 *
 * Đo trên toàn bộ `sysfilterdeclares` của SEAVNFBO: 0 dòng có `xtable` hay `reftable` kết thúc
 * bằng `$` mà thiếu `%Partition`; 1176 dòng mang `%Partition`. Không có ngoại lệ nào.
 *
 * Hai dạng cùng quy về một: `hddt00$` (tên trần trong câu join) và `m81$000000` (tên đã cắm kỳ,
 * hay gặp ở `<grid table=…>`).
 */
function partitionName(table) {
  const t = String(table ?? '').trim();
  if (t === '') return t;
  if (/\$\d+$/.test(t)) return t.replace(/\$\d+$/, '$%Partition');
  return t.endsWith('$') ? `${t}%Partition` : t;
}

const isPartition = (table) => /%Partition$/.test(String(table ?? ''));

/** `ten_kh%l` / `ten_kh%2` → `ten_kh`. Cột trong database không mang hậu tố ngôn ngữ. */
function baseColumn(name) {
  return String(name ?? '').replace(/%\w+$/, '');
}

/**
 * Mệnh đề join viết lại theo cặp alias `a` / `b` mà runtime trông đợi.
 *
 * `joinclause` trong `sysfilterdeclares` LUÔN dùng `a` cho bảng nguồn và `b` cho bảng được
 * join tới — đo trên toàn bộ 38 dòng của `SVTran`, không có ngoại lệ. Nhưng mệnh đề trong
 * `<query event="Finding">` dùng alias do chính file đặt (`e1`, `m3`, `b`…), và chép nguyên
 * văn sang là runtime ghép ra một câu tham chiếu alias không tồn tại.
 *
 * Đổi trong MỘT lượt bằng hàm thay: đổi tuần tự thì cặp alias đảo nhau (`b` → `a` rồi `a` → `b`)
 * sẽ gộp cả hai về cùng một chữ.
 */
function normalizeJoinClause(on, leftAlias, rightAlias) {
  const text = String(on ?? '').trim();
  if (text === '' || !leftAlias || !rightAlias) return text || null;
  const map = new Map([[leftAlias, 'a'], [rightAlias, 'b']]);
  const re = new RegExp(`\\b(${[leftAlias, rightAlias].map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\s*\\.`, 'g');
  return text.replace(re, (m, alias) => `${map.get(alias)}.`)
    // `a.ma_kh = b.ma_kh` → `a.ma_kh=b.ma_kh`: bản chuẩn viết sát, và giữ cho diff giữa bản
    // sinh ra với bản Fast phát hành so được bằng mắt.
    .replace(/\s*=\s*/g, '=')
    .replace(/\s+/g, ' ');
}

/**
 * `aliasName` của FBO mang HAI nghĩa, và phân biệt sai là sinh ra dòng vô dụng.
 *
 *   `aliasName="b"`                     một alias trần → cột lấy từ bảng mà alias ấy trỏ tới
 *   `aliasName="rtrim(e1.so_ct_hddt)"`  một BIỂU THỨC SQL → chính nó là `exname`
 *
 * Cả hai đều có thật trong `Grid/ARTran.xml` của FBISP24, cùng một file.
 */
function readAliasName(raw, base) {
  const value = String(raw ?? '').trim();
  if (value === '') return { alias: base, expression: null, column: null };
  if (/^\w+$/.test(value)) return { alias: value, expression: null, column: null };

  /*
   * Biểu thức bọc MỘT tham chiếu cột thì BÓC RA, không giữ nguyên khối.
   *
   * `aliasName="rtrim(e1.so_ct_hddt)"` không phải một biểu thức tự do — nó là «cột
   * `so_ct_hddt` trên alias `e1`», gói trong `rtrim()` cho phần hiển thị. Khi `e1` tra ngược
   * được về một phép join trong câu Finding thì bản khai đúng là khai CÁI JOIN ẤY
   * (`xtable`/khoá), còn `rtrim()` bị bỏ đi — tầng lọc không cần nó, và bản chuẩn của Fast cũng
   * không giữ nó (`SVTran.AuthenticationReferenceNumber` khai `exname` TRỐNG).
   *
   * Bản trước gói cả `rtrim(e1.so_ct_hddt)` vào `exname` kèm cờ `char(254)` và bỏ trống mọi cột
   * nguồn. Đó là hình dạng của một biểu thức KHÔNG tra được — sai hẳn với ca này, và hậu quả là
   * bảng `hddt00$` không bao giờ được join vào câu lọc.
   *
   * Hai dạng bóc được: `f(alias.cot)` và `alias.cot` trần. Tên cột cho phép `%` vì hậu tố ngôn
   * ngữ nằm ngay trong đó (`rtrim(e2.statusname%l)`).
   */
  const one = /^\s*\w+\s*\(\s*(\w+)\s*\.\s*([\w$%]+)\s*\)\s*$/.exec(value)
    || /^\s*(\w+)\s*\.\s*([\w$%]+)\s*$/.exec(value);
  if (one) return { alias: one[1], expression: value, column: one[2] };

  // Biểu thức thật sự phức tạp (`case when …`, phép tính): chỉ lấy được alias, không bóc được
  // cột. Nó đi đường `char(254)` — xem `exname`.
  return { alias: /(\w+)\s*\./.exec(value)?.[1] ?? null, expression: value, column: null };
}

const typeOf = (field) => String(field?.attrs?.type ?? '').toLowerCase();

const TEXTUAL = (field) => {
  const t = typeOf(field);
  return t === '' || t === 'string' || t === 'varchar' || t === 'nvarchar';
};

/** Cột số — `isnull(..., 0)` thay cho `isnull(..., '')`. Xem `conditionalreplace`. */
const NUMERIC = (field) => ['decimal', 'int', 'integer', 'money', 'numeric', 'float', 'double']
  .includes(typeOf(field));

/**
 * Dựng danh sách dòng `sysfilterdeclares` cho một lưới.
 *
 * @param {string} text        văn bản controller ĐÃ BUNG entity
 * @param {object} opts
 *   `fields`      mảng field của `scanFields`
 *   `columns`     tên các cột muốn khai lọc; bỏ trống = mọi field có `allowFilter="true"`
 *   `controller`  ép tên controller; bỏ trống thì đọc từ entity
 *   `stem`        tên file không đuôi, dùng làm phương án cuối cho tên controller
 *
 * Mỗi dòng mang `confidence`:
 *   `joined`     — field trỏ tới một alias CÓ trong câu Finding: bảng, khoá, mệnh đề join đều đọc
 *                  được từ file, không suy gì
 *   `base`       — field nằm trên alias gốc (`a`). Không cần join, nhưng cũng KHÔNG phân biệt
 *                  được cột nằm ở bảng inquiry hay bảng master: cả hai cùng mang alias `a` trong
 *                  XML. Runtime phân biệt bằng `xtable`, thứ file không nói ra.
 *   `temp-table` — bảng được join tới đọc được, nhưng là bảng TẠM CỤC BỘ (`#…`). Không khai
 *                  `xtable`/khoá nào: bảng đó nhiều khả năng chỉ sống trong đúng phiên chạy
 *                  Loading/Finding của controller, còn "Lọc nhanh" gọi `GetDynamicFilter` ở một
 *                  lời gọi riêng — khai vào là chắc lỗi "Invalid object name" lúc chạy.
 *   `unknown`    — field trỏ tới alias không có trong câu Finding, hoặc câu Finding không đọc được.
 */
export function buildFilterDeclarations(text, {
  fields = [],
  columns = null,
  controller = null,
  stem = '',
  inquiryColumns = null,
} = {}) {
  const name = controller || scanControllerName(text, stem);
  const finding = scanFindingJoin(text);
  const partition = scanPartition(text);
  const byAlias = new Map(finding.joins.map((j) => [j.alias, j]));

  /*
   * Cột nào nằm sẵn trên BẢNG INQUIRY — thứ quyết định `xtable` và `reftable`, và là thứ DUY
   * NHẤT ở đây không đọc được từ file XML.
   *
   * Luật đo trên `SVTran` của SEAVNFBO, khớp 38/38 dòng bản chuẩn:
   *
   *   alias gốc `a` CHÍNH LÀ bảng inquiry (`i81$…`), không phải bảng master.
   *     cột có trên inquiry   → `xtable` để TRỐNG; runtime đọc thẳng từ `a`
   *     cột không có          → `xtable` = `<prime>%Partition`; runtime phải với sang master
   *
   *   Đo được: `i81$000000` chỉ có `ma_dvcs, ngay_ct, so_ct, status, user_id0` — và đúng năm
   *   cột ấy là toàn bộ số dòng `xtable` null (`UnitCode`, `VoucherDate`, `VoucherNumber`,
   *   `Status`, và `CreatedBy` join từ `user_id0`). Mọi cột còn lại trên alias `a` — `ma_kh`,
   *   `t_tt_nt`, `ma_nt`, `dien_giai`, … — đều mang `m81$%Partition`.
   *
   * Bảng inquiry là chuyện của DATABASE, file XML không hề nhắc tới nó. Nên danh sách cột phải
   * do người gọi truyền vào. KHÔNG truyền thì rơi về `<prime>%Partition` cho mọi cột gốc, và
   * kèm ghi chú: đoán thừa một bảng master làm runtime join dư một bảng (chậm, vẫn đúng), còn
   * đoán thiếu là cột không tìm thấy và câu lọc nổ. Sai về phía nào cũng phải là phía chạy được.
   */
  const voucher = isVoucherText(text);
  /*
   * Khai tay thắng; không khai thì lưới Voucher dùng bộ cột chuẩn, còn loại lưới khác đành chịu.
   *
   * Bảng gốc của lưới Voucher LUÔN là bảng inquiry với schema cố định, nên bộ sáu cột kia đúng
   * cho mọi chương trình mà không phải hỏi database. Lưới `Detail`/`Inquiry`/`Report` thì bảng
   * gốc là bảng nghiệp vụ của riêng nó (`hrrmyc`, `phrt`, `bim03$…` — đo được trong chính
   * `sysfilterdeclares`), mỗi màn hình một khác; ở đó không có bộ nào để mặc định, và đoán bừa
   * là sinh ra một `xtable` sai mà lọc vẫn chạy.
   */
  const inquiry = inquiryColumns !== null
    ? new Set([...inquiryColumns].map((c) => baseColumn(c).toLowerCase()))
    : (voucher ? new Set(VOUCHER_INQUIRY_COLUMNS) : null);
  const onInquiry = (col) => (inquiry === null ? null : inquiry.has(baseColumn(col).toLowerCase()));

  const wanted = columns
    ? new Set(columns)
    : new Set(fields.filter((f) => String(f.attrs?.allowFilter ?? '').toLowerCase() === 'true').map((f) => f.name));

  const notes = [];
  if (!finding.ok) notes.push(finding.reason);
  if (!name) notes.push('không xác định được tên controller — truyền `controller` vào hoặc khai <!ENTITY Controller>');
  if (!partition?.primeTable && finding.ok) {
    notes.push('controller không có <partition prime="…"> — cột `reftable` để trống');
  }
  if (inquiry === null && partition?.primeTable) {
    notes.push(
      'lưới này không phải type="Voucher" nên không có bộ cột gốc chuẩn nào để dựa vào:'
      + ` mọi cột trên alias gốc đều khai xtable = "${partition.primeTable}". Cột NẰM SẴN trên`
      + ' bảng gốc phải để xtable TRỐNG'
      + (partition.inquiry
        ? ` — chạy: select name from sys.columns where object_id = object_id('${partition.inquiry}000000')`
        : ''),
    );
  } else if (inquiryColumns === null && voucher) {
    notes.push(
      `lưới Voucher: sáu cột ${VOUCHER_INQUIRY_COLUMNS.join(', ')} nằm sẵn trên bảng inquiry nên`
      + ' để xtable TRỐNG; mọi cột gốc còn lại lấy từ bảng master. Màn hình có bảng gốc khác'
      + ' chuẩn thì kiểm lại mấy dòng ấy.',
    );
  }

  /** Bảng mà một phép join xuất phát từ — xem chú thích ở `reftable`. */
  const refTableOf = (join) => {
    if (join.leftAlias && join.leftAlias !== finding.base) {
      // Join BẮC CẦU: xuất phát từ một bảng đã join trước đó, không phải từ bảng gốc.
      // `hddt00$` phải ra `hddt00$%Partition` ở đây — xem `partitionName`.
      const upstream = byAlias.get(join.leftAlias);
      if (upstream) return partitionName(upstream.table);
    }
    if (onInquiry(join.leftKey) === true) return INQUIRY_TABLE;
    return partition?.primeTable ?? null;
  };

  const rows = [];
  for (const field of fields) {
    if (!wanted.has(field.name)) continue;

    const { alias, expression, column } = readAliasName(field.attrs?.aliasName, finding.base);
    /*
     * Biểu thức KHÔNG bóc được thành `alias.cot` thì bỏ luôn phép join, dù alias có tra ra bảng.
     *
     * Hai hình dạng khai báo loại trừ nhau: hoặc khai `xtable` + khoá để proc tự dựng join và
     * tự chắp tiền tố alias, hoặc để `exname` mang cả biểu thức kèm cờ `char(254)` và proc dùng
     * nguyên văn. Trộn cả hai là proc join bảng dưới alias `m3` trong khi biểu thức vẫn gọi
     * `e2.` — một alias không tồn tại trong câu nó vừa ghép.
     *
     * Đo trên 707 dòng có `char(254)` của SEAVNFBO: TẤT CẢ đều bỏ trống `xtable`, `fieldkey`,
     * `reftable`, `joinclause`. Không dòng nào trộn hai hình dạng.
     */
    const join = expression && column === null ? null : (alias ? (byAlias.get(alias) ?? null) : null);
    const label = field.header?.e || field.header?.v || field.name;

    /*
     * Bảng ĐƯỢC JOIN TỚI là bảng TẠM CỤC BỘ (`#…`, không phải bảng tạm TOÀN CỤC `##…`) — biết
     * đủ bảng, đủ khoá, nhưng vẫn KHÔNG được khai `xtable` vào đây.
     *
     * Ca thật: `Grid\SVTran.xml` của HOATP — cột `ten_loai_hd%l` khai `aliasName="c"`, câu
     * `<query event="Finding">` join `left join #invoiceTypeTmp c on a.loai_hd = c.loai_hd`, và
     * NGAY TRÊN dòng exec đó, trong cùng khối CDATA, là `create table #invoiceTypeTmp (…) insert
     * into #invoiceTypeTmp values(…)` — bảng tạm được tự tạo lại mỗi lần chạy Loading/Finding,
     * chỉ sống trong đúng phiên đã tạo ra nó.
     *
     * "Lọc nhanh" không chạy lại Loading/Finding: nó gọi thẳng
     * `FastBusiness$System$GetDynamicFilter` ở MỘT LỜI GỌI HOÀN TOÀN RIÊNG, không đi qua đoạn
     * `create table #invoiceTypeTmp` nói trên. Khai `xtable = "#invoiceTypeTmp"` là chắc chắn ra
     * lỗi "Invalid object name" ngay khi người dùng gõ vào ô lọc — tệ hơn hẳn không khai gì, đúng
     * luật của cả file này (xem đầu file). Bản trước coi mọi bảng tra được từ câu Finding là
     * `xtable` hợp lệ như nhau, không phân biệt bảng tạm.
     */
    const localTemp = join !== null && /^#(?!#)/.test(String(join.table ?? '').trim());
    const usableJoin = join !== null && !localTemp;

    /*
     * Cột nằm trên một bảng CHIA KỲ được join vào: khai MỖI `xtable`, bỏ trống mọi cột khoá.
     *
     * `GetDynamicFilter` tự dựng lấy phép join cho những dòng thiếu `fieldkey`:
     *
     *     left join <datasource> <alias> on a.stt_rec = <alias>.stt_rec
     *
     * Bảng chia kỳ LUÔN nối bằng `stt_rec`, nên khoá và mệnh đề join là thừa — và không phải
     * thừa vô hại: khai `fieldkey` vào là dòng ấy rơi sang nhánh khác của proc, nhánh dựng join
     * theo `joinClause` và còn chạy trước một lượt truy vấn phân giải giá trị.
     *
     * Đo trên `sysfilterdeclares` của SEAVNFBO: 1176 dòng có `xtable` là bảng chia kỳ, và CẢ
     * 1176 đều bỏ trống `fieldkey`, `reftable`, `reffieldkey`, `joinclause`. Không một ngoại lệ.
     *
     * Ca thật: `SVTran.AuthenticationReferenceNumber` — cột `so_ct_hddt` nằm trên `hddt00$`,
     * câu Finding join `a.stt_rec = e1.stt_rec`, và bản chuẩn khai đúng một ô `xtable`.
     * Bản trước chép nguyên `hddt00$` kèm cả `fieldkey=stt_rec` và `joinclause` — sai cả hai vế.
     *
     * Vẫn giữ `conditionalreplace`: cột đến qua `left join` thì vẫn NULL được, y hệt ca thường.
     */
    const joinTable = usableJoin ? partitionName(join.table) : null;
    const viaPartition = usableJoin && isPartition(joinTable);

    let confidence = 'unknown';
    if (localTemp) confidence = 'temp-table';
    else if (join) confidence = 'joined';
    else if (expression) confidence = 'expression';
    else if (finding.ok && alias === finding.base) confidence = 'base';

    const row = {
      // `controller` + `name` là cặp khoá runtime join theo. Sai một trong hai là dòng nằm đó
      // mà không ai đọc tới, và ô lọc gõ vào không ra gì — hỏng im lặng.
      controller: name,
      /*
       * `id` là NHÃN, không phải khoá: câu lọc của `FilterInitialize` không hề đọc `b.id`.
       * Dựng từ nhãn TIẾNG ANH (`<header e>`) chứ không tiếng Việt, vì cột là `varchar` —
       * dấu tiếng Việt bỏ vào một cột varchar dưới collation không phải tiếng Việt là mất dấu.
       */
      // Bản chuẩn viết `SVTran.CustomerName`, `SVTran.PaymentDay(s)` — KHÔNG có dấu cách. Nhãn
      // `<header e="Customer Name">` phải bỏ khoảng trắng mới ra đúng lối ấy.
      id: name ? `${name}.${label.replace(/\s+/g, '')}` : label.replace(/\s+/g, ''),
      name: toDeclaredName(field.name),
      /*
       * `exname` = thứ runtime cắm vào chỗ `ÿ<field>` thay cho tên field.
       *
       * Chỉ điền khi `aliasName` là một BIỂU THỨC — khi ấy biểu thức đã mang alias của riêng
       * nó (`rtrim(e2.statusname%2)`), nên phải gắn cờ `char(254)` để runtime đừng ghép thêm
       * tiền tố `%[a].` vào trước. `aliasName` trần thì để trống: runtime tự dùng tên field.
       */
      /*
       * `exname` = tên cột NGUỒN, khi nó khác tên field trên màn hình.
       *
       * Ba ca, và bản trước gộp nhầm hai ca đầu vào ca thứ ba:
       *
       *   cột cùng tên        `rtrim(e1.so_ct_hddt)` cho field `so_ct_hddt` → TRỐNG. Proc tự
       *                       dùng `a.field`, không cần nói lại.
       *   cột khác tên        `rtrim(e2.statusname%l)` cho field `ten_tt_hddt` → `statusname%2`.
       *                       Trần, KHÔNG `rtrim`, KHÔNG cờ `char(254)`: bảng `dmtthddt` đã được
       *                       khai ở `xtable` nên proc tự chắp alias thật vào (`%[a].`).
       *   biểu thức tự do     `m.dien_giai` mà `m` không tra ra bảng nào → `char(254)` + nguyên
       *                       văn, và proc dùng thẳng không chắp tiền tố.
       *
       * Bản trước đưa CẢ `rtrim(e1.so_ct_hddt)` vào `exname` kèm cờ cho mọi biểu thức, nên hai
       * ca đầu ra sai hình dạng và bảng nguồn không bao giờ được join vào câu lọc.
       */
      exname: usableJoin
        ? (column && baseColumn(column) !== baseColumn(field.name) ? toDeclaredName(column) : null)
        : (expression ? MARK_OWN_ALIAS + toDeclaredName(expression) : null),
      /*
       * `xtable` = bảng CHỨA cột này.
       *
       *   cột join   bảng được join tới (`dmkh`, `dmtt`, `vsysuser`…)
       *   cột gốc    bảng master, TRỪ khi nó nằm sẵn trên bảng inquiry — xem `onInquiry`
       *   khác       để trống: không biết thì đừng khai
       */
      xtable: usableJoin
        ? joinTable
        : (confidence === 'base' && onInquiry(field.name) !== true ? (partition?.primeTable ?? null) : null),
      /*
       * `fieldkey` / `reffieldkey` — HAI ĐẦU của phép join, và bản trước ghép NGƯỢC.
       *
       *   `fieldkey`     khoá trên `xtable`, tức vế `b.` của mệnh đề
       *   `reffieldkey`  khoá trên `reftable`, tức vế `a.`
       *
       * Đo trên `SVTran.AuthenticationStatus`: `xtable=dmtthddt`, `fieldkey=status`,
       * `reftable=hddt00$%Partition`, `reffieldkey=tinh_trang_hddt`, và
       * `joinclause=a.tinh_trang_hddt=b.status`. Tức `a.<reffieldkey>=b.<fieldkey>`.
       *
       * Bản trước lấy `fieldkey = leftKey` và `reffieldkey = rightKey` — đúng ngược lại. Nó
       * KHÔNG lộ ra ở ca thường nhất (`a.ma_kh=b.ma_kh`, hai khoá trùng tên nên đổi chỗ vẫn ra
       * cùng chữ), và chỉ sai khi hai bên đặt tên khác nhau — đúng lúc `user_id0` join với
       * `u_id`. Hỏng im lặng, và im lặng ở đúng những dòng khó kiểm nhất.
       */
      fieldkey: usableJoin && !viaPartition ? join.rightKey : null,
      exfieldkey: null,
      /*
       * `reftable` = bảng mà phép join XUẤT PHÁT TỪ — không phải lúc nào cũng bảng master.
       *
       * Bản trước ghim cứng `<prime>%Partition`. Nhưng `SVTran.CreatedBy` join `vsysuser` từ
       * `user_id0`, mà `user_id0` nằm trên bảng inquiry — bản chuẩn ghi `%inquiryTable`. Ghi
       * bảng master ở đó là runtime join từ một bảng không có cột ấy.
       *
       * Join bắc cầu (alias trái là một join khác, không phải alias gốc) thì lấy bảng của chính
       * join đó.
       */
      reftable: usableJoin && !viaPartition ? refTableOf(join) : null,
      reffieldkey: usableJoin && !viaPartition ? join.leftKey : null,
      joinclause: usableJoin && !viaPartition
        ? normalizeJoinClause(join.on, join.leftAlias, join.rightAlias)
        : null,
      /*
       * `conditionalreplace` bọc cột trước khi so sánh, và nó PHẢI chứa mốc `ÿ`.
       *
       * Đọc kỹ `FilterInitialize`: nó thay `ÿ<field>` trong `#filter.conditional` bằng
       * `conditionalreplace` TRƯỚC, rồi mới thay `ÿ<field>` lần nữa bằng `%[a].<cột>`. Lần thay
       * thứ hai chỉ có chỗ bám nếu bản thân `conditionalreplace` mang lại một cái `ÿ<field>`:
       *
       *   conditionalreplace  isnull(ÿten_kh%2, '')
       *   → thay lần 1        (((isnull(ÿten_kh%l, '') like N'%Tổng%')))
       *   → thay lần 2        (((isnull(%[a].ten_kh%l, '') like N'%Tổng%')))
       *   → GetDynamicFilter  (((isnull(m1.ten_kh, '') like N'%Tổng%')))
       *
       * Viết `isnull(ten_kh%2, '')` không có `ÿ` thì lần thay thứ hai không tìm thấy gì, cột
       * mất tiền tố alias, và câu lọc hoặc nổ «ambiguous column» hoặc lọc nhầm bảng.
       *
       * Vì sao chỉ cột chữ lấy qua join: `left join` cho NULL khi không khớp, và
       * `NULL like N'%x%'` không bao giờ đúng. Cột số và cột ngày KHÔNG bọc — bọc vào là ép
       * kiểu và mọi phép so sánh `>=` / `<=` đổi nghĩa.
       */
      /*
       * Cột SỐ lấy qua join cũng phải bọc, chỉ khác giá trị thay: `0` chứ không phải `''`.
       *
       * Bản trước chỉ bọc cột chữ, với lý do «bọc cột số là ép kiểu và đổi nghĩa `>=`». Lý do
       * ấy sai: `isnull(x, 0)` không ép kiểu gì cả, nó chỉ thay NULL bằng 0 — và bản chuẩn làm
       * đúng thế (`SVTran.PaymentDay(s)` → `isnull(ÿhan_tt, 0)`, cột `han_tt` join từ `dmtt`).
       * Không bọc thì `left join` trả NULL và MỌI phép so sánh đều sai, y hệt ca cột chữ.
       *
       * Cột NGÀY vẫn để trống, và đó là chủ ý: `isnull(ngày, 0)` ra 1900-01-01, một giá trị lọt
       * được vào khoảng lọc «từ ngày … đến ngày …» và kéo theo mọi dòng không khớp join. Bản
       * chuẩn của `SVTran` không có cột ngày nào lấy qua join, nên ở đây không có gì để bắt
       * chước — và đoán thêm ở chỗ này là đổi kết quả lọc chứ không phải làm nó chạy.
       */
      conditionalreplace: usableJoin && (TEXTUAL(field) || NUMERIC(field))
        ? `isnull(${MARK_COLUMN}${toDeclaredName(field.name)}, ${TEXTUAL(field) ? "''" : '0'})`
        : null,
      confidence,
      field: field.name,
      alias,
    };

    /*
     * Join GHÉP NHIỀU ĐIỀU KIỆN: cặp khoá chính không chắc là cặp đứng đầu.
     *
     * `scanFindingJoin` lấy cặp `X.a = Y.b` ĐẦU TIÊN làm khoá. Với join một điều kiện thì đó là
     * cặp duy nhất, không có gì để nhầm. Với join ghép thì không: đo trên toàn bộ 705 dòng có
     * join của SEAVNFBO, 106 dòng ghép bằng `and` mà chỉ 9 dòng có cặp khoá thật đứng đầu —
     * `SVTran.StatusName` chẳng hạn, `joinclause=a.ma_ct=b.ma_ct and a.status=b.status` nhưng
     * `fieldkey=status`, tức cặp THỨ HAI. Vế còn lại (`ma_ct='HDA'`) là `exfieldkey`, thứ không
     * suy được từ mệnh đề join.
     *
     * Nên: vẫn sinh dòng (mệnh đề `joinclause` đầy đủ vẫn đúng), nhưng nói thẳng là cặp khoá và
     * `exfieldkey` phải kiểm tay. Im lặng ở đây là để lại một khoá join sai trong một dòng trông
     * như đã hoàn chỉnh.
     */
    // Chỉ cảnh báo khi ta THẬT SỰ phát khoá ra. Cột qua bảng chia kỳ không khai khoá nào, nên
    // cặp khoá có mơ hồ hay không cũng chẳng ảnh hưởng tới dòng sinh ra.
    if (usableJoin && !viaPartition && /\band\b/i.test(join.on)) {
      row.note = `join ghép nhiều điều kiện ("${join.on.trim()}") — máy lấy cặp khoá ĐẦU TIÊN;`
        + ' kiểm lại fieldkey/reffieldkey, và điền exfieldkey nếu có vế lọc hằng';
      row.confidence = 'compound';
    } else if (confidence === 'temp-table') {
      row.note = `bảng được join tới ("${join.table}") là bảng TẠM CỤC BỘ — nếu nó được tạo`
        + ' ngay trong chính câu Loading/Finding của controller này (`create table #…`/`select …'
        + ' into #…`) thì chỉ sống trong đúng phiên chạy câu đó. "Lọc nhanh" gọi'
        + ' FastBusiness$System$GetDynamicFilter ở một lời gọi HOÀN TOÀN RIÊNG, không đi qua đoạn'
        + ` tạo bảng ấy — khai xtable vào "${join.table}" là chắc lỗi "Invalid object name" ngay`
        + ' khi gõ vào ô lọc. KHÔNG khai gì cho cột này; muốn lọc được thì phải đưa dữ liệu vào'
        + ' một bảng THẬT (danh mục) rồi khai theo bảng đó, hoặc bỏ cột này khỏi lọc nhanh.';
    } else if (confidence === 'base') {
      row.note = `cột nằm trên alias gốc "${alias}" — kiểm lại xem nó ở bảng inquiry hay bảng master`;
    } else if (confidence === 'expression') {
      row.note = `aliasName là biểu thức "${expression}" — đã đưa vào exname kèm cờ char(254);`
        + ` alias "${alias ?? '?'}" của nó không có trong câu Finding nên bảng nguồn phải điền tay`;
    } else if (confidence === 'unknown') {
      row.note = finding.ok
        ? `alias "${alias}" không có trong mệnh đề join của câu Finding`
        : 'không đọc được câu Finding — mọi cột nguồn phải điền tay';
    } else {
      row.note = null;
    }
    rows.push(row);
  }

  return { controller: name, rows, notes, finding, partition };
}

const SQL_COLUMNS = SQL_CONFIG.filterDeclareColumns;

/**
 * `'` → `''`; `null` → `null` (không phải chuỗi rỗng — hai thứ khác nhau với `isnull()`).
 *
 * Hai ký tự mốc `ÿ`/`þ` KHÔNG được viết thẳng vào script mà ghép bằng `char(255)`/`char(254)`.
 * Viết thẳng thì giá trị đi qua một cột `varchar` dưới collation không phải Latin1 là đổi ký
 * tự — và cả tầng lọc dựa vào đúng hai byte ấy để biết chỗ nào thay cột, chỗ nào bỏ tiền tố
 * alias. Ghép bằng `char()` thì script chạy giống nhau ở mọi collation, và người đọc thấy ngay
 * mốc nằm ở đâu.
 */
function sqlLiteral(v) {
  if (v === null || v === undefined || v === '') return 'null';
  const s = String(v);
  const quote = (t) => `'${t.replace(/'/g, "''")}'`;
  if (!s.includes(MARK_COLUMN) && !s.includes(MARK_OWN_ALIAS)) return quote(s);
  return s
    .split(new RegExp(`([${MARK_COLUMN}${MARK_OWN_ALIAS}])`))
    .filter((part) => part !== '')
    .map((part) => {
      if (part === MARK_COLUMN) return 'char(255)';
      if (part === MARK_OWN_ALIAS) return 'char(254)';
      return quote(part);
    })
    .join(' + ');
}

/**
 * Tên database `sys` khai trong `Web.config` của program — tham số `sysDatabase` của
 * `renderFilterDeclareSql` không phải hỏi tay.
 *
 * `Web.config` của MỌI program FBO khai đúng một connection string tên `sysConnectionString` trỏ
 * vào database hệ thống (đối chiếu `WebConfigReader.cs` của DevWorkFlow — cùng tên, cùng chỗ:
 * `<connectionStrings><add name="sysConnectionString" connectionString="…"/>`). Tên database nằm
 * trong `Initial Catalog=` của chuỗi kết nối ấy; `Database=` là từ khoá tương đương ADO.NET chấp
 * nhận cả hai.
 *
 * Thuần: nhận sẵn VĂN BẢN `Web.config`, không tự tìm hay đọc file trên đĩa — việc đó của tầng vỏ,
 * cùng giao kèo với mọi hàm khác trong file này.
 */
export function scanSysDatabaseName(webConfigText, name = 'sysConnectionString') {
  const cs = scanConnectionString(webConfigText, name);
  if (!cs) return null;
  const db = /(?:Initial Catalog|Database)\s*=\s*([^;]+)/i.exec(cs)?.[1]?.trim();
  return db || null;
}

/**
 * Chuỗi kết nối NGUYÊN VĂN theo `name` (`sysConnectionString`/`appConnectionString`) — tách khỏi
 * `scanSysDatabaseName` để `extension/src/sql-host.js` có được CẢ chuỗi (server, Uid, Pwd), không
 * chỉ tên database. Chuỗi trả về có thể còn chứa Uid/Pwd — gọi hàm này thì tự chịu trách nhiệm
 * không log/ghi nó ra bất cứ đâu người khác đọc được (xem đầu `sql-host.js`).
 */
export function scanConnectionString(webConfigText, name = 'sysConnectionString') {
  const text = String(webConfigText ?? '');
  const escName = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // `name=` và `connectionString=` không cố định thứ tự attribute trong thẻ `<add>`, nên thử cả
  // hai chiều thay vì đòi một thứ tự cụ thể.
  const forward = new RegExp(`<add\\b[^>]*\\bname\\s*=\\s*["']${escName}["'][^>]*\\bconnectionString\\s*=\\s*["']([^"']*)["']`, 'i');
  const backward = new RegExp(`<add\\b[^>]*\\bconnectionString\\s*=\\s*["']([^"']*)["'][^>]*\\bname\\s*=\\s*["']${escName}["']`, 'i');
  return forward.exec(text)?.[1] ?? backward.exec(text)?.[1] ?? null;
}

/**
 * Script nạp khai báo. KHÔNG chạy nó ở đây — core không nối database.
 *
 * Ba lựa chọn có chủ ý:
 *
 *   `delete` giới hạn theo ĐÚNG một controller, và nằm trong transaction cùng `insert`. Nạp
 *   lại một controller mà không xoá bản cũ là để lại dòng mồ côi cho những field đã bỏ khai —
 *   chúng vẫn được join và vẫn lọc, trong khi màn hình không còn ô nào cho chúng.
 *
 *   Mọi dòng đều ghi đủ 11 cột, kể cả cột `null`. Bỏ bớt cột là dựa vào default của bảng, thứ
 *   khác nhau giữa các bản cài.
 *
 *   Đầu script là bảng đối chiếu người đọc được, có đánh dấu dòng nào máy suy ra chắc và dòng
 *   nào cần người xem lại. Script này chạy trên database của khách; đọc trước khi chạy là điều
 *   kiện, không phải lời khuyên.
 */
export function renderFilterDeclareSql(rows, {
  sysDatabase = null,
  sourceFile = '',
  controller = null,
  notes = [],
} = {}) {
  const name = controller ?? rows[0]?.controller ?? '';
  const table = sysDatabase ? `${sysDatabase}..sysfilterdeclares` : 'sysfilterdeclares';

  const head = [
    `-- sysfilterdeclares — khai báo lọc nhanh cho controller "${name}"`,
    sourceFile ? `-- sinh từ: ${sourceFile}` : null,
    '-- sinh bởi FBO Designer. ĐỌC LẠI TRƯỚC KHI CHẠY: script này xoá rồi nạp lại toàn bộ',
    `-- khai báo lọc của controller "${name}" trên database sys của khách.`,
    '--',
    '-- Cột nguồn (xtable/fieldkey/reftable/joinclause) suy từ mệnh đề join trong',
    '-- <query event="Finding"> và <partition prime="…">. Mức tin cậy từng dòng:',
  ].filter((l) => l !== null);

  for (const r of rows) {
    // `BẢNG TẠM` đứng riêng: khác «XEM LẠI» (thiếu thông tin, điền tay được), đây là dòng máy
    // biết chắc KHÔNG khai được — không phải chuyện điền thêm tay là xong.
    const mark = r.confidence === 'joined' ? 'chắc  '
      : r.confidence === 'temp-table' ? 'BẢNG TẠM'
      : 'XEM LẠI';
    head.push(`--   ${mark}  ${r.field}${r.note ? ` — ${r.note}` : ''}`);
  }
  if (rows.some((r) => r.confidence !== 'joined' && r.confidence !== 'temp-table')) {
    head.push('--');
    head.push('-- Dòng «XEM LẠI» là dòng máy KHÔNG đọc được nguồn từ file. Điền tay xtable /');
    head.push('-- fieldkey / reftable / reffieldkey / joinclause cho chúng trước khi chạy.');
  }
  if (rows.some((r) => r.confidence === 'temp-table')) {
    head.push('--');
    head.push('-- Dòng «BẢNG TẠM» đọc được nguồn, nhưng bảng đó là bảng tạm cục bộ — không sống');
    head.push('-- qua nổi một lời gọi GetDynamicFilter riêng. KHÔNG điền tay xtable vào đây; xem');
    head.push('-- ghi chú của từng dòng để biết cách xử lý.');
  }
  /*
   * Ghi chú CHUNG của cả lượt sinh cũng phải nằm trong script.
   *
   * Chúng nói những chuyện không thuộc về một dòng nào — «không đọc được câu Finding»,
   * «không biết bảng inquiry có cột gì, kèm câu SQL để tra». Trước đây `buildFilterDeclarations`
   * trả chúng về mà `renderFilterDeclareSql` không nhận, nên thứ duy nhất đến tay người chạy
   * script là bảng đối chiếu từng dòng — và cái cảnh báo quan trọng nhất rơi mất trên đường.
   */
  if (notes.length > 0) {
    head.push('--');
    for (const n of notes) head.push(`-- LƯU Ý: ${n}`);
  }

  const values = rows.map((r) => `  (${SQL_COLUMNS.map((c) => sqlLiteral(r[c])).join(', ')})`);
  const deleteNames = [...new Set(rows.map((r) => r.name).filter((n) => n !== null && n !== undefined && n !== ''))];
  const deleteClause = deleteNames.length > 0
    ? `delete from ${table} where controller = ${sqlLiteral(name)} and name in (${deleteNames.map((n) => sqlLiteral(n)).join(', ')});`
    : `delete from ${table} where controller = ${sqlLiteral(name)};`;

  return [
    head.join('\n'),
    '',
    'begin transaction;',
    '',
    deleteClause,
    '',
    `insert into ${table}`,
    `  (${SQL_COLUMNS.join(', ')})`,
    'values',
    `${values.join(',\n')};`,
    '',
    '-- rollback transaction;   -- bật dòng này thay cho commit để thử trước',
    'commit transaction;',
    '',
  ].join('\n');
}

const INCLUDE_LINE = '  <!ENTITY % Control.Filter SYSTEM "..\\Include\\Filter.Voucher.ent">\n  %Control.Filter;\n';

/**
 * Splice để BẬT lọc nhanh cho một loạt cột trong file XML.
 *
 * Ba chỗ phải sửa, và chúng nằm ở ba phần khác nhau của file:
 *
 *   1. DOCTYPE   `%Control.Filter;` kéo `Filter.Voucher.ent` vào — nguồn của `&GridVoucherAllowFilter;`
 *                và `&InsertCommandFilter;`. Thiếu nó là hai entity kia không phân giải được và
 *                cả file hỏng, chứ không phải "lọc không chạy".
 *   2. `<field>` thêm `allowFilter="&GridVoucherAllowFilter;"` và con `<query>&InsertCommandFilter;</query>`
 *   3. `<queries>` thêm `<query event="Declare"><text>&DeclareCommandFilter;</text></query>` —
 *                bảng tạm `#filter` được tạo ở đây; không có nó thì `insert into #filter` của
 *                từng field nổ ngay câu đầu.
 *
 * Trả về splice trên VĂN BẢN GỐC, đã sắp giảm dần theo `start` để tầng vỏ áp tuần tự mà không
 * phải tự tính lại offset. Chỗ nào đã có sẵn thì bỏ qua, không thêm lần hai.
 *
 * TỪ CHỐI thay vì đoán: file không có `<fields>`, hoặc field cần sửa không tìm thấy, hoặc
 * DOCTYPE không đọc được — trả `ok:false` kèm lý do.
 */
export function planEnableFilter(sourceText, columns, { fields = [] } = {}) {
  const splices = [];
  const notes = [];
  const skipped = [];

  const byName = new Map(fields.map((f) => [f.name, f]));
  for (const col of columns) {
    if (!byName.has(col)) return { ok: false, reason: msg('filter.field_missing', { col }) };
  }

  /*
   * Không chọn cột nào thì KHÔNG đụng vào file.
   *
   * Không có chốt này, `planEnableFilter(text, [])` vẫn thêm `%Control.Filter;` và
   * `<query event="Declare">` — hai khai báo cấp file cho một tập cột rỗng. File đổi mà màn
   * hình không đổi gì, và lần mở sau người đọc không hiểu ai sửa, sửa để làm gì.
   */
  if (columns.length === 0) return { ok: true, splices: [], notes: [], skipped: [] };

  /*
   * Cột khai trong Include thì BỎ QUA, không vá.
   *
   * Có thật trong corpus: `Grid/ARTran.xml` kéo `&EIGridFields;` vào, nên `so_ct_hddt` có mặt
   * trong bản ĐÃ BUNG nhưng không có dòng nào trong chính file. Vá nó nghĩa là sửa
   * `Include\…\EIGridFields`, tức đổi cho MỌI controller include file ấy — trong khi người dùng
   * tưởng mình đang sửa một màn hình. Đó là quyết định của họ, không phải việc designer tự làm.
   *
   * Bỏ qua chứ không từ chối cả lượt: các cột còn lại của chính file này vẫn vá được, và dòng
   * `sysfilterdeclares` cho cột Include vẫn sinh bình thường — nó khoá theo `controller` + `name`,
   * không quan tâm khai báo nằm ở file nào.
   */
  const local = [];
  for (const col of columns) {
    if (findFieldOpenTag(sourceText, col)) local.push(col);
    else skipped.push(`${col}: khai trong Include, không vá ở đây`);
  }
  if (local.length === 0) {
    return {
      ok: true,
      splices: [],
      notes: ['mọi cột đã chọn đều khai trong Include — không có gì để vá tại file này'],
      skipped,
    };
  }

  // 1 — DOCTYPE
  if (!/%Control\.Filter;/.test(sourceText)) {
    const subset = findInternalSubset(sourceText);
    if (!subset || subset.subsetStart === -1) {
      return { ok: false, reason: msg('filter.no_doctype') };
    }
    // Chèn ngay trước dấu `]` đóng subset: entity khai sau cùng vẫn nằm trong subset, và mọi
    // khai báo có sẵn giữ nguyên từng byte.
    splices.push({ start: subset.subsetEnd, end: subset.subsetEnd, text: INCLUDE_LINE });
    notes.push('thêm %Control.Filter; vào DOCTYPE');
  }

  // 2 — từng field
  const ATTR = ' allowFilter="&GridVoucherAllowFilter;"';
  for (const col of local) {
    const field = byName.get(col);
    const open = findFieldOpenTag(sourceText, col);

    const tagEnd = open.start + open.tag.length;
    const needAttr = !/\ballowFilter\s*=/i.test(open.tag);
    const needQuery = (field.query ?? '') === '';
    if (!needAttr) skipped.push(`${col}: đã có allowFilter`);
    if (!needQuery) skipped.push(`${col}: đã có <query>`);
    if (!needAttr && !needQuery) continue;

    /*
     * Thẻ TỰ ĐÓNG phải ra đúng MỘT splice.
     *
     * Nó cần hai thay đổi cùng chạm vào dấu `/>`: chèn attribute ngay trước nó, và đổi nó thành
     * cặp thẻ để có chỗ đặt `<query>`. Tách làm hai splice thì một cái là chèn rộng 0 tại
     * `tagEnd-2` còn cái kia là thay `[tagEnd-2, tagEnd)` — `applySplices` gọi đó là chồng nhau
     * và ném, đúng như nó nên làm. Gộp lại thì không có gì để chồng.
     */
    if (open.selfClosing) {
      const attr = needAttr ? ATTR : '';
      const body = needQuery
        ? `>\n${open.indent}  <query>&InsertCommandFilter;</query>\n${open.indent}</field>`
        : '/>';
      splices.push({ start: tagEnd - 2, end: tagEnd, text: attr + body });
      continue;
    }

    // Thẻ có cặp: hai splice ở hai chỗ rời nhau — ngay trước `>` của thẻ mở, và ngay trước
    // `</field>`.
    if (needAttr) splices.push({ start: tagEnd - 1, end: tagEnd - 1, text: ATTR });
    if (needQuery) {
      const close = sourceText.toLowerCase().indexOf('</field>', tagEnd);
      if (close === -1) return { ok: false, reason: msg('filter.field_unclosed', { col }) };
      splices.push({
        start: close,
        end: close,
        text: `  <query>&InsertCommandFilter;</query>\n${open.indent}`,
      });
    }
  }

  // 3 — <query event="Declare">
  if (!/<query\s+event="Declare"/i.test(sourceText)) {
    const queries = /<queries\b[^>]*>/i.exec(sourceText);
    const block = '    <query event="Declare">\n      <text>&DeclareCommandFilter;</text>\n    </query>\n';
    if (queries) {
      const at = queries.index + queries[0].length;
      splices.push({ start: at, end: at, text: `\n${block}` });
    } else {
      // Không có `<queries>` thì dựng cả khối, đặt ngay trước thẻ đóng gốc. Đặt cuối cùng vì
      // schema của `<grid>` không ràng buộc thứ tự các khối con.
      const rootClose = sourceText.lastIndexOf('</grid>');
      if (rootClose === -1) {
        return { ok: false, reason: msg('filter.no_grid_close') };
      }
      splices.push({
        start: rootClose,
        end: rootClose,
        text: `  <queries>\n${block}  </queries>\n\n`,
      });
    }
    notes.push('thêm <query event="Declare"> tạo bảng tạm #filter');
  }

  // Giảm dần theo `start`: áp từ cuối file lên thì offset của splice chưa áp không đổi.
  splices.sort((x, y) => y.start - x.start);
  return { ok: true, splices, notes, skipped };
}

/**
 * Thẻ mở `<field name="…">` trong VĂN BẢN GỐC, kèm thụt lề của dòng chứa nó.
 *
 * Chỉ tìm TRONG `<fields>`. View của lưới cũng khai `<field name="x"/>` trần, và bắt nhầm bản
 * trần ấy là thêm `allowFilter` vào danh sách cột thay vì vào bản khai — runtime bỏ qua, nên
 * hỏng im lặng đúng kiểu tệ nhất.
 */
function findFieldOpenTag(text, fieldName) {
  const block = /<fields\b[^>]*>([\s\S]*?)<\/fields>/i.exec(text);
  if (!block) return null;
  const offset = block.index + block[0].indexOf(block[1]);
  const inner = block[1];

  const re = /<field\b([^>]*?)(\/?)>/gi;
  let m;
  while ((m = re.exec(inner)) !== null) {
    if (attrsOf(m[1]).name !== fieldName) continue;
    const text_ = text;
    const start = offset + m.index;
    const lineStart = text_.lastIndexOf('\n', start) + 1;
    return {
      start,
      tag: m[0],
      selfClosing: m[2] === '/',
      indent: /^[ \t]*/.exec(text_.slice(lineStart, start))?.[0] ?? '',
    };
  }
  return null;
}
