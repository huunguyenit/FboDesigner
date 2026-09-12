// designer-session.js — dispatch message dùng CHUNG giữa `designer-editor.js` (custom editor,
// một document cố định suốt vòng đời) và `preview-panel.js` (panel duy nhất, bám theo file đang
// active). Trước khi tách, cả hai xử lý ĐÚNG CÙNG một tập `msg.type` theo cùng luật — khác nhau
// chỉ ở "document nào", "vẽ lại kiểu gì" — nên toàn bộ khối này (kể cả comment) từng bị chép tay
// y hệt ở hai nơi.
//
// KHÔNG sở hữu: `ensureShell`/programKey, hàng đợi `pending`/`ready`, `track`/`contributes` — ba
// thứ đó chỉ `PreviewPanel` cần (nó bám theo file đang active, `FboDesignerProvider` thì không),
// nên ở lại đúng file của nó.

/*
 * KHÔNG `require('./edit-host')`/`require('./edit-history')`/… ở đây, dù cả hai chỗ gọi đều
 * dùng đúng một bản thật. `designer-session.js` được `require` MỘT LẦN (Node cache theo đường
 * dẫn) và dùng CHUNG bởi cả hai file — module nào require nó trước sẽ khoá cứng các collaborator
 * này vào bản đã nạp lúc đó. Test tầng vỏ giả `vscode`/`./edit-host`/… bằng cách ghi đè
 * `Module._load` RIÊNG cho từng file test; nếu import ở đây, file test chạy sau (cùng tiến
 * trình `extension/test/run.mjs`) sẽ vô tình dùng lại bản giả của file test chạy trước. Nhận
 * qua `ctx` thay vì `require` ở top-level là để mỗi chỗ gọi tự mang đúng bản nó đã `require`.
 */

/**
 * Bốn phép sửa chỉ đụng ĐÚNG MỘT hàng, nên cả bốn vá cục bộ được — không riêng `resize`.
 *
 * `move`, `insert`, `remove` đều chỉ ghi lại `value` của một thẻ `<item>`. Bắt chúng đi đường vẽ
 * lại TOÀN BỘ là nguyên nhân của cái giật: `formLayer.innerHTML = …` dựng lại cả form, nên
 * control còn nằm ở chỗ cũ suốt vòng gửi–ghi–lưu–vẽ rồi mới nhảy sang chỗ mới, kéo theo mất tab
 * đang mở và mất vị trí cuộn.
 *
 * `addRow` thì KHÔNG: nó thêm hẳn một hàng mới, không có hàng cũ nào để mà vá.
 *
 * Shift+Delete thì KHÔNG vá cục bộ, dù `remove` vốn nằm trong danh sách: nó kéo theo cả cụm —
 * `[x].Label` cùng hàng, nhưng `[x].Description`/`[x].Footer` thường ở HÀNG KHÁC. Cứ vẽ lại toàn
 * bộ: đằng nào cũng nhiều hàng đổi (xoá thường vẫn vá được — hàng biến mất hẳn thì
 * `renderRowHtml` trả null và `render()` tự rơi về vẽ lại toàn bộ).
 *
 * `col` chỉ có ở `move` — sau khi dời, control nằm ở CỘT khác. `swap` chọn lại ô `other`, KHÔNG
 * phải ô `cell`: đổi chỗ giữ nguyên pattern nên mọi chỉ số ô đứng yên, và trong slot cũ giờ là
 * control KIA.
 */
const PATCHABLE = new Set(['resize', 'move', 'swap', 'insert', 'remove']);

function localEditFor(msg) {
  const sameRowMove = msg.op === 'move' || msg.op === 'swap'
    ? !Number.isFinite(Number(msg.toItem)) || Number(msg.toItem) === Number(msg.item)
    : true;
  const patchable = PATCHABLE.has(msg.op)
    && !(msg.op === 'remove' && msg.withField === true)
    && sameRowMove;
  if (!patchable) return null;
  return {
    item: msg.item,
    cell: msg.op === 'swap' ? msg.other : msg.cell,
    col: msg.op === 'move' ? msg.col : undefined,
  };
}

/**
 * Xử lý một message từ webview của designer (form/lưới FBO — KHÔNG phải Email Designer, nó có
 * giao kèo riêng qua `MailDesignSession`). Trả `true` nếu đã nhận diện `msg.type`.
 *
 * Chỗ gọi PHẢI tự kiểm `overlay.handleMessage(msg)` trước khi gọi hàm này — không kiểm lại ở
 * đây, vì `PreviewPanel` cần đúng MỘT lượt gọi `handleMessage` trước khi tự rẽ nhánh `ready`
 * riêng (hàng đợi `pending`), và gọi hai lượt tuy vô hại (`settle` tự chặn resolve hai lần) vẫn
 * là hai lần xử lý cho một thông điệp lẽ ra chỉ nên xử lý một lần.
 *
 * `ctx` — đúng những chỗ hai lối mở (`FboDesignerProvider` / `PreviewPanel`) khác nhau, CỘNG bốn
 * collaborator lẽ ra là module-level import (xem lý do KHÔNG import ở đầu file, phía trên):
 *   document          TextDocument đang vẽ tại THỜI ĐIỂM GỌI (cố định hoặc đổi theo `track`)
 *   core, output      như cũ
 *   overlay           `OverlayDialogs` của webview này — dùng cho `runWithDialogs`
 *   handleEdit        `require('./edit-host').handleEdit` của chính file gọi
 *   history           `require('./edit-history').history` của chính file gọi
 *   runWithDialogs    `require('./dialog/dialog-service').runWithDialogs` của chính file gọi
 *   revealSource      `require('./render-host').revealSource` của chính file gọi
 *   setVi(v)          gán nhãn form; `render()` bên dưới tự đọc lại biến đã đổi qua closure
 *   render()          vẽ lại toàn bộ NGAY (không debounce) — cho `ready`/`setLang`
 *   setEditing(v)     bật/tắt chốt "đang sửa" — xem `renderSoon`/`finishEdit` ở từng file
 *   setPendingLocalEdit(v)  { item, cell, col } cho lượt vẽ patch cục bộ sắp tới, hoặc null
 *   finishEdit()      thả chốt sau khi phép sửa/hoàn tác ngã ngũ
 *   buildRebuild()    trả về hàm `rebuild()` cho `handleEdit` (chỉ cần model, `skipHtml:true`)
 *   bumpBust()        tăng bộ đếm nạp-lại-tài-nguyên, trả về giá trị mới — cho `reloadAssets`
 *   rebuildShell()    dựng lại shell (script mới tự gửi `ready` → `render()`)
 */
async function dispatchDesignerMessage(msg, ctx) {
  if (msg.type === 'ready') {
    if (typeof msg.vi === 'boolean') ctx.setVi(msg.vi);
    ctx.render();
    return true;
  }

  if (msg.type === 'setLang') {
    ctx.setVi(msg.vi !== false);
    ctx.render();
    return true;
  }

  if (msg.type === 'select') {
    await ctx.revealSource(msg, ctx.document, ctx.output);
    return true;
  }

  // Ctrl+Z / Ctrl+Y bấm trong webview — undo của VS Code không với tới đây, vì editor active lúc
  // này chính là webview, không phải TextEditor nào. Chồng hoàn tác dùng chung với panel/editor
  // kia; xem `edit-history.js`. Cùng chốt `editing` với phép sửa: hoàn tác cũng là `applyEdit` +
  // `save()`, và còn chạm nhiều file hơn vì nó lùi cả cụm splice một lượt.
  if (msg.type === 'undo' || msg.type === 'redo') {
    ctx.setEditing(true);
    try {
      await ctx.runWithDialogs(ctx.overlay, () => (msg.type === 'undo'
        ? ctx.history(ctx.output).undo()
        : ctx.history(ctx.output).redo()));
    } catch (err) {
      ctx.output.appendLine(`${msg.type} lỗi: ${err.stack || err.message}`);
    } finally {
      ctx.finishEdit();
    }
    return true;
  }

  // SỬA — dựng lại model từ VĂN BẢN HIỆN TẠI mỗi lần, không dùng lại model của lần render trước:
  // người dùng có thể vừa gõ tay vào XML và offset cũ đã lệch. `handleEdit` là chỗ DUY NHẤT biết
  // luật sửa; hai lối mở chỉ khác nhau ở câu hỏi "document nào" (`ctx.document`).
  if (msg.type === 'edit') {
    let localEdit = localEditFor(msg);
    ctx.setEditing(true);
    try {
      const applied = await ctx.runWithDialogs(
        ctx.overlay,
        () => ctx.handleEdit(msg, ctx.core, ctx.document, ctx.buildRebuild(), ctx.output),
      );
      if (!applied) localEdit = null;
      if (localEdit) ctx.setPendingLocalEdit(localEdit);
    } catch (err) {
      localEdit = null;
      ctx.setPendingLocalEdit(null);
      ctx.output.appendLine(`sửa lỗi: ${err.stack || err.message}`);
    } finally {
      // Hộp thoại bị Esc, phép sửa bị từ chối, hay handler ném — cả ba đều phải thả chốt. Kẹt
      // `editing` ở `true` là preview đứng hình vĩnh viễn.
      ctx.finishEdit();
    }
    return true;
  }

  if (msg.type === 'reloadAssets') {
    const bust = ctx.bumpBust();
    ctx.output.appendLine(`nạp lại tài nguyên (bust=${bust})`);
    ctx.rebuildShell(); // shell mới chạy lại script → script tự gửi `ready` → render()
    return true;
  }

  if (msg.type === 'assets') {
    ctx.output.appendLine(`[P0 câu hỏi 2] CSS khai ${msg.declared}, webview nạp được ${msg.loaded}, hỏng ${msg.failed}`);
    for (const href of msg.failedHrefs || []) ctx.output.appendLine(`  không nạp được: ${href}`);
    return true;
  }

  if (msg.type === 'log') {
    ctx.output.appendLine(String(msg.text));
    return true;
  }

  return false;
}

module.exports = { dispatchDesignerMessage, PATCHABLE, localEditFor };
