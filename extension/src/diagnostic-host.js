// diagnostic-host.js — đưa cảnh báo của core vào Problems panel của VS Code.
//
// Core đã sinh ra chừng ba mươi luật cảnh báo từ lâu, nhưng chúng chỉ chạy tới hai chỗ: một
// danh sách trong webview designer, và vài dòng trong Output Channel. Cả hai đều đòi người dùng
// phải MỞ một thứ ra mới thấy. File này là chỗ chúng thành gạch đỏ ngay trong editor, kể cả khi
// designer không mở.
//
// KHÔNG gate license, có chủ ý. Mọi lệnh nghiệp vụ đi qua `withLicense`, nhưng chẩn đoán thì
// không: người chưa kích hoạt mà mở file XML ra và không thấy gì cả sẽ không hiểu vì sao — im
// lặng là một câu trả lời tệ hơn cả một lời từ chối.
//
// ═══ BỐN QUYẾT ĐỊNH, đừng "dọn gọn" mất khi sửa file này ═══
//
// 1. GỘP THEO FILE, KHÔNG GHI ĐÈ THEO FILE.
//    Một file Include được nhiều controller kéo vào. `DiagnosticCollection.set(uri, …)` THAY
//    TOÀN BỘ danh sách của uri đó, nên nếu mỗi controller tự gọi `set` lên file Include chung
//    thì controller chạy sau xoá sạch chẩn đoán của controller chạy trước — và cái mất đi lại
//    im lặng, không có dấu hiệu gì. Nên kết quả giữ RIÊNG theo từng controller
//    (`byController`), và mỗi lần đổi thì dựng lại HỢP của mọi controller cho từng file bị
//    chạm (`recompute`). Đây là phần dễ làm sai nhất của cả file.
//
// 2. QUY OFFSET VỀ DÒNG/CỘT TRÊN ĐÚNG CHUỖI ĐÃ SINH RA OFFSET ẤY.
//    Controller đang mở thì `buildPayload` đọc `document.getText()` — bản trong editor, có thể
//    đang dirty. File Include thì nó đọc qua `core.readSource` — bản TRÊN ĐĨA, giải mã theo bộ
//    giải mã của core (windows-1258 và bạn bè). Hai bộ giải mã khác nhau cho cùng một file có
//    thể ra hai chuỗi khác nhau, nên tuyệt đối không được đổi chỗ: dùng
//    `vscode.workspace.openTextDocument` cho Include là để VS Code giải mã lại theo cấu hình
//    của NÓ, và gạch đỏ lệch cột ở mọi dòng có ký tự ngoài ASCII đứng trước.
//    Hệ quả đã biết và chấp nhận: Include đang sửa dở CHƯA LƯU thì chẩn đoán tính trên bản đã
//    lưu, nên gạch có thể lệch cho tới lúc Ctrl+S. Đó đúng là hành vi của designer hôm nay
//    (`cachedReadFile` đọc đĩa), và hai bên nói khác nhau về cùng một file còn tệ hơn.
//
// 3. `severity: 'info'` KHÔNG VÀO PROBLEMS.
//    Hiện chỉ có một luật ở mức ấy — `grid.no_base_css` — và nó là lỗi NẠP TÀI NGUYÊN CỦA
//    EXTENSION, không phải khiếm khuyết của file người dùng đang mở. Đặt nó vào Problems là chỉ
//    tay vào một file không có gì sai và bảo người ta đi sửa. Nó ở lại Output Channel.
//
// 4. DÙNG LẠI `buildPayload`, KHÔNG TỰ TÍNH LẤY.
//    Cảnh báo phụ thuộc cả `loadDetail` (lưới nhúng trong tab) lẫn `gridConfig` (hai file cấu
//    hình ẩn không ai nhắc tên). Tự dựng một đường tính riêng cho gọn là hai đường nói hai
//    chuyện khác nhau về cùng một file — đúng cái mà đầu `render-host.js` đã cảnh báo.
//    `skipHtml` bỏ đúng phần dựng HTML và giữ nguyên toàn bộ model cộng cảnh báo, nên nó vừa
//    vặn ở đây.

const vscode = require('vscode');
const { buildPayload, config, isControllerDocument, cachedReadFile } = require('./render-host');
const { entryOf, positionAt: offsetToPos } = require('./text-position');

/**
 * Gõ một phím là một lượt bung entity cộng quét lại toàn bộ Include. Chờ cho người ta gõ xong
 * một nhịp rồi hãy chạy — Problems nhấp nháy theo từng phím còn khó đọc hơn là chậm một nhịp.
 */
const DEBOUNCE_MS = 300;

/** Windows không phân biệt hoa thường trong đường dẫn; mọi phép so file đi qua đây. */
const keyOf = (p) => String(p ?? '').toLowerCase();

/**
 * `info` cố ý KHÔNG có mặt — xem quyết định 3 ở đầu file. Mức lạ cũng rơi vào cùng nhánh ấy và
 * được ghi ra Output, chứ không âm thầm hoá thành Warning: một mức chưa ai nghĩ tới mà tự
 * chuyển thành cái gần nhất là giấu mất chỗ cần sửa.
 */
const SEVERITY = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
};

/** Offset → `vscode.Position`. Phép quy ở `text-position.js`, dùng chung với «đi tới định nghĩa». */
function positionAt(entry, offset) {
  const p = offsetToPos(entry, offset);
  return new vscode.Position(p.line, p.character);
}

/**
 * Dải cho cảnh báo KHÔNG CÓ `range` — cả dòng đầu của controller.
 *
 * `range: null` là một câu trả lời hợp lệ của core, không phải chỗ còn thiếu (cảnh báo
 * `arrangement` đọc chuỗi từ `Grid/Config`, một file mà `segments` không phủ). Neo vào dòng 1
 * là nói «có chuyện với file này, nhưng không chỉ được vào đâu» — trung thực hơn hẳn một dải
 * bịa ra, thứ trông y hệt một dải thật.
 */
function wholeFirstLine(entry) {
  if (entry.starts.length <= 1) {
    return new vscode.Range(new vscode.Position(0, 0), positionAt(entry, entry.text.length));
  }
  // `starts[1] - 1` là vị trí của LF. Trên file CRLF thì ký tự ngay trước nó là CR, và CR KHÔNG
  // thuộc nội dung dòng theo cách VS Code đếm — dừng ở đó là dải phủ thêm một ký tự vô hình.
  let end = entry.starts[1] - 1;
  if (end > 0 && entry.text.charCodeAt(end - 1) === 13) end -= 1;
  return new vscode.Range(new vscode.Position(0, 0), positionAt(entry, end));
}

/**
 * Khoá trùng lặp. Cùng một khiếm khuyết trong một file Include được MỌI controller kéo file ấy
 * vào cùng báo lên; hiện năm lần cho một dòng hỏng là năm lần bắt người đọc kiểm tra lại cùng
 * một chỗ. Khiếm khuyết là của FILE, không phải của từng controller.
 */
function dedupeKey(d) {
  const r = d.range;
  return `${d.code}|${r.start.line}:${r.start.character}|${r.end.line}:${r.end.character}|${d.message}`;
}

class DiagnosticHost {
  constructor(core, output) {
    this.core = core;
    this.output = output;
    this.collection = vscode.languages.createDiagnosticCollection('fboDesigner');

    /** controllerKey → Map<fileKey, {file, items: vscode.Diagnostic[]}> */
    this.byController = new Map();
    /** controllerKey → Set<fileKey> — file nào đã GÓP vào bản chẩn đoán của controller ấy. */
    this.sources = new Map();
    /** fileKey → đường dẫn nguyên văn (để dựng lại Uri sau khi mọi controller đã bỏ file đó). */
    this.paths = new Map();
    /** controllerKey → Timeout đang chờ. */
    this.pending = new Map();
  }

  /**
   * Chạy chẩn đoán cho một controller.
   *
   * Ném thì GIỮ NGUYÊN kết quả lần trước. Đang gõ dở một thẻ XML là trạng thái bình thường của
   * một file đang được sửa, và xoá trắng Problems mỗi lần văn bản tạm thời không quét được sẽ
   * làm cả bảng nhấp nháy đúng vào lúc người ta cần nó nhất.
   */
  runFor(document) {
    if (!isControllerDocument(document)) return;
    const file = document.uri.fsPath;

    let payload;
    try {
      payload = buildPayload(this.core, document, {
        cfg: config(),
        paths: this.core.resolveProgramPaths(file),
        // Sink CÂM, có chủ ý: `buildPayload` in mọi chẩn đoán entity ra Output, và ở đây nó
        // chạy lại sau mỗi nhịp gõ. Ba dòng mỗi 300ms là nhấn chìm kênh Output bằng đúng thứ
        // vừa được hiện tử tế hơn ở Problems.
        output: { appendLine() {} },
        skipHtml: true,
      });
    } catch (err) {
      this.output.appendLine(`chẩn đoán bỏ qua ${file}: ${err && err.message}`);
      return;
    }

    const readFile = cachedReadFile(this.core);
    const texts = new Map();
    /** Chuỗi + bảng đầu dòng của một file, theo đúng bộ giải mã đã sinh ra offset (quyết định 2). */
    const textFor = (target) => {
      const k = keyOf(target);
      if (texts.has(k)) return texts.get(k);
      const raw = k === keyOf(file) ? document.getText() : readFile(target);
      const entry = typeof raw === 'string' ? entryOf(raw) : null;
      texts.set(k, entry);
      return entry;
    };

    const perFile = new Map();
    const all = [...(payload.warnings ?? []), ...(payload.diagnostics ?? [])];
    for (const w of all) {
      const severity = SEVERITY[w.severity];
      if (severity === undefined) {
        this.output.appendLine(`[${w.severity}] ${w.code}: ${w.message}`);
        continue;
      }
      // Không có dải thì cảnh báo thuộc về chính controller — nó là thứ ta đang xét.
      const target = w.range ? w.range.file : file;
      const entry = textFor(target);
      // Đọc không được thì không đặt được gạch ở đâu cả. Đẩy sang controller là gán một lỗi của
      // file khác vào file này.
      if (!entry) {
        this.output.appendLine(`không đọc được ${target} để đặt chẩn đoán ${w.code}`);
        continue;
      }

      const range = w.range
        ? new vscode.Range(positionAt(entry, w.range.start), positionAt(entry, w.range.end))
        : wholeFirstLine(entry);
      const d = new vscode.Diagnostic(range, w.message, severity);
      d.source = 'FBO Designer';
      d.code = w.code;

      const k = keyOf(target);
      if (!this.paths.has(k)) this.paths.set(k, target);
      if (!perFile.has(k)) perFile.set(k, { file: target, items: [] });
      perFile.get(k).items.push(d);
    }

    this.sources.set(keyOf(file), new Set((payload.sourceFiles ?? []).map(keyOf)));
    this.publish(file, perFile);
  }

  /** Thay phần đóng góp của MỘT controller, rồi dựng lại hợp cho mọi file bị chạm. */
  publish(controllerPath, perFile) {
    const ck = keyOf(controllerPath);
    const before = this.byController.get(ck);
    this.byController.set(ck, perFile);

    // Cả file lần này chạm LẪN file lần trước chạm: thiếu vế sau thì một cảnh báo vừa được sửa
    // xong vẫn nằm lại trong Problems, vì không ai bảo VS Code bỏ nó đi.
    const touched = new Set([...(before ? before.keys() : []), ...perFile.keys()]);
    for (const k of touched) this.recompute(k);
  }

  /** Hợp của MỌI controller cho một file, đã bỏ trùng. Xem quyết định 1. */
  recompute(fileKey) {
    const seen = new Set();
    const items = [];
    for (const perFile of this.byController.values()) {
      const bucket = perFile.get(fileKey);
      if (!bucket) continue;
      for (const d of bucket.items) {
        const k = dedupeKey(d);
        if (seen.has(k)) continue;
        seen.add(k);
        items.push(d);
      }
    }
    const p = this.paths.get(fileKey);
    if (!p) return;
    const uri = vscode.Uri.file(p);
    if (items.length === 0) this.collection.delete(uri);
    else this.collection.set(uri, items);
  }

  /**
   * Controller đóng lại thì bỏ phần đóng góp của nó.
   *
   * Giữ lại thì chẩn đoán ấy đứng mãi mà KHÔNG CÒN ĐƯỜNG làm mới: chỉ tính lại được khi
   * controller đang mở. Một cảnh báo không bao giờ tự biến mất dù người ta đã sửa xong là thứ
   * dạy người dùng thôi tin cả bảng Problems.
   */
  drop(controllerPath) {
    const ck = keyOf(controllerPath);
    const before = this.byController.get(ck);
    if (!before) return;
    this.byController.delete(ck);
    this.sources.delete(ck);
    for (const k of before.keys()) this.recompute(k);
  }

  /**
   * Controller nào đã ĐỌC file này? Câu trả lời là `sourceFiles` của lần chạy trước — bản đồ
   * chính xác, không phải phép đoán theo tên thư mục.
   *
   * Cần nó vì sửa một file Include phải làm mới MỌI controller kéo file ấy vào; thiếu vế này
   * thì sửa xong lỗi trong Include mà gạch đỏ vẫn nằm nguyên cho tới khi mở lại controller.
   */
  controllersReading(path) {
    const k = keyOf(path);
    const out = [];
    for (const [ck, files] of this.sources) if (files.has(k)) out.push(ck);
    return out;
  }

  dispose() {
    for (const t of this.pending.values()) clearTimeout(t);
    this.pending.clear();
    this.collection.dispose();
  }
}

/**
 * Mọi controller ĐANG MỞ chịu ảnh hưởng khi `path` đổi — chính nó (nếu là controller), cộng mọi
 * controller đã kéo nó vào.
 *
 * Chỉ xét tài liệu đang mở, vì chỉ chúng mới có văn bản để mà tính. Đó cũng là cái trần tự
 * nhiên cho khối lượng công việc: sửa một Include dùng chung không kéo theo cả trăm controller
 * trên đĩa, chỉ những cái người dùng thật sự đang làm việc cùng.
 */
function affectedDocuments(host, path) {
  const wanted = new Set(host.controllersReading(path));
  wanted.add(keyOf(path));
  return vscode.workspace.textDocuments.filter(
    (d) => isControllerDocument(d) && wanted.has(keyOf(d.uri.fsPath)),
  );
}

function registerDiagnostics(context, core, output) {
  const host = new DiagnosticHost(core, output);
  context.subscriptions.push(host);

  const cancel = (ck) => {
    const t = host.pending.get(ck);
    if (t) { clearTimeout(t); host.pending.delete(ck); }
  };

  const runNow = (path) => {
    for (const doc of affectedDocuments(host, path)) {
      cancel(keyOf(doc.uri.fsPath));
      host.runFor(doc);
    }
  };

  const runSoon = (path) => {
    for (const doc of affectedDocuments(host, path)) {
      const ck = keyOf(doc.uri.fsPath);
      cancel(ck);
      host.pending.set(ck, setTimeout(() => {
        host.pending.delete(ck);
        host.runFor(doc);
      }, DEBOUNCE_MS));
    }
  };

  /*
   * Controller đã mở sẵn từ phiên trước — VS Code khôi phục chúng TRƯỚC khi extension bật, nên
   * không có sự kiện `onDidOpen` nào cho chúng cả. Không quét ở đây thì Problems trống trơn cho
   * tới khi người dùng gõ một phím vào từng file.
   *
   * Nhưng KHÔNG quét ngay trong `activate`: mỗi controller là một lượt bung entity cộng quét
   * toàn bộ Include nó kéo vào, và VS Code thì CHỜ `activate` xong. Ai khôi phục một phiên đang
   * mở hai chục controller sẽ trả cái giá ấy bằng một khoảng treo lúc mở IDE — đúng ấn tượng
   * đầu tiên không nên có. Đẩy sang nhịp sau để `activate` trả về ngay.
   */
  const initial = setTimeout(() => {
    for (const doc of vscode.workspace.textDocuments) host.runFor(doc);
  }, 0);
  context.subscriptions.push({ dispose: () => clearTimeout(initial) });

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((doc) => host.runFor(doc)),
    vscode.workspace.onDidChangeTextDocument((e) => runSoon(e.document.uri.fsPath)),
    // Lưu là một hành động có chủ ý, và là lúc bản trên đĩa vừa khớp lại với bản trong editor —
    // chạy ngay, không chờ nhịp debounce.
    vscode.workspace.onDidSaveTextDocument((doc) => runNow(doc.uri.fsPath)),
    vscode.workspace.onDidCloseTextDocument((doc) => host.drop(doc.uri.fsPath)),
  );

  return host;
}

/*
 * `positionAt`/`wholeFirstLine` xuất ra CHO TEST.
 *
 * Chúng là phần thuần của file này — không đụng vscode ngoài hai lớp `Position`/`Range`, nên
 * kiểm được mà không cần một cửa sổ editor nào. Phép quy offset → dòng/cột mà sai thì mọi gạch
 * đỏ lệch chỗ, và đó là kiểu sai không ai nhìn ra bằng mắt trên một file vài nghìn dòng.
 */
module.exports = {
  registerDiagnostics,
  DiagnosticHost,
  SEVERITY,
  positionAt,
  wholeFirstLine,
  keyOf,
};
