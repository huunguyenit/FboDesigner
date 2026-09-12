// index.mjs — bề mặt công khai của fbo-core.
//
// Luật kiến trúc (ADR-0002): file nào trong core cũng KHÔNG được import `vscode`, KHÔNG chạm
// DOM, và KHÔNG ghi filesystem. Mọi phép sửa layout là hàm thuần trả về model mới cộng danh
// sách splice; ai ghi là việc của tầng extension. Mất luật này là mất khả năng test headless.

export { readSource, decodeSource, encodeWindows1258, stripAccents } from './encoding.mjs';
export {
  scanViews, scanFields, scanTitle, scanToolbar, scanCss, scanRoot, applySplices, scanConfigQueries,
} from './spans.mjs';
export { resolveProgramPaths } from './program.mjs';
export { expandEntities, findInternalSubset, resolveSystemPath, segmentAt, mapToSource, sourceRange, hostRefAt, refResolvedSpan, shiftSegments, scanEntityRefs } from './entities.mjs';
export { scanOptionVars, formatSampleValue, formatNumber, isNumericField, isDateField, formatDate, parseDisplayDate, resolveMask } from './format.mjs';
export { renderControl, renderGridControl, containerClass, isDisabled, isTextArea, resolveLocaleName, alignOf } from './control.mjs';
export { buildGridModel, renderGridHtml, renderGrid, applyArrangement, mergeGridConfig } from './grid.mjs';
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
export { canEditRow, planRowEdit, planMoveControl, planMoveRowBlock, planSwapControl, planSwapBlock, moveControlFiles, rowEditTargetFile, planAddRow, planAddField, blankAnchorName, blankAnchorField, blankAnchorToken, blankAnchorIn, planRemoveField, planRemoveControl, planInlineEntity, planColumnWidth, planRemoveColumn, planInsertColumn, planMoveColumn, planViewHeight, planFieldRows, planRegionMetadata, planRegionColumns, regionColumnFiles, planRegionColumnWidth } from './edit.mjs';
export {
  FIELD_KINDS,
  FIELD_TYPES,
  FIELD_STYLES,
  buildField,
  buildAddControlDialog,
  valuesToFieldSpec,
  isValidFieldName,
} from './field-template.mjs';
export { msg, t, MESSAGES, FIELDS_CONFIG, VIEWS_CONFIG, SQL_CONFIG, SAMPLE_PARAMS } from './msg.mjs';
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
export { splitPatternAt, mergePatternAt, splitWidthsAt, mergeWidthsAt, resizeWidthAt } from './columns.mjs';
export { buildOutline } from './outline.mjs';
export { buildEntityInsight } from './insight.mjs';
export { definitionTargetAt, fieldDeclarationSpan, completionContextAt } from './definition.mjs';
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
export { buildViewModel, renderViewHtml, renderControllerHtml, renderRowHtml, DIALOG_CHROME_PX, scanGridConfig, configQueryRewrites } from './render.mjs';
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
  buildSampleSelect,
  buildSampleProbe,
  maskSampleValue,
  maskSampleRows,
  sampleKindOf,
  scanScriptParams,
  scriptParamFields,
  scriptParamLiteral,
  readControllerQuery,
  substituteParams,
  partitionPeriod,
  SAMPLE_TOP_DEFAULT,
  SAMPLE_TOP_MAX,
  SAMPLE_SENTINEL,
} from './grid-sample.mjs';
export {
  assertIdent,
  ENTITY_APP_DATABASE_SQL,
  parseConnectionString,
  resolvePlaceholders,
  existingColumnsSql,
  stringColumnLengthSql,
} from './sql-config.mjs';
export {
  scanMailActions, renderMailPreview, isMailTemplateDoc, locateMailSection,
  analyzeMailColumns, planResizeMailColumn, listMailRows, planAddMailRow, planAddMailColumn,
  locateMailText, mailActionLabels, substituteFieldTokens, mailLocationAt, mailLocationAtSource,
  readMailReportCommands,
} from './mail-template.mjs';
export {
  buildMailSampleStub, buildMailTableProbe, buildMailSampleSelect, mailSampleFromRows,
  isMailFormatTable, mailFormatMap, applyMailFieldFormats, buildMailInWordsSelect,
} from './mail-sample.mjs';
// Email Designer — hợp đồng (`docs/EMAIL-DESIGNER.md`), dòng HTML + chỉ mục, kế hoạch sửa.
export {
  DESIGN_ATTR, ELEMENT_ID_RE, formatElementId, parseElementId, elementFingerprint, MAIL_PARTS, ELEMENT_ROLES,
  roleOfTag, MAIL_OPS, STYLE_PROPERTIES, isStyleProperty, ATTRIBUTES, isAttributeAllowed, COMPONENT_KINDS,
  INSERT_POSITIONS, MOVE_DIRECTIONS, MAX_TEXT_LENGTH, isSafeCssValue, isSafeAttrValue, isSafeUrl, validateMailMessage,
  ATTRIBUTE_ENUMS, isValidAttrValue, PREVIEW_MODES, MAX_SAMPLE_LENGTH,
} from './mail-design-contract.mjs';
export {
  scanMailTokens, mailVariables, mailTokenKind, parseMailSample, formatSampleScalar, sampleValueOf, sampleSkeleton,
  tokenPatches,
} from './mail-variables.mjs';
export {
  COMPONENT_PANELS, componentKindOf, componentHtml, INSERTABLE_COMPONENTS,
} from './mail-components.mjs';
export {
  planMailRemove, planMailMove, planMailInsert, planMailWrapLink, mailTableContext,
} from './mail-structure.mjs';
export {
  buildMailView, indexMailElements, renderMailDesign, wireMailElements, mapMailEdits, mailElementClearRange,
  parseStyleDeclarations, mailElementAtSource, renderMailFullPreview, mailTokenClearRange,
} from './mail-html.mjs';
export { lintMailHtml, GMAIL_CLIP_BYTES } from './mail-lint.mjs';
export {
  resolveMailElement, planMailText, planMailStyle, planMailAttr,
} from './mail-edit.mjs';
