// mail-apply.js — phần chung của hai lối vào mẫu mail: panel «Xem mail» (`mail-preview-host.js`)
// và Email Designer (`mail-designer-editor.js`).
//
// Hai việc, và chỉ hai: quy kế hoạch sửa (toạ độ clearText) về file nguồn, và mở XML đúng dải.
// Ghi thì vẫn là `edit-host.js#applySplice` — không có đường ghi thứ hai.

const vscode = require('vscode');
const { samePath } = require('./render-host');

/**
 * Kế hoạch `{edits}` của core → danh sách edit theo file nguồn, cộng file NGOÀI Message.xml bị
 * đụng (nếu có) để `applySplice` hỏi lại qua `confirmForeign`.
 *
 * Quy đổi nằm ở core (`mapMailEdits`, test được headless): điểm chèn không đệm ký tự nào, dải
 * thay phải nằm trọn trong một đoạn nguồn.
 *
 * @returns {{ok:true, edits:Array<{file,start,end,text}>, foreignFile:string|null}|{ok:false, reason:string}}
 */
function toSourcePlan(core, segments, plan, hostPath) {
  const mapped = core.mapMailEdits(segments, plan.edits);
  if (!mapped.ok) return mapped;
  const foreignFile = mapped.edits.find((e) => !samePath(e.file, hostPath))?.file ?? null;
  return { ok: true, edits: mapped.edits, foreignFile };
}

/**
 * Mở (hoặc focus lại) đúng vị trí `[start,end)` của `file` trong một text editor.
 *
 * Ưu tiên editor ĐANG MỞ SẴN nhìn thấy được — không ép người dùng rời bố cục đang có; hết cách
 * mới mở file mới ở cột 1. Cùng tinh thần `render-host.js#revealIn`.
 */
async function revealSpan(file, start, end) {
  const target = String(file).toLowerCase();
  const visibleEditor = vscode.window.visibleTextEditors.find((e) => e.document.uri.fsPath.toLowerCase() === target);
  const doc = visibleEditor ? visibleEditor.document : await vscode.workspace.openTextDocument(vscode.Uri.file(file));
  const range = new vscode.Range(doc.positionAt(start), doc.positionAt(end));
  const editor = await vscode.window.showTextDocument(doc, {
    viewColumn: visibleEditor ? visibleEditor.viewColumn : vscode.ViewColumn.One,
    preserveFocus: false,
    preview: false,
    selection: range,
  });
  editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

module.exports = { toSourcePlan, revealSpan };
