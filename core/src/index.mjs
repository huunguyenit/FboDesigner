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
  isBlankAnchorName,
} from './item-value.mjs';
export { canEditRow, planRowEdit, planMoveControl, planMoveRowBlock, planSwapControl, planSwapBlock, moveControlFiles, rowEditTargetFile, planAddRow, planAddField, blankAnchorName, blankAnchorField, blankAnchorToken, blankAnchorIn, planRemoveField, planRemoveControl, planInlineEntity, planColumnWidth, planRemoveColumn, planInsertColumn, planMoveColumn, planViewHeight, planFieldRows, planRegionMetadata, planRegionColumns, regionColumnFiles } from './edit.mjs';
export {
  FIELD_KINDS,
  FIELD_TYPES,
  FIELD_STYLES,
  buildField,
  buildAddControlDialog,
  valuesToFieldSpec,
  isValidFieldName,
} from './field-template.mjs';
export { msg, t, MESSAGES, FIELDS_CONFIG, VIEWS_CONFIG, SQL_CONFIG } from './msg.mjs';
/*
 * Hình dạng cảnh báo chẩn đoán. Tầng vỏ nhận `{code, message, severity, item, range}`, trong đó
 * `range` là `{file, start, end}` trong FILE NGUỒN — có thể là một file Include, không nhất
 * thiết là file đang mở — hoặc `null` khi cảnh báo không gắn vào khúc chữ nào.
 *
 * `warnLocal`/`warnAbsoluteSpan` là chuyện nội bộ của core (toạ độ tương đối trong một chuỗi
 * `value`); vỏ không cần tới, nhưng test thì có, nên vẫn xuất ra.
 */
export { local as warnLocal, anchored as warnAnchored, attach as warnAttach, absoluteSpan as warnAbsoluteSpan } from './warn.mjs';
export { deadFieldWarnings, aliasWarnings, gridHeightWarnings, gridBlockPx } from './lint.mjs';
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
export { buildSampleSelect, maskSampleValue, maskSampleRows, SAMPLE_TOP_DEFAULT, SAMPLE_TOP_MAX } from './grid-sample.mjs';
export {
  assertIdent,
  ENTITY_APP_DATABASE_SQL,
  parseConnectionString,
  resolvePlaceholders,
  existingColumnsSql,
  stringColumnLengthSql,
} from './sql-config.mjs';
