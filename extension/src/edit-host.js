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

const { samePath, loadDetail, config } = require('./render-host');
const { history } = require('./edit-history');
const { dialogs } = require('./dialog/dialog-service');
const { t, toast } = require('./locale');

/** Toast lý do từ core (đã format sẵn). */
function warnReason(reason) {
  return vscode.window.showWarningMessage(t('extension.prefix') + reason);
}

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
  // `fboDesigner.confirmForeignEdit` — tắt được, vì người quen tay sửa Include suốt ngày thì
  // mỗi thao tác một hộp thoại là phiền hơn là an toàn. Mặc định vẫn BẬT: hỏi thừa một lần rẻ
  // hơn nhiều so với đổi nhầm màn hình của một khách khác.
  if (!config().confirmForeignEdit) return true;
  const owner = file.split(/[\\/]/).pop();
  const answer = await dialogs().ask({
    type: 'warning',
    title: 'Sửa file dùng chung?',
    subtitle: owner,
    size: 'small',
    body: [
      { type: 'text', content: `Chỗ này khai trong ${owner} — sửa là đổi cho MỌI controller dùng file đó.` },
    ],
    buttons: [
      { id: 'cancel', label: t('dialog.btn.cancel'), variant: 'secondary', action: 'cancel' },
      { id: 'go', label: t('dialog.btn.edit_anyway'), variant: 'danger', action: 'confirm' },
    ],
  });
  return answer === 'go';
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
    warnReason(result.reason);
    return false;
  }
  return applySplice({
    ...result,
    file: result.file ?? file,
    // `warning` là thứ bật lời hỏi ở `applySplice`; chỉ bật khi thật sự đụng file khác.
    warning: result.warning ?? (samePath(file, hostDocument.uri.fsPath) ? null : file),
  }, hostDocument, output);
}

/**
 * File nào SỞ HỮU `<fields>` — chỗ duy nhất được thêm khai báo `<field>` vào.
 *
 * Ưu tiên file chứa hàng nếu chính nó có `<fields>` (controller tự khai hàng của mình, ca
 * thường nhất); không thì rơi về controller đang mở. Không đoán xa hơn: nếu cả hai đều không có
 * `<fields>` thì `planAddField` sẽ từ chối kèm lý do, và từ chối đúng còn hơn ghi vào một file
 * dùng chung mà người dùng không biết.
 */
function fieldsHost(core, hostDocument, sourceText, targetFile) {
  if (/<fields/i.test(sourceText)) return { text: sourceText, file: targetFile };
  return { text: hostDocument.getText(), file: hostDocument.uri.fsPath };
}

/** Mở (không hiện) document của file đích — splice có thể nhắm vào một Include chưa mở. */
async function openTarget(file, hostDocument) {
  if (samePath(file, hostDocument.uri.fsPath)) return hostDocument;
  return vscode.workspace.openTextDocument(vscode.Uri.file(file));
}

/**
 * Mọi splice của một kế hoạch, quy về MỘT danh sách phẳng `[{file, start, end, text}]`.
 *
 * Ba hình dạng cùng tồn tại, và gộp chúng ở đây thay vì bắt mỗi chỗ gọi tự lo:
 *   `splice` + `file`   phép sửa thường — một dải, một file
 *   `extra`             khai báo `<field>` đi kèm; `extra.file` có thể khác `file`
 *   `edits[]`           phép đụng nhiều hàng cùng lúc (Shift+Delete kéo theo cả cụm)
 */
function spliceList(plan) {
  if (Array.isArray(plan.edits)) return plan.edits.map((e) => ({ ...e, file: e.file ?? plan.file }));
  const list = [{ file: plan.file, ...plan.splice }];
  if (plan.extra) list.push({ ...plan.extra, file: plan.extra.file ?? plan.file });
  return list;
}

/**
 * Áp các splice do core tính ra.
 * @param label tên thao tác, hiện lại khi người dùng hoàn tác
 * @returns {Promise<boolean>} đã ghi hay chưa
 */
async function applySplice(plan, hostDocument, output, label = 'sửa form') {
  const edits = spliceList(plan);
  if (edits.length === 0) return false;

  /*
   * MỌI splice vào MỘT WorkspaceEdit. Áp rời thì hoàn tác chỉ lùi được một phần và người dùng
   * còn lại một file ở trạng thái chưa từng tồn tại — control đã mất mà `<field>` vẫn còn, hoặc
   * nhãn đã đi mà ô nhập còn nguyên. VS Code tự sắp thứ tự các edit không chồng nhau trong cùng
   * một WorkspaceEdit.
   *
   * Một splice có thể rơi vào FILE KHÁC file đang mở, và đó là ca thường chứ không phải ngoại
   * lệ: hàng `<item>` hay nằm trong một Include dùng chung, còn khai báo `<field>` thì luôn ở
   * `<fields>` của controller.
   */
  const targets = new Map(); // fsPath (thường hoá) → TextDocument
  const resolved = [];
  for (const e of edits) {
    const doc = await openTarget(e.file, hostDocument);
    const id = doc.uri.fsPath.toLowerCase();
    if (!targets.has(id)) {
      const blocked = productFileBlocks(doc.uri.fsPath) || encodingBlocks(doc);
      if (blocked) {
        warnReason(blocked);
        return false;
      }
      targets.set(id, doc);
    }
    resolved.push({ doc: targets.get(id), ...e });
  }

  if (!(await confirmForeign(plan.warning, hostDocument.uri.fsPath))) return false;

  // Ảnh chụp TRƯỚC, để chồng hoàn tác riêng của designer có chỗ lùi về — xem `edit-history.js`.
  const frames = [...targets.values()].map((doc) => ({ uri: doc.uri, before: doc.getText(), after: null }));

  const edit = new vscode.WorkspaceEdit();
  for (const e of resolved) edit.replace(e.doc.uri, rangeOf(e.doc, e.start, e.end), e.text);
  const applied = await vscode.workspace.applyEdit(edit);
  if (!applied) {
    vscode.window.showWarningMessage(toast('extension.vscode_reject'));
    return false;
  }
  for (const e of edits) {
    output.appendLine(`sửa ${e.file} [${e.start},${e.end}) → ${JSON.stringify(e.text)}`);
  }

  /*
   * Chụp SAU applyEdit, TRƯỚC save — rồi trả về ngay để UI vẽ lại.
   *
   * `await doc.save()` từng chiếm phần lớn latency mỗi thao tác (thường 50–150ms), trong khi
   * `applyEdit` chỉ vài ms. Chốt `editing` giữ đến hết save khiến form chỉ nhảy sau khi đĩa
   * xong. Vẽ từ document (đã apply) là đủ; save chạy nền. VS Code có thể chỉnh whitespace lúc
   * lưu — cập nhật `frames.after` sau save để hoàn tác vẫn khớp file thật.
   */
  for (const f of frames) f.after = targets.get(f.uri.fsPath.toLowerCase()).getText();
  history(output).record(label, frames);

  const saveJobs = [...targets.values()].map((doc) => doc.save().then(() => {
    const frame = frames.find((f) => f.uri.toString() === doc.uri.toString());
    if (frame) frame.after = doc.getText();
  }));
  void Promise.all(saveJobs).catch((err) => {
    output.appendLine(`lưu nền lỗi: ${err.stack || err.message}`);
  });

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
async function askNewControl(core, { width = false } = {}) {
  const kind = await vscode.window.showQuickPick(
    core.FIELD_KINDS.map((k) => ({ label: k.label, detail: k.detail, id: k.id })),
    { title: `Thêm ${width ? 'cột' : 'control'} — chọn kiểu`, matchOnDetail: true },
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

  /*
   * Bề rộng CHỈ hỏi cho cột lưới, và hỏi với 100 điền sẵn.
   *
   * Cột lưới có bề rộng riêng khai ở `<field width="N">`; không khai thì runtime tự cho 100px —
   * tức con số vẫn tồn tại, chỉ là nằm ở chỗ không ai đọc được. Điền sẵn 100 nên người dùng chỉ
   * cần Enter là đi tiếp, mà vẫn đổi được ngay tại đây thay vì tạo xong rồi kéo.
   *
   * Ô của FORM không hỏi: nó không có bề rộng riêng, px của nó nằm ở list cột của vùng
   * (`<item value="100, 60, …">`). Hỏi ở đó là hứa một thứ định dạng không có.
   */
  let px;
  if (width) {
    const answer = await vscode.window.showInputBox({
      title: `Thêm ${kind.label} — bề rộng cột (px)`,
      value: '100',
      prompt: 'Enter để lấy 100px, mức runtime tự dùng khi cột không khai width',
      validateInput: (v) => (/^\d+$/.test(String(v).trim()) ? null : 'Bề rộng là số nguyên px, ví dụ 100'),
    });
    if (answer === undefined) return null; // Esc
    px = Number(String(answer).trim());
  }

  const built = core.buildField(kind.id, name, label, null, width ? { width: px } : {});
  if (!built.ok) {
    warnReason(built.reason);
    return null;
  }
  return { ...built, name: name.trim(), width: px };
}

/**
 * Xử lý một thông điệp `edit` từ webview.
 *
 * `rebuild()` dựng lại model TỪ VĂN BẢN HIỆN TẠI trước mỗi phép sửa. Không dùng lại model của
 * lần render trước, và không tin offset do webview gửi lên: người dùng có thể vừa gõ tay vào
 * XML, và lúc đó mọi offset cũ đã lệch. Ghi theo offset lệch là cắt trúng giữa một thẻ khác.
 */
async function handleEdit(msg, core, hostDocument, rebuild, output, depth = 0) {
  // Cột của LƯỚI đi đường riêng: chúng nằm ở file Detail khác, và lưới khai layout bằng thứ tự
  // chứ không bằng pattern — không dùng chung phép nào với hàng của form.
  if (msg.op === 'colWidth' || msg.op === 'colRemove' || msg.op === 'colInsert' || msg.op === 'colMove') {
    return handleColumnEdit(msg, core, hostDocument, output, rebuild);
  }

  // Tách / gộp BIÊN CỘT của một vùng form. Tên op cố tình KHÁC hẳn ba cái trên: chúng nói về
  // cột của LƯỚI (mỗi cột một `<field width>` riêng), còn cái này nói về danh sách biên dùng
  // chung của một vùng FORM — trùng tên là lẫn hai họ thao tác ở hai cấp khác nhau.
  if (msg.op === 'colSplit' || msg.op === 'colMerge') {
    return handleRegionColumns(msg, core, hostDocument, output, rebuild);
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
    vscode.window.showWarningMessage(toast('extension.form_only'));
    return false;
  }
  const model = built.model;

  // Văn bản NGUỒN của chính file chứa hàng — bắt buộc phải có TRƯỚC khi lập kế hoạch.
  //
  // `canEditRow` dùng nó để so nguyên văn: dải sắp ghi đè trong file phải giống hệt giá trị
  // đang cầm. Đó là thứ duy nhất bắt được hàng viết bằng entity đã bung (`[&k;]` → `[ma_kho]`),
  // vì lúc ấy trong model không còn dấu `&` nào để nhận ra. File nguồn có thể là một Include
  // chưa mở, nên phải mở nó ra chứ không dùng văn bản của controller.
  const rowKey = msg.op === 'moveBlock'
    ? (Array.isArray(msg.items) ? msg.items[0] : undefined)
    : msg.item;
  const row = model.rows.find((r) => r.index === rowKey);
  if (!row || !row.range) {
    vscode.window.showWarningMessage(toast('extension.row_unknown'));
    return false;
  }

  /*
   * Hàng đến từ `&ENTITY;` → hỏi GHI VÀO ĐÂU trước khi tính bất cứ splice nào.
   *
   * Phải hỏi trước chứ không hỏi sau: hai đường đi ghi vào hai file khác nhau, nên kế hoạch
   * tính cho đường này vô dụng với đường kia. Xem `routeEntityEdit`.
   */
  const routed = await routeEntityEdit(msg, core, built, hostDocument, output, depth);
  if (routed === 'abort') return false;
  if (routed === 'retry') return handleEdit(msg, core, hostDocument, rebuild, output, depth + 1);

  // Xoá control đi đường RIÊNG: nó có thể đụng nhiều hàng ở nhiều file (Shift kéo theo cả cụm
  // Label/Footer/Description), nên nó không dùng chung phép "một splice" với ba op còn lại.
  if (msg.op === 'remove') return removeControl(msg, core, model, hostDocument, output);

  /*
   * Với gộp/tách, file cần đọc KHÔNG chắc là file chứa hàng.
   *
   * Pattern có thể ghép từ nhiều nguồn — `110&Split;-----101-` — và mấy ký tự thật sự đổi có thể
   * nằm gọn trong khai báo của `&Split;`, ở một file khác hẳn file chứa `<item>`. Core tính
   * trước dải cần ghi (không cần văn bản để làm việc đó) rồi cho biết file nào, xem
   * `rowEditTargetFile`. Đọc nhầm file là phép so nguyên văn thấy chữ không khớp và từ chối —
   * đúng lối hỏng mà tầng chiều cao đã mắc một lần.
   */
  let plan;
  if (msg.op === 'move' || msg.op === 'swap' || msg.op === 'moveBlock') {
    // Dời/đổi chỗ TỰ DO có thể đụng nhiều hàng, nhiều vùng, và nhiều file cùng lúc.
    // Tầng core nói trước danh sách file phải mở (`moveControlFiles`), rồi mới đối chiếu từng
    // splice trên đúng file sở hữu nó (`planMoveControl` / `planSwapControl` / `planMoveRowBlock`).
    const op = msg.op === 'moveBlock'
      ? {
        kind: 'moveBlock',
        items: Array.isArray(msg.items) ? msg.items.map(Number) : [],
        toItem: Number(msg.toItem),
        side: msg.side === 'after' ? 'after' : 'before',
      }
      : msg.op === 'move'
        ? {
          kind: 'move',
          item: msg.item,
          cell: msg.cell,
          toItem: Number.isFinite(Number(msg.toItem)) ? Number(msg.toItem) : undefined,
          toCol: msg.col,
          targets: Array.isArray(msg.targets) ? msg.targets : undefined,
        }
        : {
          kind: 'swap',
          item: msg.item,
          cell: msg.cell,
          toItem: Number.isFinite(Number(msg.toItem)) ? Number(msg.toItem) : undefined,
          other: msg.other,
        };

    const files = core.moveControlFiles(model, op);
    const texts = [];
    for (const file of files) {
      const doc = await openTarget(file, hostDocument);
      texts.push({ file, text: doc.getText() });
    }
    const getText = (file) => texts.find((t) => samePath(t.file, file))?.text ?? null;

    plan = msg.op === 'moveBlock'
      ? core.planMoveRowBlock(model, op, getText)
      : msg.op === 'move'
        ? core.planMoveControl(model, op, getText)
        : core.planSwapControl(model, op, getText);
  } else {
    const op = msg.op === 'resize'
      ? { kind: 'resize', item: msg.item, cell: msg.cell, span: msg.span, col: msg.col, side: msg.side }
      : null;
    const targetFile = (op ? core.rowEditTargetFile(model, op) : null) ?? row.range.file;
    const source = await openTarget(targetFile, hostDocument);
    const sourceText = source.getText();

    if (msg.op === 'resize') {
      plan = core.planRowEdit(model, op, sourceText);
    } else if (msg.op === 'insert' || msg.op === 'addRow') {
      /*
       * `addRow` + `blank: true` — chỉ chèn hàng `---------`, không hỏi control / không khai
       * `<field>`. Field thêm sau bằng nút (+) trên slot trống.
       */
      if (msg.op === 'addRow' && msg.blank) {
        if (!row.itemRange) {
          vscode.window.showWarningMessage(toast('extension.item_unknown'));
          return false;
        }
        const region = model.regions.find((r) => r.rows.some((x) => x.index === msg.item));
        const split = Number(region?.split ?? model.split);
        const splitSide = msg.splitSide === 'left' || msg.splitSide === 'right' ? msg.splitSide : undefined;
        plan = core.planAddRow(model, {
          kind: 'addRow',
          item: msg.item,
          side: msg.side === 'above' ? 'above' : 'below',
          token: [],
          blank: true,
          splitSide,
          split: Number.isFinite(split) && split > 0 ? split : undefined,
        }, sourceText, row.itemRange);
      } else {
        const made = await askNewControl(core);
        if (!made) return false;

        if (msg.op === 'addRow' && !row.itemRange) {
          vscode.window.showWarningMessage(toast('extension.item_unknown'));
          return false;
        }
        const side = msg.side === 'left' || msg.side === 'right' || msg.side === 'in'
          ? msg.side
          : (msg.side === 'above' ? 'above' : 'below');
        plan = msg.op === 'insert'
          ? core.planRowEdit(model,
            { kind: 'insert', item: msg.item, cell: msg.cell, side, token: made.tokens }, sourceText)
          : core.planAddRow(model,
            { kind: 'addRow', item: msg.item, side, token: made.tokens }, sourceText, row.itemRange);

        /*
         * Khai báo `<field>` đi kèm — cùng một WorkspaceEdit với phép sửa hàng, để Ctrl+Z không bao
         * giờ để lại một file có control trỏ vào field chưa tồn tại (hoặc ngược lại).
         *
         * Nhưng nó KHÔNG đi vào cùng file với hàng. Hàng `<item>` hay nằm trong một Include dùng
         * chung; `<fields>` thì luôn ở controller. Bản trước dùng `sourceText` (văn bản của file
         * chứa hàng) cho cả hai, nên với `Dir/Customer.xml` của HOATP nó báo «file không có
         * <fields> để thêm khai báo vào» trong khi controller có đủ.
         */
        if (plan.ok) {
          const declHost = fieldsHost(core, hostDocument, sourceText, targetFile);
          const decl = core.planAddField(declHost.text, made.xml, made.name);
          if (!decl.ok) {
            warnReason(decl.reason);
            return false;
          }
          plan = { ...plan, extra: { ...decl.splice, file: declHost.file } };
        }
      }
    } else {
      return false;
    }
  }

  if (!plan.ok) {
    warnReason(plan.reason);
    return false;
  }
  return applySplice(plan, hostDocument, output, `${msg.op} control`);
}

/**
 * Ba kind chỉ tô điểm cho một ô Input — chúng đi theo control, không sống độc lập.
 * Giữ song song với `COMPANION_KINDS` của `core/src/edit.mjs`: bên kia lập kế hoạch, bên này
 * gom trước văn bản của những file sắp bị đụng.
 */
const COMPANION_KINDS = new Set(['label', 'footer', 'description']);

/**
 * Sáu op GHI LẠI một hàng — và chỉ chúng mới phải hỏi «ghi vào file nào».
 *
 * Chiều cao, mỏ neo, vạch chia và mọi phép trên cột lưới KHÔNG có mặt ở đây: chúng sửa một
 * thuộc tính trên thẻ chứ không sửa `<item value>`, nên «phân giải dòng &Name; ra tại chỗ»
 * không phải phép sửa đúng cho chúng.
 */
const ENTITY_ROUTED_OPS = new Set(['resize', 'move', 'swap', 'moveBlock', 'insert', 'remove', 'addRow']);

/**
 * Hàng đến từ `&ENTITY;`: ghi thẳng vào file gốc, hay phân giải vào chính file thiết kế?
 *
 * Hai đường, hai kết quả khác hẳn nhau — và người dùng là bên duy nhất biết họ muốn cái nào:
 *
 *   file gốc    sửa `Include\…` → MỌI controller include file đó cùng đổi theo. Đúng khi đang
 *               sửa một quy ước dùng chung.
 *   phân giải   comment dòng `&Name;` trong controller rồi chèn bản đã bung ngay dưới, và sửa
 *               trên bản ấy. Chỉ màn hình NÀY đổi; Include giữ nguyên cho người khác. Đúng khi
 *               đang customize cho một khách.
 *
 * Mặc định là HỎI (`fboDesigner.entityEditTarget`), vì đoán sai theo chiều nào cũng đắt: đoán
 * "file gốc" là lặng lẽ đổi màn hình của khách khác; đoán "phân giải" là lặng lẽ cắt đứt một
 * tham chiếu dùng chung mà không ai yêu cầu.
 *
 * @returns {Promise<'continue'|'retry'|'abort'>}
 *   `continue` đi tiếp đường thường (ghi vào file gốc) · `retry` đã phân giải xong, gọi lại
 *   phép sửa trên bản vừa chèn · `abort` người dùng bấm Esc.
 */
async function routeEntityEdit(msg, core, built, hostDocument, output, depth) {
  // Đã phân giải một lượt rồi thì lần gọi lại KHÔNG được hỏi nữa — hàng bây giờ nằm ngay trong
  // controller, và hỏi tiếp là hỏi về một thứ không còn tồn tại.
  if (depth > 0) return 'continue';
  if (!ENTITY_ROUTED_OPS.has(msg.op)) return 'continue';

  const rowKey = msg.op === 'moveBlock'
    ? (Array.isArray(msg.items) ? msg.items[0] : undefined)
    : msg.item;
  const row = built.model.rows.find((r) => r.index === rowKey);
  // `hostRef` chỉ có khi chính controller ĐANG MỞ là nơi viết ra `&Name;`. Không có nó thì
  // không có dòng nào ở đây để mà comment, và câu hỏi trở thành vô nghĩa.
  if (!row || !row.foreign || !row.hostRef) return 'continue';

  const cfg = config();
  if (cfg.entityEditTarget === 'source') return 'continue';

  let choice = cfg.entityEditTarget;
  if (choice === 'ask') {
    const source = row.range.file.split(/[\\/]/).pop();
    const design = hostDocument.uri.fsPath.split(/[\\/]/).pop();
    // Tên KHÔNG đuôi cho nhãn nút: cả hai file đều là .xml nên phần đuôi không phân biệt được
    // gì, chỉ làm nhãn dài thêm bốn ký tự trên một cái nút vốn đã hẹp.
    const designName = design.replace(/\.[^.]+$/, '');
    const answer = await dialogs().ask({
      type: 'info',
      title: 'Ghi thay đổi vào đâu?',
      subtitle: `Hàng kéo vào từ ${source} qua &ENTITY;`,
      size: 'medium',
      body: [
        /*
         * Khoá của mỗi hàng là NHÃN CỦA ĐÚNG CÁI NÚT bên dưới, không phải tên file.
         *
         * Bản trước ghi khoá là «Vào SVTran.xml» / «Vào ElNoteViews.xml» trong khi nút lại đề
         * «Phân giải vào file thiết kế» / «Cập nhật file gốc» — người đọc phải tự bắc cầu giữa
         * hai cách gọi khác nhau cho cùng một việc, ngay lúc đang phải quyết định. Đọc hàng nào
         * là biết bấm nút nào.
         */
        { type: 'details', rows: [
          {
            key: `Cập nhật vào ${designName}`,
            value: `Nội dung entity sẽ được chép vào ${designName}, chỉ thay đổi màn hình này.`,
          },
          {
            key: 'Cập nhật vào Entity',
            value: `Nội dung entity sẽ được sửa trực tiếp trong ${source}, toàn bộ màn hình dùng chung file sẽ đổi.`,
          },
        ] },
      ],
      /*
       * Thứ tự nút theo yêu cầu, nhưng nút NỔI vẫn là nút an toàn.
       *
       * «Cập nhật vào Entity» đứng cuối, và ở dải nút căn phải thì cuối là ngoài cùng bên phải
       * — chỗ mắt và Enter tìm tới trước. Nó lại đúng là lựa chọn đổi MỌI màn hình dùng chung
       * file, nên tô nó thành nút chính là mời người ta chọn nhầm cái đắt hơn. Nút chính giữ ở
       * lựa chọn chỉ đụng một màn hình; Entity mang variant `danger` để đọc ra ngay là nó nặng.
       */
      buttons: [
        { id: 'cancel', label: t('dialog.btn.cancel'), variant: 'secondary', action: 'cancel' },
        { id: 'inline', label: `Cập nhật vào ${designName}`, variant: 'primary', action: 'confirm' },
        { id: 'source', label: 'Cập nhật vào Entity', variant: 'danger', action: 'confirm' },
      ],
    });
    if (!answer) return 'abort';
    if (answer === 'source') return 'continue';
    choice = 'inline';
  }

  if (choice !== 'inline') return 'continue';
  return (await inlineEntityRow(row, core, built, hostDocument, output)) ? 'retry' : 'abort';
}

/**
 * Bung `&Name;` ra tại chỗ trong file thiết kế: comment tham chiếu, chèn nội dung xuống dưới.
 *
 * Nội dung để chèn lấy từ chính bản đã bung của lần render này (`built.expanded`), không bung
 * lại: bung lại là chạy thêm một lượt đọc đĩa cho mỗi thao tác, và tệ hơn — có thể ra một bản
 * khác bản đang vẽ trên màn hình nếu file Include vừa đổi giữa chừng. Cái được chèn xuống phải
 * đúng bằng cái người dùng đang nhìn.
 */
async function inlineEntityRow(row, core, built, hostDocument, output) {
  const ex = built.expanded;
  if (!ex || !row.item?.valueSpan) {
    vscode.window.showWarningMessage(toast('extension.expanded_unread'));
    return false;
  }

  const span = core.refResolvedSpan(ex.segments, row.item.valueSpan.start);
  if (!span || !samePath(span.ref.file, hostDocument.uri.fsPath)) {
    // Tham chiếu nằm trong một Include khác, không nằm trong controller đang mở — comment ở đây
    // là comment nhầm file, và cũng chẳng có dòng `&Name;` nào ở đây để comment.
    vscode.window.showWarningMessage(
      'FBO Designer: &…; kéo hàng này vào từ một file khác chứ không từ controller đang mở'
      + ' — không phân giải tại chỗ được. Sửa ở file gốc, hoặc tự chép dòng &…; vào controller.',
    );
    return false;
  }

  const plan = core.planInlineEntity(hostDocument.getText(), span.ref, ex.clearText.slice(span.start, span.end));
  if (!plan.ok) {
    warnReason(plan.reason);
    return false;
  }
  const name = hostDocument.getText().slice(span.ref.start, span.ref.end);
  return applySplice(
    { ok: true, file: hostDocument.uri.fsPath, splice: plan.splice, warning: null },
    hostDocument, output, `phân giải ${name} vào file thiết kế`,
  );
}

/**
 * Xoá control — và với Shift, xoá luôn Label / Footer / Description cùng khai báo `<field>`.
 *
 * Ba việc mà tầng core cố tình không làm, gộp cả ở đây:
 *
 *   1. HỎI. `fboDesigner.confirmDelete` bật thì hỏi; tắt thì xoá ngay — vẫn lùi được bằng
 *      Ctrl+Z, nên tắt không phải là mất đường về.
 *   2. Gom văn bản của MỌI file có hàng sắp bị đụng. `[x].Description` nằm ở hàng khác, và
 *      hàng khác thì nằm ở file khác được.
 *   3. Tìm khai báo `<field>` để cắt kèm — tìm ở CẢ controller lẫn file chứa hàng, vì
 *      `<fields>` thường ở controller trong khi hàng ở Include.
 *
 * Mọi splice đi chung MỘT `WorkspaceEdit` (xem `applySplice`), nên một lần hoàn tác trả lại
 * đúng trạng thái cũ — không có nửa vời "control đã mất mà `<field>` vẫn còn".
 */
async function removeControl(msg, core, model, hostDocument, output) {
  const row = model.rows.find((r) => r.index === msg.item);
  const cell = row?.cells?.[msg.cell];
  if (!cell || cell.empty || !cell.token) {
    vscode.window.showWarningMessage(toast('common.empty_delete'));
    return false;
  }

  const name = cell.token.field;
  // Chỉ ô INPUT mới kéo theo cả cụm. Shift trên chính ô `.Label` thì người dùng đang nhắm vào
  // cái nhãn — xoá luôn control là làm nhiều hơn họ yêu cầu.
  const takeAll = msg.withField === true && cell.token.kind === 'input' && !!name;

  // Văn bản của mọi file sắp bị đụng, đọc TRƯỚC: core thuần nên nó không tự mở file được.
  const files = new Set([row.range.file]);
  if (takeAll) {
    for (const r of model.rows) {
      if (!r.range) continue;
      for (const c of r.cells ?? []) {
        if (c.token?.field === name && COMPANION_KINDS.has(c.token.kind)) files.add(r.range.file);
      }
    }
  }
  const texts = new Map();
  for (const f of files) {
    texts.set(String(f).toLowerCase(), (await openTarget(f, hostDocument)).getText());
  }

  const plan = core.planRemoveControl(
    model,
    { item: msg.item, cell: msg.cell, companions: takeAll },
    (f) => texts.get(String(f).toLowerCase()) ?? null,
  );
  if (!plan.ok) {
    warnReason(plan.reason);
    return false;
  }

  /*
   * Còn ai dùng field này nữa không — hỏi trên phần CÒN LẠI sau phép xoá, không trên model cũ.
   *
   * Hỏi trên model cũ thì chính mấy ô đang bị xoá vẫn được tính là "còn dùng", và khai báo
   * `<field>` không bao giờ xoá được — đúng cái bẫy bản trước đã mắc.
   */
  const stillUsed = name !== null && model.rows.some((r) => (r.cells ?? []).some((c) => c.token?.field === name
    && c !== cell
    && !(takeAll && COMPANION_KINDS.has(c.token.kind))));

  const rowDoc = await openTarget(row.range.file, hostDocument);
  const decl = takeAll && !stillUsed ? findFieldDecl(name, [hostDocument, rowDoc]) : null;

  const gone = plan.edits.filter((e) => e.text === '').length;
  const label = name ? `[${name}]` : 'control này';
  const notes = [
    takeAll ? 'Kèm Label / Footer / Description của nó.' : null,
    gone > 0 ? `${gone} hàng không còn control nào sẽ bị bỏ hẳn thẻ <item>.` : null,
    stillUsed && msg.withField ? `Khai báo <field name="${name}"> vẫn giữ — còn hàng khác dùng.` : null,
  ].filter(Boolean);

  let dropDecl = decl !== null;
  if (config().confirmDelete) {
    // Hai nút đồng ý mang hai nghĩa khác nhau, nên mỗi nút một id riêng — `ask()` trả về id đó,
    // không phải nhãn. So theo nhãn là thứ vỡ ngay lần đầu ai đó sửa chữ trên nút.
    const buttons = [{ id: 'cancel', label: t('dialog.btn.cancel'), variant: 'secondary', action: 'cancel' }];
    if (decl) {
      buttons.push({ id: 'controlOnly', label: t('extension.delete_control_only'), variant: 'secondary', action: 'confirm' });
      buttons.push({ id: 'withDecl', label: t('extension.delete_with_field'), variant: 'danger', action: 'confirm' });
    } else {
      buttons.push({ id: 'controlOnly', label: t('dialog.btn.delete'), variant: 'danger', action: 'confirm' });
    }
    const answer = await dialogs().ask({
      type: 'warning',
      title: t('extension.delete_title', { label }),
      size: 'small',
      body: notes.length ? [{ type: 'list', items: notes }] : [],
      buttons,
    });
    if (!answer) return false;
    dropDecl = answer === 'withDecl';
  }

  const edits = dropDecl && decl
    ? [...plan.edits, { file: decl.file, start: decl.start, end: decl.end, text: '' }]
    : plan.edits;

  return applySplice({ ok: true, edits, warning: plan.warning }, hostDocument, output, `xoá ${label}`);
}

/**
 * Khai báo `<field name="x">` nằm ở file nào — thử lần lượt, lấy chỗ đầu tiên thấy.
 *
 * Thứ tự có chủ ý: controller đang mở TRƯỚC, rồi mới tới file chứa hàng. `<fields>` gần như
 * luôn ở controller kể cả khi hàng đến từ Include, và bản trước chỉ tìm trong file chứa hàng
 * nên Shift+Delete trên một hàng của Include không bao giờ tìm ra khai báo để xoá.
 */
function findFieldDecl(name, documents) {
  for (const doc of documents) {
    const span = fieldTagSpan(doc.getText(), name);
    if (span) return { file: doc.uri.fsPath, ...span };
  }
  return null;
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

/**
 * Model của lưới đang sửa, và FILE nào sở hữu nó.
 *
 * Hai lối vào, và chúng phải cho ra hai model khác nhau:
 *
 *   lưới ĐỨNG RIÊNG   người dùng mở thẳng `Grid/X.xml`. Dùng lại đúng model mà `render()` vừa
 *                     vẽ — nó đã gộp `Grid/Config` (cột ẩn, `arrangement`), thứ mà một model
 *                     dựng lại từ mỗi file lưới KHÔNG có. Dựng lại ở đây là edit nhìn thấy một
 *                     bộ cột khác bộ đang hiện trên màn hình, và mọi cột đến từ Config sẽ báo
 *                     «không có cột …» dù nó nằm sờ sờ đó.
 *   lưới NHÚNG        lưới nằm trong tab của một form. `renderEmbeddedGrid` KHÔNG gộp Config,
 *                     nên ở đây cũng không được gộp — dựng lại từ file lưới là đúng.
 */
function gridModelFor(msg, core, hostDocument, rebuild) {
  const built = typeof rebuild === 'function' ? rebuild() : null;
  if (built && built.mode === 'grid' && built.model) {
    return { model: built.model, file: hostDocument.uri.fsPath };
  }
  return detailGridModel(core, hostDocument, msg.grid);
}

/** Kéo giãn / chèn / xoá / dời một cột lưới. Mọi splice rơi vào file của LƯỚI, không vào form chứa nó. */
async function handleColumnEdit(msg, core, hostDocument, output, rebuild) {
  const grid = gridModelFor(msg, core, hostDocument, rebuild);
  if (!grid) {
    vscode.window.showWarningMessage(toast('extension.grid_unread', { grid: msg.grid }));
    return false;
  }

  const target = await openTarget(grid.file, hostDocument);
  const sourceText = target.getText();

  let plan;
  if (msg.op === 'colWidth') {
    plan = core.planColumnWidth(grid.model, msg.column, Number(msg.width), sourceText);
  } else if (msg.op === 'colRemove') {
    // Delete = bỏ khỏi <view>, giữ <field>. Shift+Delete = bỏ cả hai (cùng luật form).
    const withField = msg.withField === true;
    const col = grid.model.columns.find((c) => c.name === msg.column);
    // Cột từ Config/Initialize là khai báo DÙNG CHUNG — Shift+Delete không được cắt <field>
    // của cả nhóm controller. Chỉ cho bỏ khỏi view của lưới này.
    if (withField && col?.configKind) {
      vscode.window.showWarningMessage(
        `FBO Designer: cột "${msg.column}" đến từ cấu hình ẩn (${col.configKind}) — không xoá <field> dùng chung bằng Shift+Delete. Bấm Delete để chỉ bỏ khỏi view.`,
      );
      return false;
    }
    if (config().confirmDelete) {
      const answer = await dialogs().ask({
        type: 'warning',
        title: withField
          ? `Xoá cột "${msg.column}" và khai báo <field>?`
          : `Bỏ cột "${msg.column}" khỏi lưới?`,
        size: 'small',
        body: [{
          type: 'text',
          content: withField
            ? 'Xoá chỗ dùng trong <view> và cả thẻ <field> trong <fields>.'
            : 'Khai báo <field> vẫn giữ nguyên.',
        }],
        buttons: [
          { id: 'cancel', label: t('dialog.btn.cancel'), variant: 'secondary', action: 'cancel' },
          {
            id: 'go',
            label: withField ? 'Xoá cột + field' : 'Bỏ cột',
            variant: 'danger',
            action: 'confirm',
          },
        ],
      });
      if (answer !== 'go') return false;
    }
    plan = core.planRemoveColumn(grid.model, msg.column, sourceText);
    if (plan.ok && withField) {
      // Khai báo <field> thường cùng file lưới; nếu nằm Include thì fieldTagStart chỉ file.
      const fieldFile = col?.fieldTagStart?.file || grid.file;
      const fieldDoc = await openTarget(fieldFile, hostDocument);
      const decl = fieldTagSpan(fieldDoc.getText(), msg.column);
      if (!decl) {
        vscode.window.showWarningMessage(
          `FBO Designer: đã bỏ cột khỏi view nhưng không tìm thấy <field name="${msg.column}"> để xoá.`,
        );
      } else {
        plan = { ...plan, extra: { ...decl, file: fieldFile } };
      }
    }
  } else if (msg.op === 'colMove') {
    const side = msg.side === 'before' ? 'before' : 'after';
    const anchor = msg.anchor || msg.before || msg.after;
    if (!anchor) {
      vscode.window.showWarningMessage(toast('extension.no_anchor_col'));
      return false;
    }
    plan = core.planMoveColumn(grid.model, msg.column, anchor, side, sourceText);
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
      // `width: true` — cột lưới có bề rộng riêng, hỏi luôn lúc tạo. Xem `askNewControl`.
      const made = await askNewControl(core, { width: true });
      if (!made) return false;
      name = made.name;
      /*
       * Khai báo `<field>` của một cột lưới đi vào `<fields>` CỦA CHÍNH FILE LƯỚI — không bao
       * giờ vào controller chứa nó.
       *
       * Bản trước dùng `fieldsHost`, thứ rơi về controller đang mở khi file lưới không có
       * `<fields>`. Với lưới nhúng thì đó là một cái bẫy im lặng: cột được thêm vào `<view>` của
       * `Grid/X.xml` trong khi khai báo của nó nằm ở `Dir/Y.xml`, hai file khác hẳn nhau. Runtime
       * đọc lưới thì không thấy `<field>` nào tên ấy — cột hiện ra rỗng, và không có gì nối hai
       * chỗ đó lại với nhau khi đi tìm nguyên nhân.
       *
       * Không có `<fields>` trong file lưới thì TỪ CHỐI kèm lý do, chứ không đoán sang file khác.
       */
      if (!/<fields/i.test(sourceText)) {
        vscode.window.showWarningMessage(
          `FBO Designer: ${grid.file.split(/[\\/]/).pop()} không có <fields> để thêm khai báo cột vào.`
          + ' Thêm tay khối <fields> rồi thử lại — khai báo cột lưới không được đặt sang file khác.',
        );
        return false;
      }
      declare = core.planAddField(sourceText, made.xml, made.name);
      if (!declare.ok) {
        warnReason(declare.reason);
        return false;
      }
      declare = { ...declare, splice: { ...declare.splice, file: grid.file } };
    }
    plan = core.planInsertColumn(grid.model, msg.column, msg.side, name, sourceText);
    if (plan.ok && declare) plan = { ...plan, extra: declare.splice };
  }

  if (!plan.ok) {
    warnReason(plan.reason);
    return false;
  }
  return applySplice(plan, hostDocument, output, `${msg.op} cột "${msg.column}"`);
}

/**
 * Hỏi bề rộng hai nửa khi tách một cột.
 *
 * Điền sẵn chia đôi, và chấp nhận cả `"30"` lẫn `"30, 30"`: gõ một số thì nửa phải lấy phần
 * còn lại, tức tổng bề rộng của vùng không đổi và không có gì bên phải chỗ tách bị dịch chỗ —
 * ca thường gặp nhất. Gõ hai số thì theo hai số, kể cả khi tổng khác đi; đó là quyết định của
 * người dùng, và họ vừa nói ra nó bằng cách gõ số thứ hai.
 *
 * KHÔNG có mặc định câm: form FBO không có đường nào khác để sửa px của một cột (px nằm ở list
 * cột dùng chung, không ở từng ô), nên tách xong mà không hỏi là để lại hai cột không chỉnh
 * được bằng chuột.
 *
 * @returns {Promise<{left:number, right:number}|null>} `null` = người dùng bỏ (Esc)
 */
async function askSplitWidths(width, col) {
  const half = Math.floor(width / 2);
  const answer = await vscode.window.showInputBox({
    title: `Tách cột ${col + 1} (${width}px) — bề rộng hai nửa`,
    value: `${half}, ${width - half}`,
    prompt: 'Một số = nửa trái, phần còn lại cho nửa phải (tổng giữ nguyên). Hai số = lấy đúng hai số đó.',
    validateInput: (v) => {
      const parts = String(v).split(',').map((t) => t.trim()).filter((t) => t !== '');
      if (parts.length < 1 || parts.length > 2) return 'Gõ một số, hoặc hai số ngăn bằng dấu phẩy';
      if (!parts.every((t) => /^\d+$/.test(t))) return 'Bề rộng là số nguyên px ≥ 0, ví dụ 30 hoặc 30, 30';
      if (parts.length === 1 && Number(parts[0]) > width) {
        return `Nửa trái ${parts[0]}px lớn hơn cả cột (${width}px) — gõ thêm số thứ hai nếu muốn nới rộng vùng`;
      }
      return null;
    },
  });
  if (answer === undefined) return null; // Esc
  const parts = String(answer).split(',').map((t) => Number(t.trim())).filter((n) => Number.isFinite(n));
  const left = parts[0];
  return { left, right: parts.length > 1 ? parts[1] : width - left };
}

/**
 * Tách / gộp BIÊN CỘT của một vùng form — phép sửa duy nhất đụng tới thứ dùng chung giữa nhiều hàng.
 *
 * Ba chỗ khác hẳn mọi `op` còn lại của `handleEdit`, và cả ba là lý do nó phải là hàm riêng:
 *
 *   1. NHIỀU FILE cùng lúc, và không biết trước là những file nào. Ký tự pattern thật sự đổi có
 *      thể nằm gọn trong khai báo của một `&Split;` ở file thứ ba. Core tính trước dải cần ghi
 *      (không cần văn bản để làm việc đó) rồi cho biết danh sách file — `regionColumnFiles`.
 *   2. HỎI TRƯỚC KHI GHI, luôn luôn. Người dùng bấm vào một con số trên dải px và tưởng mình
 *      sửa một cột; sự thật là mọi hàng dùng chung danh sách biên ấy đều bị viết lại, kể cả
 *      hàng ở tab đang đóng và hàng nằm trong Include của khách khác. Con số cụ thể (mấy hàng,
 *      mấy file) chỉ core biết, nên hộp thoại phải đợi kế hoạch xong mới hiện được.
 *   3. Không dùng `confirmForeign` của `applySplice`: nó hỏi về MỘT file, còn ở đây danh sách
 *      file đã nằm sẵn trong hộp thoại ở bước 2 — hỏi lần nữa là hỏi hai lần cùng một chuyện.
 */
async function handleRegionColumns(msg, core, hostDocument, output, rebuild) {
  const built = rebuild();
  if (!built || !built.model || built.mode !== 'form') {
    vscode.window.showWarningMessage(toast('extension.col_ops_form_only'));
    return false;
  }
  const model = built.model;
  const region = (model.regions ?? []).find((r) => r.id === msg.region);
  if (!region) {
    vscode.window.showWarningMessage(toast('edit.region_missing', { region: msg.region }));
    return false;
  }

  const col = Number(msg.col);
  const split = msg.op === 'colSplit';
  const op = { kind: split ? 'splitColumn' : 'mergeColumn', region: msg.region, col };

  if (split) {
    const width = region.widths[col];
    if (!Number.isFinite(width)) {
      vscode.window.showWarningMessage(toast('extension.col_width_unread', { col: col + 1 }));
      return false;
    }
    const halves = await askSplitWidths(width, col);
    if (!halves) return false;
    op.left = halves.left;
    op.right = halves.right;
  }

  /*
   * Mở MỌI file trước, rồi mới lập kế hoạch thật.
   *
   * `regionColumnFiles` chạy được mà không cần văn bản nào — nó chỉ quy toạ độ. Nhờ vậy gỡ được
   * vòng luẩn quẩn «muốn đối chiếu thì phải mở file, muốn biết mở file nào thì phải tính xong».
   * Danh sách rỗng nghĩa là kế hoạch đã hỏng ngay từ bước tính; gọi tiếp `planRegionColumns` để
   * lấy đúng câu từ chối thay vì tự nghĩ ra một câu khác.
   */
  const texts = [];
  for (const file of core.regionColumnFiles(model, op)) {
    const doc = await openTarget(file, hostDocument);
    texts.push({ file, text: doc.getText() });
  }
  const readSource = (file) => texts.find((t) => samePath(t.file, file))?.text ?? null;

  const plan = core.planRegionColumns(model, op, readSource);
  if (!plan.ok) {
    warnReason(plan.reason);
    return false;
  }

  const host = hostDocument.uri.fsPath;
  const foreign = plan.summary.files.filter((f) => !samePath(f, host));
  const rows = [
    { key: 'Danh sách biên', value: plan.summary.owner },
    { key: 'Vùng dùng chung nó', value: plan.summary.regions.join(', ') },
    { key: 'Hàng phải dồn lại', value: `${plan.summary.rows}` },
  ];
  if (foreign.length > 0) {
    rows.push({ key: 'File dùng chung bị sửa', value: foreign.map((f) => f.split(/[\\/]/).pop()).join(', ') });
  }

  const answer = await dialogs().ask({
    type: 'warning',
    title: split ? `Tách cột ${col + 1} thành hai?` : `Gộp cột ${col + 1} với cột ${col + 2}?`,
    subtitle: msg.region,
    size: 'small',
    body: [
      {
        type: 'text',
        content: 'Danh sách biên cột dùng chung cho nhiều hàng — sửa nó thì pattern của MỌI hàng'
          + ' đọc nó phải dồn theo, kể cả hàng ở tab đang đóng.'
          + (foreign.length > 0 ? ' Có file dùng chung trong danh sách dưới đây.' : ''),
      },
      { type: 'details', rows },
    ],
    buttons: [
      { id: 'cancel', label: t('dialog.btn.cancel'), variant: 'secondary', action: 'cancel' },
      { id: 'go', label: split ? 'Tách cột' : 'Gộp cột', variant: foreign.length > 0 ? 'danger' : 'primary' },
    ],
  });
  if (answer !== 'go') return false;

  // `warning: null` — danh sách file dùng chung đã nằm trong hộp thoại vừa rồi; để `applySplice`
  // hỏi thêm một lần nữa là hỏi hai lần cùng một chuyện, và lần thứ hai còn nói được ít hơn.
  return applySplice(
    { edits: plan.edits, warning: null },
    hostDocument,
    output,
    `${split ? 'tách' : 'gộp'} cột ${col + 1} của ${msg.region}`,
  );
}

module.exports = { handleEdit, applySplice, encodingBlocks, productFileBlocks, fieldTagSpan, spliceList };
