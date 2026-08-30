// designer-webview.js — theo dõi webview designer đang hiện để gửi hotkey từ host.
//
// VS Code nuốt một số phím (Delete, …) trước khi chúng tới document của webview — capture
// listener trong webview không thấy gì cả (đo được: chọn cột có log, Delete thì không). Host
// bắt phím bằng keybinding rồi `postMessage` sang webview đang active.

/** @type {import('vscode').Webview | null} */
let activeWebview = null;

/** @type {WeakMap<import('vscode').Webview, () => void>} */
const disposers = new WeakMap();

/**
 * Gắn một webview vào hàng đợi «đang dùng». `onGone` gọi khi panel dispose.
 * @param {import('vscode').Webview} webview
 * @param {{ onDidChangeViewState?: (listener: (e: { webviewPanel: { visible: boolean, active?: boolean } }) => void) => { dispose(): void }, onDidDispose?: (listener: () => void) => { dispose(): void }, visible?: boolean }} [panel]
 */
function trackDesignerWebview(webview, panel) {
  if (!webview) return;
  activeWebview = webview;

  const subs = [];
  if (panel && typeof panel.onDidChangeViewState === 'function') {
    subs.push(panel.onDidChangeViewState((e) => {
      const p = e.webviewPanel || panel;
      if (p.visible) activeWebview = webview;
    }));
  }
  if (panel && typeof panel.onDidDispose === 'function') {
    subs.push(panel.onDidDispose(() => {
      if (activeWebview === webview) activeWebview = null;
      for (const s of subs) {
        try { s.dispose(); } catch { /* ignore */ }
      }
    }));
  }
  disposers.set(webview, () => {
    if (activeWebview === webview) activeWebview = null;
    for (const s of subs) {
      try { s.dispose(); } catch { /* ignore */ }
    }
  });
}

/** @returns {import('vscode').Webview | null} */
function activeDesignerWebview() {
  return activeWebview;
}

/**
 * @param {object} msg
 * @returns {boolean}
 */
function postToActiveDesigner(msg) {
  if (!activeWebview) return false;
  try {
    activeWebview.postMessage(msg);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  trackDesignerWebview,
  activeDesignerWebview,
  postToActiveDesigner,
};
