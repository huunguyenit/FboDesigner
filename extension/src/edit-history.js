// edit-history.js — hoàn tác cho thao tác thực hiện TỪ TRONG designer.
//
// Vì sao phải tự làm, trong khi cả tầng ghi đã cố tình đi qua `WorkspaceEdit` để mượn undo của
// VS Code: undo của VS Code gắn vào EDITOR ĐANG ACTIVE. Khi người dùng đang đứng trong webview
// designer thì editor active là chính cái webview — không phải TextEditor nào cả — nên
// `Ctrl+Z` không có gì để bám, và lệnh `undo` của workbench không chạy. Nhìn ra ngoài đúng như
// «bấm Ctrl+Z trên design thì không hoàn tác được».
//
// Nên designer giữ một chồng hoàn tác RIÊNG cho những phép sửa do chính nó gây ra. Nó KHÔNG
// thay undo của editor: gõ tay trong XML thì vẫn là undo của VS Code lo, và hai chồng không
// biết nhau. Chúng cũng không cần biết — chồng này chỉ nhận vào thứ nó tự ghi ra.
//
// Ảnh chụp là TOÀN VĂN file, không phải splice ngược. Splice ngược phải tự tính lại offset sau
// mỗi phép áp, và một phép sửa của designer có thể chạm hai file cùng lúc (hàng ở Include, khai
// báo `<field>` ở controller) — cộng thêm phần VS Code tự chỉnh khi lưu (trim khoảng trắng,
// thêm newline cuối) thì offset ngược không còn đúng nữa. Controller FBO tính bằng chục KB;
// chụp cả file rẻ hơn nhiều so với một phép hoàn tác ghi trượt.

const vscode = require('vscode');
const { t, toast } = require('./locale');

/** Bao nhiêu bước lùi được. Đủ cho một phiên kéo thả, và không giữ mãi vài chục MB văn bản. */
const LIMIT = 50;

class EditHistory {
  constructor(output) {
    this.output = output;
    this.undoStack = [];
    this.redoStack = [];
  }

  /**
   * Ghi lại một phép sửa vừa áp xong.
   *
   * @param label   tên thao tác, để nói lại cho người dùng lúc hoàn tác
   * @param frames  [{uri, before, after}] — toàn văn từng file TRƯỚC và SAU
   */
  record(label, frames) {
    const real = frames.filter((f) => f.before !== f.after);
    if (real.length === 0) return;
    this.undoStack.push({ label, frames: real });
    if (this.undoStack.length > LIMIT) this.undoStack.shift();
    // Làm một việc mới thì nhánh redo cũ không còn nối vào đâu được nữa — cùng luật với mọi
    // trình soạn thảo. Giữ lại là cho phép "redo" ra một trạng thái chưa từng tồn tại.
    this.redoStack.length = 0;
  }

  canUndo() { return this.undoStack.length > 0; }

  canRedo() { return this.redoStack.length > 0; }

  undo() { return this.step(this.undoStack, this.redoStack, 'after', 'before', 'Hoàn tác'); }

  redo() { return this.step(this.redoStack, this.undoStack, 'before', 'after', 'Làm lại'); }

  /**
   * Một bước lùi (hoặc tiến).
   *
   * `expect` là trạng thái file PHẢI đang mang thì bước này mới có nghĩa. Không khớp nghĩa là
   * người dùng đã gõ tay vào file sau đó — hoàn tác khi ấy sẽ NUỐT LUÔN những gì họ vừa gõ.
   * Thà từ chối và nói rõ: đó là cùng thái độ với cả tầng ghi (`canEditRow`).
   */
  async step(from, to, expect, apply, verb) {
    const entry = from.pop();
    if (!entry) {
      vscode.window.showInformationMessage(`FBO Designer: không còn gì để ${verb.toLowerCase()}.`);
      return false;
    }

    const docs = [];
    for (const frame of entry.frames) {
      let doc;
      try {
        doc = await vscode.workspace.openTextDocument(frame.uri);
      } catch (err) {
        from.push(entry);
        vscode.window.showWarningMessage(`FBO Designer: không mở lại được ${frame.uri.fsPath} — ${err.message}`);
        return false;
      }
      if (doc.getText() !== frame[expect]) {
        from.push(entry);
        vscode.window.showWarningMessage(
          `FBO Designer: ${frame.uri.fsPath.split(/[\\/]/).pop()} đã đổi sau thao tác đó`
          + ` — ${verb.toLowerCase()} sẽ nuốt mất thay đổi mới. Dùng Ctrl+Z ngay trong file XML.`,
        );
        return false;
      }
      docs.push({ doc, text: frame[apply] });
    }

    const edit = new vscode.WorkspaceEdit();
    for (const { doc, text } of docs) {
      edit.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), text);
    }
    if (!(await vscode.workspace.applyEdit(edit))) {
      from.push(entry);
      vscode.window.showWarningMessage(`FBO Designer: VS Code từ chối ${verb.toLowerCase()}.`);
      return false;
    }
    for (const { doc } of docs) await doc.save();

    to.push(entry);
    this.output.appendLine(`${verb.toLowerCase()}: ${entry.label} (${entry.frames.length} file)`);
    return true;
  }
}

/**
 * MỘT chồng cho cả phiên, dùng chung giữa panel và custom editor.
 *
 * Hai lối mở designer có thể cùng trỏ vào một file, và chúng gọi chung `applySplice`. Mỗi lối
 * một chồng riêng thì hoàn tác từ lối này không thấy phép sửa vừa làm ở lối kia — và tệ hơn,
 * hai chồng có thể áp chồng lên nhau cùng một file.
 */
let shared = null;

function history(output) {
  if (!shared) shared = new EditHistory(output);
  return shared;
}

module.exports = { EditHistory, history };
