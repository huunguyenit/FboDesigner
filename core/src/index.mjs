// index.mjs — bề mặt công khai của fbo-core.
//
// Luật kiến trúc (ADR-0002): file nào trong core cũng KHÔNG được import `vscode`, KHÔNG chạm
// DOM, và KHÔNG ghi filesystem. Mọi phép sửa layout là hàm thuần trả về model mới cộng danh
// sách splice; ai ghi là việc của tầng extension. Mất luật này là mất khả năng test headless.

export { readSource, decodeSource, encodeWindows1258, stripAccents } from './encoding.mjs';
export { scanViews, scanFields, scanTitle, scanToolbar, scanCss, scanRoot, applySplices } from './spans.mjs';
export { resolveProgramPaths } from './program.mjs';
export { expandEntities, findInternalSubset, resolveSystemPath, segmentAt, mapToSource, sourceRange, hostRefAt } from './entities.mjs';
export { renderControl, renderGridControl, containerClass, isDisabled, isTextArea, resolveLocaleName } from './control.mjs';
export { buildGridModel, renderGridHtml, renderGrid, applyArrangement } from './grid.mjs';
export {
  classifyItem,
  parseWidths,
  parseToken,
  parseRow,
  resolvePattern,
  buildCells,
  serializeRow,
  setSpan,
  setStart,
  removeCell,
  insertCell,
  newRow,
} from './item-value.mjs';
export { canEditRow, planRowEdit, rowEditTargetFile, planAddRow, planAddField, planRemoveField, planColumnWidth, planRemoveColumn, planInsertColumn, planViewHeight, planFieldRows, planRegionMetadata } from './edit.mjs';
export { FIELD_KINDS, buildField, isValidFieldName } from './field-template.mjs';
export { buildViewModel, renderViewHtml, renderControllerHtml, renderRowHtml, DIALOG_CHROME_PX } from './render.mjs';
