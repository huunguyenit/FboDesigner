// edit-host.js — nhận ý định sửa từ webview, áp lên file thật.
//
// Ranh giới với core: core TÍNH ra splice (thuần, test được headless), file này ÁP splice và
// làm ba việc mà core cố tình không được làm — đọc/ghi document, hỏi người dùng, và từ chối vì
// lý do thuộc về môi trường (mã hoá file).
//
// Ghi bằng `WorkspaceEdit` chứ không bằng `fs.writeFile`: undo/redo, dirty state, format-on-save
// và cả cái dấu chấm trên tab đều là của VS Code. Tự ghi đĩa là mất sạch những thứ đó, và tệ
// hơn: người dùng bấm Ctrl+Z tưởng đã hoàn tác mà file trên đĩa vẫn giữ bản đã sửa.

const vscode = require('vscode');
const fs = require('node:fs');

const { samePath, loadDetail } = require('./render-host');

/**
 * Mã hoá nào thì GHI ĐƯỢC an toàn.
 *
 * Đây không phải cẩn thận thừa. `docs/P0-QUESTIONS.md` câu 1 hỏi đúng chuyện này và **chưa có
 * câu trả lời**: VS Code có giữ được Windows-1258 khi ghi hay không. Kết cục đáng sợ nhất được
 * ghi thẳng trong đó là "cũ 1258, mới UTF-8" — file thành nửa nọ nửa kia, mở lại vẫn thấy bình
 * thường ở chỗ cũ và chỉ hỏng đúng chỗ vừa sửa, tức hỏng ở nơi khó phát hiện nhất.
 *
 * Nên: chưa trả lời được thì KHÔNG ghi. Toàn bộ corpus FBISP24 (6910 file) là UTF-8 nên luật
 * này không chặn việc thật nào; nó chỉ chặn đúng cái ca chưa ai kiểm chứng.
 *
 * Trả lời xong câu 1 thì nới ở đây, và nới kèm test.
 */
function encodingBlocks(document) {
  const enc = String(document.encoding ?? '').toLowerCase();
  if (enc === '' || enc.startsWith('utf8') || enc.startsWith('utf-8')) return null;
  return `file đang ở mã hoá ${document.encoding} — designer chỉ ghi khi chắc chắn giữ được`
    + ' mã hoá gốc (xem docs/P0-QUESTIONS.md câu 1). Sửa tay trong XML.';
}

/**
 * `.f` là BẢN CHUẨN CỦA SẢN PHẨM — không sửa, không bao giờ.
 *
 * Quy ước FBO: `Dir\X.f` là bản gốc Fast phát hành, `Dir\X.xml` cùng tên là bản customize của
 * khách, và runtime ưu tiên `.xml`. Sửa thẳng vào `.f` là sửa sản phẩm gốc: bản nâng cấp sau sẽ
 * ghi đè mất, và trong lúc đó mọi khách dùng chung bản đó đều lãnh thay đổi này.
 *
 * Đường đi đúng là tạo (hoặc mở) bản `.xml` rồi sửa ở đó. Ở đây chỉ CHẶN và chỉ chỗ — tạo bản
 * customize là một quyết định của người dùng, không phải việc designer tự làm khi họ chỉ định
 * kéo một cái ô.
 */
function productFileBlocks(fsPath) {
  if (!/\.f$/i.test(fsPath)) return null;
  const customized = fsPath.replace(/\.f$/i, '.xml');
  return `${fsPath.split(/[\\/]/).pop()} là bản chuẩn của sản phẩm (.f) — designer không sửa.`
    + ` Tạo bản customize ${customized.split(/[\\/]/).pop()} rồi sửa ở đó.`;
}

/** Đổi offset ký tự thành Range của VS Code. */
function rangeOf(document, start, end) {
  return new vscode.Range(document.positionAt(start), document.positionAt(end));
}

/**
 * Hàng đến từ Include dùng chung: HỎI trước khi ghi.
 *
 * Sửa một hàng trong `Include\XML\…` là sửa cho MỌI controller include file đó. Người dùng
 * đang nhìn một cái form và tưởng mình sửa một cái form; họ phải được nói cho biết.
 */
async function confirmForeign(file, hostPath) {
  if (!file || samePath(file, hostPath)) return true;
  const answer = await vscode.window.showWarningMessage(
    `Chỗ này khai trong ${file.split(/[\\/]/).pop()} — sửa là đổi cho MỌI controller dùng file đó.`,
    { modal: true },
    'Vẫn sửa',
  );
  return answer === 'Vẫn sửa';
}

/**
 * Lập kế hoạch sửa một THUỘC TÍNH trên văn bản của FILE SỞ HỮU nó, rồi ghi vào đúng file đó.
 *
 * Đây là chỗ đã hỏng, và hỏng vì một giả định lặng lẽ: mọi thuộc tính đều nằm trong file đang
 * mở. Sự thật thì không — `Dir/Customer.xml` viết
 * `<view height="&BI.Dir.Height;">`, và `<!ENTITY BI.Dir.Height "302">` nằm ở
 * `Include/BIMode.Customer`. Sau khi bung entity, `heightRange` trỏ vào Include, còn `sourceText`
 * truyền vào lại là văn bản của controller — hai hệ toạ độ khác nhau. Phép so nguyên văn của
 * `planNumericAttr` thấy chữ không khớp và từ chối, ra đúng câu «khai báo height trong file khác
 * bản đã bung».
 *
 * Phép so ấy KHÔNG được bỏ: nó là thứ duy nhất chặn việc ghi đè nhầm chỗ khi offset lệch. Cái
 * phải sửa là đưa cho nó đúng văn bản để so.
 *
 * Và khi file sở hữu KHÁC file đang mở thì phải hỏi lại: sửa `<!ENTITY BI.Dir.Height>` là đổi
 * chiều cao cho MỌI controller dùng entity đó, không riêng màn hình đang nhìn. Cùng một lời hỏi
 * đã dùng cho hàng đến từ Include (`confirmForeign`).
 *
 * @param {{file: string}|null} owner  dải nguồn của thuộc tính, do core gắn sẵn lên model
 * @param {(sourceText: string) => object} plan  hàm lập kế hoạch của core
 */
async function planInOwner(owner, hostDocument, output, plan) {
  const file = owner?.file ?? hostDocument.uri.fsPath;
  const target = await openTarget(file, hostDocument);
  const result = plan(target.getText());
  if (!result.ok) {
    vscode.window.showWarningMessage(`FBO Designer: ${result.reason}`);
    return false;
  }
  return applySplice({
    ...result,
    file: result.file ?? file,
    // `warning` là thứ bật lời hỏi ở `applySplice`; chỉ bật khi thật sự đụng file khác.
    warning: result.warning ?? (samePath(file, hostDocument.uri.fsPath) ? null : file),
  }, hostDocument, output);
}

/** Mở (không hiện) document của file đích — splice có thể nhắm vào một Include chưa mở. */
async function openTarget(file, hostDocument) {
  if (samePath(file, hostDocument.uri.fsPath)) return hostDocument;
  return vscode.workspace.openTextDocument(vscode.Uri.file(file));
}

/**
 * Áp một splice do core tính ra.
 * @returns {Promise<boolean>} đã ghi hay chưa
 */
async function applySplice(plan, hostDocument, output) {
  const target = await openTarget(plan.file, hostDocument);

  const product = productFileBlocks(target.uri.fsPath);
  if (product) {
    vscode.window.showWarningMessage(`FBO Designer: ${product}`);
    return false;
  }

  const blocked = encodingBlocks(target);
  if (blocked) {
    vscode.window.showWarningMessage(`FBO Designer: ${blocked}`);
    return false;
  }
  if (!(await confirmForeign(plan.warning, hostDocument.uri.fsPath))) return false;

  // Cả hai splice vào MỘT WorkspaceEdit. Áp rời thì Ctrl+Z chỉ hoàn tác một nửa và người dùng
  // còn lại một file ở trạng thái chưa từng tồn tại — control đã mất mà `<field>` vẫn còn, hoặc
  // ngược lại. VS Code tự sắp thứ tự các edit không chồng nhau trong cùng một WorkspaceEdit.
  const edit = new vscode.WorkspaceEdit();
  edit.replace(target.uri, rangeOf(target, plan.splice.start, plan.splice.end), plan.splice.text);
  if (plan.extra) {
    edit.replace(target.uri, rangeOf(target, plan.extra.start, plan.extra.end), plan.extra.text);
  }
  const applied = await vscode.workspace.applyEdit(edit);
  if (!applied) {
    vscode.window.showWarningMessage('FBO Designer: VS Code từ chối áp thay đổi.');
    return false;
  }
  output.appendLine(`sửa ${target.uri.fsPath} [${plan.splice.start},${plan.splice.end}) → ${JSON.stringify(plan.splice.text)}`);

  // Lưu luôn. `applyEdit` mới chỉ đổi document trong bộ nhớ; chưa lưu thì file trên đĩa vẫn là
  // bản cũ, và designer đang vẽ từ document nên hai bên nói hai chuyện khác nhau — người dùng
  // thấy form đã đổi mà mở file ra thì chưa. Lưu xong `onDidChangeTextDocument` cũng đã bắn,
  // nên preview tự vẽ lại; không cần ép render ở đây.
  //
  // Undo vẫn nguyên vẹn: Ctrl+Z hoàn tác edit rồi lưu lại là về đúng bản cũ.
  await target.save();
  return true;
}

/**
 * Hỏi để dựng một control MỚI: kiểu, tên field, nhãn.
 *
 * Thêm control nghĩa là thêm một thứ CHƯA CÓ — nên nó tạo luôn khai báo `<field>`. Bản trước
 * cho chọn trong danh sách field đã khai, tức chỉ đặt thêm một ô cho field sẵn có; đó là việc
 * khác, và nó khiến không có đường nào tạo field mới từ designer.
 *
 * @returns {Promise<{xml:string, tokens:string[], name:string}|null>}
 */
async function askNewControl(core) {
  const kind = await vscode.window.showQuickPick(
    core.FIELD_KINDS.map((k) => ({ label: k.label, detail: k.detail, id: k.id })),
    { title: 'Thêm control — chọn kiểu', matchOnDetail: true },
  );
  if (!kind) return null;

  const name = await vscode.window.showInputBox({
    title: `Thêm ${kind.label} — tên field`,
    placeHolder: 'vd: ma_kh, ngay_ct, t_tien',
    validateInput: (v) => (core.isValidFieldName(v)
      ? null
      : 'Tên field: chữ/số/gạch dưới, bắt đầu bằng chữ; có thể kết thúc bằng %l'),
  });
  if (!name) return null;

  const label = await vscode.window.showInputBox({
    title: `Thêm ${kind.label} — nhãn tiếng Việt`,
    placeHolder: 'bỏ trống thì lấy luôn tên field',
  });
  if (label === undefined) return null; // Esc — khác hẳn với bỏ trống

  const built = core.buildField(kind.id, name, label);
  if (!built.ok) {
    vscode.window.showWarningMessage(`FBO Designer: ${built.reason}`);
    return null;
  }
  return { ...built, name: name.trim() };
}

/**
 * Xử lý một thông điệp `edit` từ webview.
 *
 * `rebuild()` dựng lại model TỪ VĂN BẢN HIỆN TẠI trước mỗi phép sửa. Không dùng lại model của
 * lần render trước, và không tin offset do webview gửi lên: người dùng có thể vừa gõ tay vào
 * XML, và lúc đó mọi offset cũ đã lệch. Ghi theo offset lệch là cắt trúng giữa một thẻ khác.
 */
async function handleEdit(msg, core, hostDocument, rebuild, output) {
  // Cột của LƯỚI đi đường riêng: chúng nằm ở file Detail khác, và lưới khai layout bằng thứ tự
  // chứ không bằng pattern — không dùng chung phép nào với hàng của form.
  if (msg.op === 'colWidth' || msg.op === 'colRemove' || msg.op === 'colInsert') {
    return handleColumnEdit(msg, core, hostDocument, output);
  }

  // Kéo chiều cao: `view@height` cho cả vùng main, `field@rows` cho một tab có lưới.
  if (msg.op === 'viewHeight' || msg.op === 'fieldRows') {
    const b = rebuild();
    if (!b || !b.model) return false;
    const field = msg.op === 'fieldRows' ? b.model.fieldByName.get(msg.field) : null;
    const owner = msg.op === 'viewHeight'
      ? (b.model.heightRange ?? b.model.viewTagStart)
      : (field?.rowsRange ?? field?.tagStart);
    return planInOwner(owner, hostDocument, output, (src) => (msg.op === 'viewHeight'
      ? core.planViewHeight(b.model, Number(msg.height), src)
      : core.planFieldRows(b.model, msg.field, Number(msg.height), src)));
  }

  // Kéo mỏ neo / vạch chia: `anchor` và `split` của CHÍNH vùng đang kéo — `<view>` cho dải
  // header, `<category index="n">` cho một tab. Core chọn thẻ, ở đây chỉ chuyển tiếp.
  if (msg.op === 'regionMeta') {
    const b = rebuild();
    if (!b || !b.model) return false;
    const wb = (b.model.regions ?? []).find((r) => r.id === msg.region)?.writeback;
    const owner = wb && (msg.attr === 'anchor' ? wb.anchorRange : wb.splitRange) || wb?.tagStart;
    return planInOwner(owner, hostDocument, output, (src) =>
      core.planRegionMetadata(b.model, msg.region, msg.attr, Number(msg.value), src));
  }

  const built = rebuild();
  if (!built || !built.model || built.mode !== 'form') {
    vscode.window.showWarningMessage('FBO Designer: chỉ sửa được trên form.');
    return false;
  }
  const model = built.model;

  // Văn bản NGUỒN của chính file chứa hàng — bắt buộc phải có TRƯỚC khi lập kế hoạch.
  //
  // `canEditRow` dùng nó để so nguyên văn: dải sắp ghi đè trong file phải giống hệt giá trị
  // đang cầm. Đó là thứ duy nhất bắt được hàng viết bằng entity đã bung (`[&k;]` → `[ma_kho]`),
  // vì lúc ấy trong model không còn dấu `&` nào để nhận ra. File nguồn có thể là một Include
  // chưa mở, nên phải mở nó ra chứ không dùng văn bản của controller.
  const row = model.rows.find((r) => r.index === msg.item);
  if (!row || !row.range) {
    vscode.window.showWarningMessage('FBO Designer: không xác định được hàng trong file nguồn.');
    return false;
  }

  /*
   * Với gộp/tách, file cần đọc KHÔNG chắc là file chứa hàng.
   *
   * Pattern có thể ghép từ nhiều nguồn — `110&Split;-----101-` — và mấy ký tự thật sự đổi có thể
   * nằm gọn trong khai báo của `&Split;`, ở một file khác hẳn file chứa `<item>`. Core tính
   * trước dải cần ghi (không cần văn bản để làm việc đó) rồi cho biết file nào, xem
   * `rowEditTargetFile`. Đọc nhầm file là phép so nguyên văn thấy chữ không khớp và từ chối —
   * đúng lối hỏng mà tầng chiều cao đã mắc một lần.
   */
  const op = msg.op === 'resize'
    ? { kind: 'resize', item: msg.item, cell: msg.cell, span: msg.span, col: msg.col, side: msg.side }
    : null;
  const targetFile = (op ? core.rowEditTargetFile(model, op) : null) ?? row.range.file;
  const source = await openTarget(targetFile, hostDocument);
  const sourceText = source.getText();

  let plan;
  if (msg.op === 'resize') {
    plan = core.planRowEdit(model, op, sourceText);
  } else if (msg.op === 'remove') {
    plan = await planRemove(msg, core, model, hostDocument, sourceText, output);
    if (plan === null) return false;
  } else if (msg.op === 'insert' || msg.op === 'addRow') {
    const made = await askNewControl(core);
    if (!made) return false;

    if (msg.op === 'addRow' && !row.itemRange) {
      vscode.window.showWarningMessage('FBO Designer: không xác định được vị trí thẻ <item>.');
      return false;
    }
    plan = msg.op === 'insert'
      ? core.planRowEdit(model,
        { kind: 'insert', item: msg.item, cell: msg.cell, side: msg.side, token: made.tokens }, sourceText)
      : core.planAddRow(model,
        { kind: 'addRow', item: msg.item, side: msg.side, token: made.tokens }, sourceText, row.itemRange);

    // Khai báo `<field>` đi kèm — cùng một WorkspaceEdit với phép sửa hàng, để Ctrl+Z không
    // bao giờ để lại một file có control trỏ vào field chưa tồn tại (hoặc ngược lại).
    if (plan.ok) {
      const decl = core.planAddField(sourceText, made.xml, made.name);
      if (!decl.ok) {
        vscode.window.showWarningMessage(`FBO Designer: ${decl.reason}`);
        return false;
      }
      plan = { ...plan, extra: decl.splice };
    }
  } else {
    return false;
  }

  if (!plan.ok) {
    vscode.window.showWarningMessage(`FBO Designer: ${plan.reason}`);
    return false;
  }
  return applySplice(plan, hostDocument, output);
}

/**
 * Xoá control. Shift+Delete xoá thêm cả khai báo `<field>`.
 *
 * Hai splice ở hai chỗ khác nhau trong cùng một file, nên phải gộp vào MỘT `WorkspaceEdit`:
 * áp rời từng cái thì Ctrl+Z chỉ hoàn tác một nửa, và người dùng còn lại một file ở trạng thái
 * chưa từng tồn tại. Ở đây gộp bằng cách áp phép xoá field TRƯỚC ở lời gọi sau — xem chú thích.
 */
async function planRemove(msg, core, model, hostDocument, sourceText, output) {
  const plan = core.planRowEdit(model, { kind: 'remove', item: msg.item, cell: msg.cell }, sourceText);
  if (!plan.ok || !msg.withField) return plan;

  const row = model.rows.find((r) => r.index === msg.item);
  const cell = row?.cells?.[msg.cell];
  const name = cell?.token?.field;
  if (!name) return plan;

  // Bỏ token khỏi hàng TRƯỚC rồi mới hỏi "còn ai dùng field này không" — nếu hỏi trên model cũ
  // thì chính cái token đang xoá vẫn được tính là "còn dùng", và Shift+Delete không bao giờ
  // xoá được field nào.
  const after = core.parseRow(plan.splice.text);
  const stillUsed = model.rows.some((r) => (r.index === msg.item ? after : r.row).tokens
    .some((t) => t.field === name));
  if (stillUsed) {
    vscode.window.showWarningMessage(
      `FBO Designer: field "${name}" còn hàng khác dùng — chỉ xoá control, giữ khai báo <field>.`,
    );
    return plan;
  }

  const field = model.fieldByName.get(name);
  // `<field>` khai ở file nào thì cắt ở file đó. Ở đây dùng văn bản của chính file chứa hàng —
  // hàng và khai báo của nó gần như luôn cùng file, và nếu không thì `fieldTagSpan` trả null và
  // ta từ chối, chứ không cắt bừa vào file khác.
  const span = fieldTagSpan(sourceText, name);
  if (!field || !span) {
    vscode.window.showWarningMessage(`FBO Designer: không tìm thấy khai báo <field name="${name}"> để xoá.`);
    return plan;
  }

  const answer = await vscode.window.showWarningMessage(
    `Xoá control và cả khai báo <field name="${name}">?`,
    { modal: true },
    'Xoá cả hai',
    'Chỉ xoá control',
  );
  if (!answer) return null;
  if (answer === 'Chỉ xoá control') return plan;

  return { ...plan, extra: { start: span.start, end: span.end, text: '' } };
}

/**
 * Dải của cả thẻ `<field name="x">…</field>` trong văn bản NGUỒN.
 *
 * Quét lại trên văn bản gốc chứ không dùng span của `scanFields`: span kia đo trên clearText
 * (đã bung entity), còn chỗ cần cắt là trong file thật.
 */
function fieldTagSpan(text, name) {
  const open = new RegExp(`<field\\b[^>]*\\bname\\s*=\\s*(["'])${escapeRe(name)}\\1[^>]*?(/?)>`, 'i');
  const m = open.exec(text);
  if (!m) return null;

  let end = m.index + m[0].length;
  if (m[2] !== '/') {
    const close = text.toLowerCase().indexOf('</field>', end);
    if (close === -1) return null;
    end = close + '</field>'.length;
  }
  // Nuốt cả phần thụt lề và xuống dòng, để không để lại một dòng trắng ở chỗ vừa xoá.
  const lineStart = text.lastIndexOf('\n', m.index - 1) + 1;
  const onlyIndent = /^[ \t]*$/.test(text.slice(lineStart, m.index));
  const after = /^\r?\n/.exec(text.slice(end));
  return {
    start: onlyIndent ? lineStart : m.index,
    end: onlyIndent && after ? end + after[0].length : end,
  };
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}


/**
 * Dựng lại model của một lưới Detail từ chính file của nó.
 *
 * Không dùng lại model của lần render trước: model ấy sinh ra trong lúc vẽ ô lưới rồi bị bỏ đi,
 * và quan trọng hơn — người dùng có thể vừa gõ tay vào file Detail, nên offset cũ đã lệch.
 */
function detailGridModel(core, hostDocument, controller) {
  const readFile = (abs) => {
    try { return fs.existsSync(abs) ? core.readSource(abs).text : null; } catch { return null; }
  };
  const detail = loadDetail(core, hostDocument.uri.fsPath, controller, readFile, new Map());
  if (!detail) return null;

  const built = core.renderGrid(core.scanViews(detail.text), core.scanFields(detail.text), {
    root: core.scanRoot(detail.text),
    segments: detail.segments,
    hostFile: detail.file,
  });
  return { model: built.model, file: detail.file };
}

/** Kéo giãn / chèn / xoá một cột lưới. Mọi splice rơi vào file Detail, không vào controller. */
async function handleColumnEdit(msg, core, hostDocument, output) {
  const grid = detailGridModel(core, hostDocument, msg.grid);
  if (!grid) {
    vscode.window.showWarningMessage(`FBO Designer: không đọc được lưới Detail ${msg.grid}.`);
    return false;
  }

  const target = await openTarget(grid.file, hostDocument);
  const sourceText = target.getText();

  let plan;
  if (msg.op === 'colWidth') {
    plan = core.planColumnWidth(grid.model, msg.column, Number(msg.width), sourceText);
  } else if (msg.op === 'colRemove') {
    const answer = await vscode.window.showWarningMessage(
      `Bỏ cột "${msg.column}" khỏi lưới? Khai báo <field> vẫn giữ nguyên.`,
      { modal: true }, 'Bỏ cột',
    );
    if (answer !== 'Bỏ cột') return false;
    plan = core.planRemoveColumn(grid.model, msg.column, sourceText);
  } else {
    // Chèn cột: chọn trong các field ĐÃ KHAI mà lưới chưa dùng, hoặc tạo hẳn field mới.
    const inGrid = new Set(grid.model.columns.map((c) => c.name));
    const spare = core.scanFields(core.readSource(grid.file).text)
      .map((f) => f.name).filter((n) => !inGrid.has(n));

    const pickedNew = { label: '$(add) Tạo field mới…', isNew: true };
    const choice = await vscode.window.showQuickPick(
      [pickedNew, ...spare.map((n) => ({ label: n }))],
      { title: `Chèn cột ${msg.side === 'left' ? 'bên trái' : 'bên phải'} "${msg.column}"` },
    );
    if (!choice) return false;

    let name = choice.label;
    let declare = null;
    if (choice.isNew) {
      const made = await askNewControl(core);
      if (!made) return false;
      name = made.name;
      declare = core.planAddField(sourceText, made.xml, made.name);
      if (!declare.ok) {
        vscode.window.showWarningMessage(`FBO Designer: ${declare.reason}`);
        return false;
      }
    }
    plan = core.planInsertColumn(grid.model, msg.column, msg.side, name, sourceText);
    if (plan.ok && declare) plan = { ...plan, extra: declare.splice };
  }

  if (!plan.ok) {
    vscode.window.showWarningMessage(`FBO Designer: ${plan.reason}`);
    return false;
  }
  return applySplice(plan, hostDocument, output);
}

module.exports = { handleEdit, applySplice, encodingBlocks, productFileBlocks, fieldTagSpan };
