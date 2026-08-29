// index.mjs — bề mặt công khai của fbo-core.
//
// Luật kiến trúc (ADR-0002): file nào trong core cũng KHÔNG được import `vscode`, KHÔNG chạm
// DOM, và KHÔNG ghi filesystem. Mọi phép sửa layout là hàm thuần trả về model mới cộng danh
// sách splice; ai ghi là việc của tầng extension. Mất luật này là mất khả năng test headless.

export { readSource, decodeSource, encodeWindows1258, stripAccents } from './encoding.mjs';
export { scanViews, scanFields, scanTitle, scanToolbar, scanCss, scanRoot, applySplices } from './spans.mjs';
export { resolveProgramPaths } from './program.mjs';
export { expandEntities, findInternalSubset, resolveSystemPath, segmentAt, mapToSource, sourceRange, hostRefAt, refResolvedSpan, shiftSegments } from './entities.mjs';
export { renderControl, renderGridControl, containerClass, isDisabled, isTextArea, resolveLocaleName, alignOf } from './control.mjs';
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
  moveCell,
  swapCells,
  placeCell,
  newRow,
  takeRowHalf,
  joinRowHalves,
  newSplitBlankRow,
} from './item-value.mjs';
export { canEditRow, planRowEdit, planMoveControl, planMoveRowBlock, planSwapControl, moveControlFiles, rowEditTargetFile, planAddRow, planAddField, planRemoveField, planRemoveControl, planInlineEntity, planColumnWidth, planRemoveColumn, planInsertColumn, planViewHeight, planFieldRows, planRegionMetadata, planRegionColumns, regionColumnFiles } from './edit.mjs';
export { FIELD_KINDS, buildField, isValidFieldName } from './field-template.mjs';
export { splitPatternAt, mergePatternAt, splitWidthsAt, mergeWidthsAt } from './columns.mjs';
export { scopeCss, FORM_SCOPE } from './css-scope.mjs';
export { commentRanges, inComment, commentSkipper } from './xml-comment.mjs';
export {
  scanPartition,
  scanFindingJoin,
  scanControllerName,
  scanSysDatabaseName,
  scanConnectionString,
  buildFilterDeclarations,
  renderFilterDeclareSql,
  planEnableFilter,
} from './filter-declare.mjs';
export { buildViewModel, renderViewHtml, renderControllerHtml, renderRowHtml, DIALOG_CHROME_PX } from './render.mjs';
export {
  mainTableExclusionReason,
  sqlTypeOf,
  isRotatingPartition,
  planAddColumns,
  buildColumnDefs,
  renderAddColumnSql,
  DEFAULT_PARTITION_TEMPLATE,
} from './add-column.mjs';
export {
  ENTITY_APP_DATABASE_SQL,
  parseConnectionString,
  resolvePlaceholders,
  existingColumnsSql,
  stringColumnLengthSql,
} from './sql-config.mjs';
