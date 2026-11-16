/**
 * Главный модуль клиентского приложения «Васту-карта · Анна Ромео».
 * Четыре последовательных шага:
 *   1. План -> 2. Север (только по спутнику) -> 3. Контур стен -> 4. Карта.
 * Работает локально в браузере на телефоне и компьютере без внешних запросов.
 */

import {
  normalizeDeg,
  signedAngleDeltaDeg,
  northAngleFromWallSegments,
  houseTiltFromSatelliteWall,
  distance,
  buildVastuMap,
  CENTER_OUTSIDE_NOTE,
  BRAHMASTAN_CLIPPED_BADGE,
} from './geometry.js';
import { SECTORS } from './vastu-data.js';
import { createSampleFloorPlan } from './sample-plan.js';
import {
  loadPlanFromFile,
  loadSatelliteFromFile,
  rotatePlanCanvas,
} from './pdf-loader.js';
import { renderScene, exportMapToPngCanvas } from './renderer.js';
import {
  MIN_WALL_SEGMENT_SCREEN_PX,
  MIN_NEW_CORNER_DIST_PX,
  VERTEX_DRAG_START_PX,
  clonePointList,
  computeStepsState,
  normalizeRestoredDraft,
  applySheetRotation90CW,
  createUndoHistory,
  applyUndoEntry,
  computePlanViewRotationDeg,
  resolvePlanTabHitAction,
  isWallSegmentLongEnoughOnScreen,
  classifyContourTapProximity,
  applyOrthoSnapPoint,
  formatHouseTiltLine,
  detectExportPlatform,
  buildExportFilename,
  canExportVastuMap,
  createDefaultLayers,
} from './state-helpers.js';
import {
  downscalePlanToDataUrl,
  restorePlanCanvasFromDataUrl,
  saveWorkspaceSession,
  loadWorkspaceSession,
} from './storage.js';

const state = {
  isSamplePlan: false,
  sampleModified: false,
  basePlanCanvas: null,
  sheetQuarterTurns: 0,

  planCanvas: null,
  planWidth: 0,
  planHeight: 0,
  planTitle: '',

  vertices: [],
  undoHistory: createUndoHistory(40),
  selectedVertexIndex: -1,
  hoveredVertexIndex: -1,
  hoveredEdgeMidpoint: null,
  orthoSnap: true,
  contourTransientHint: '',

  northSet: false,
  northSource: null, // 'satellite' | null
  northAngleDeg: null,
  legacyManualNorthNotice: false,
  alignNorthUp: true,
  frozenRotationDeg: null,
  activeTab: 'plan',
  mapExported: false,

  layers: createDefaultLayers(),

  sat: {
    canvas: null,
    width: 0,
    height: 0,
    title: '',
    satPts: [],
    planPts: [],
    houseTiltDeg: null,
  },
  satViewMode: 'idle', // 'idle' | 'sat' | 'plan-pick' | 'done'
  satShortWallWarning: '',
  satZoom: 1,
  satPanX: 0,
  satPanY: 0,

  vastuMap: null,

  zoom: 1,
  panX: 0,
  panY: 0,
  lastRenderMeta: null,
};

// DOM-элементы
const studioShell = document.getElementById('studioShell');
const canvasStage = document.getElementById('canvasStage');
const mapCanvas = document.getElementById('mapCanvas');
const ctx = mapCanvas.getContext('2d');
const inspectorScroll = document.getElementById('inspectorScroll');

const canvasHudTop = document.getElementById('canvasHudTop');
const statusBanner = document.getElementById('canvasStatusBanner');
const toggleCanvasSizeBtn = document.getElementById('toggleCanvasSizeBtn');
const canvasZoomControls = document.getElementById('canvasZoomControls');
const zoomInBtn = document.getElementById('zoomInBtn');
const zoomOutBtn = document.getElementById('zoomOutBtn');
const zoomFitBtn = document.getElementById('zoomFitBtn');

const saveToast = document.getElementById('saveToast');
const saveToastText = document.getElementById('saveToastText');
const openSavedPreviewBtn = document.getElementById('openSavedPreviewBtn');

const mobilePickingBar = document.getElementById('mobilePickingBar');
const pickingBarHint = document.getElementById('pickingBarHint');
const pickingUndoBtn = document.getElementById('pickingUndoBtn');
const pickingDoneBtn = document.getElementById('pickingDoneBtn');

const planFileInput = document.getElementById('planFileInput');
const planEmptyState = document.getElementById('planEmptyState');
const planLoadedState = document.getElementById('planLoadedState');
const planNextStepBtn = document.getElementById('planNextStepBtn');
const rotatePlan90Btn = document.getElementById('rotatePlan90Btn');
const rotateSheetHint = document.getElementById('rotateSheetHint');
const currentPlanTitle = document.getElementById('currentPlanTitle');
const planErrorBox = document.getElementById('planErrorBox');

const satFileInput = document.getElementById('satFileInput');
const legacyNorthNoticeBox = document.getElementById('legacyNorthNoticeBox');
const northSubUpload = document.getElementById('northSubUpload');
const northSubPicking = document.getElementById('northSubPicking');
const northSubVerify = document.getElementById('northSubVerify');
const satStageSatPill = document.getElementById('satStageSatPill');
const satStagePlanPill = document.getElementById('satStagePlanPill');
const satStageVerifyPill = document.getElementById('satStageVerifyPill');
const northPickingHeading = document.getElementById('northPickingHeading');
const satStepHintText = document.getElementById('satStepHintText');
const satDesktopUndoBtn = document.getElementById('satDesktopUndoBtn');
const satDesktopDoneBtn = document.getElementById('satDesktopDoneBtn');
const northReadoutBadge = document.getElementById('northReadoutBadge');
const satHouseTiltLine = document.getElementById('satHouseTiltLine');
const satVerifyBox = document.getElementById('satVerifyBox');
const northNextContourBtn = document.getElementById('northNextContourBtn');
const satResetPointsBtn = document.getElementById('satResetPointsBtn');

const vertexCountBadge = document.getElementById('vertexCountBadge');
const undoContourBtn = document.getElementById('undoContourBtn');
const contourDoneBtn = document.getElementById('contourDoneBtn');
const deleteVertexBtn = document.getElementById('deleteVertexBtn');
const clearContourBtn = document.getElementById('clearContourBtn');
const orthoSnapToggle = document.getElementById('orthoSnapToggle');
const contourWarningBox = document.getElementById('contourWarningBox');

const layersBlockedBox = document.getElementById('layersBlockedBox');
const layersBlockedText = document.getElementById('layersBlockedText');
const gotoNorthStepBtn = document.getElementById('gotoNorthStepBtn');
const gotoContourStepBtn = document.getElementById('gotoContourStepBtn');
const layersReadyContent = document.getElementById('layersReadyContent');

const toggleSectors = document.getElementById('toggleSectors');
const toggleSectorLabels = document.getElementById('toggleSectorLabels');
const toggleBrahmastan = document.getElementById('toggleBrahmastan');
const togglePadas = document.getElementById('togglePadas');
const padaZoomHint = document.getElementById('padaZoomHint');
const padaSuboptions = document.getElementById('padaSuboptions');
const togglePadaBelts = document.getElementById('togglePadaBelts');
const togglePadaScores = document.getElementById('togglePadaScores');
const orientNorthUpBtn = document.getElementById('orientNorthUpBtn');
const orientAsOnSheetBtn = document.getElementById('orientAsOnSheetBtn');
const sectorOpacitySlider = document.getElementById('sectorOpacitySlider');
const sectorOpacityValue = document.getElementById('sectorOpacityValue');

const centerSummaryText = document.getElementById('centerSummaryText');
const zonesBalanceList = document.getElementById('zonesBalanceList');

const topExportBtn = document.getElementById('topExportBtn');
const exportPngBtn = document.getElementById('exportPngBtn');
const shareMapBtn = document.getElementById('shareMapBtn');
const exportCtaWrap = exportPngBtn ? exportPngBtn.parentElement : null;

const confirmModal = document.getElementById('confirmModal');
const confirmModalTitle = document.getElementById('confirmModalTitle');
const confirmModalMessage = document.getElementById('confirmModalMessage');
const confirmModalCancelBtn = document.getElementById('confirmModalCancelBtn');
const confirmModalAcceptBtn = document.getElementById('confirmModalAcceptBtn');

const imagePreviewModal = document.getElementById('imagePreviewModal');
const previewModalImg = document.getElementById('previewModalImg');
const closePreviewModalBtn = document.getElementById('closePreviewModalBtn');

const tabButtons = {
  plan: document.getElementById('tabBtnPlan'),
  north: document.getElementById('tabBtnNorth'),
  contour: document.getElementById('tabBtnContour'),
  layers: document.getElementById('tabBtnLayers'),
};
const tabPanes = {
  plan: document.getElementById('panelPlan'),
  north: document.getElementById('panelNorth'),
  contour: document.getElementById('panelContour'),
  layers: document.getElementById('panelLayers'),
};

let lastExportDataUrl = null;
let saveToastTimer = null;
let persistTimer = null;
let cachedBasePlanDataUrl = null;

// ============================================================================
// Собственное диалоговое окно подтверждения
// ============================================================================
let pendingConfirmResolve = null;

function askUserConfirmation({
  title = 'Подтвердите действие',
  message = '',
  confirmText = 'Продолжить',
  cancelText = 'Отмена',
}) {
  if (pendingConfirmResolve) {
    pendingConfirmResolve(false);
    pendingConfirmResolve = null;
  }

  confirmModalTitle.textContent = title;
  confirmModalMessage.textContent = message;
  confirmModalAcceptBtn.textContent = confirmText;
  confirmModalCancelBtn.textContent = cancelText;
  confirmModal.hidden = false;

  return new Promise((resolve) => {
    pendingConfirmResolve = resolve;
  });
}

function closeConfirmModal(accepted) {
  confirmModal.hidden = true;
  if (pendingConfirmResolve) {
    const fn = pendingConfirmResolve;
    pendingConfirmResolve = null;
    fn(Boolean(accepted));
  }
}

confirmModalAcceptBtn.addEventListener('click', () => closeConfirmModal(true));
confirmModalCancelBtn.addEventListener('click', () => closeConfirmModal(false));
confirmModal.addEventListener('click', (e) => {
  if (e.target === confirmModal) closeConfirmModal(false);
});

closePreviewModalBtn.addEventListener('click', () => {
  imagePreviewModal.hidden = true;
});
imagePreviewModal.addEventListener('click', (e) => {
  if (e.target === imagePreviewModal) imagePreviewModal.hidden = true;
});

// ============================================================================
// Автосохранение сессии в IndexedDB / localStorage
// ============================================================================
function buildSessionRecord() {
  if (!state.planCanvas) return null;

  if (!state.isSamplePlan && !cachedBasePlanDataUrl && state.basePlanCanvas) {
    cachedBasePlanDataUrl = downscalePlanToDataUrl(state.basePlanCanvas, 1400);
  }

  const isSatelliteNorth = Boolean(
    state.northSet &&
      state.northSource === 'satellite' &&
      Number.isFinite(state.northAngleDeg)
  );

  return {
    version: 2,
    savedAt: Date.now(),
    isSamplePlan: state.isSamplePlan,
    sampleModified: state.sampleModified,
    planTitle: state.planTitle,
    sheetQuarterTurns: state.sheetQuarterTurns,
    basePlanWidth: state.basePlanCanvas ? state.basePlanCanvas.width : state.planWidth,
    basePlanHeight: state.basePlanCanvas ? state.basePlanCanvas.height : state.planHeight,
    basePlanDataUrl: state.isSamplePlan ? null : cachedBasePlanDataUrl,
    vertices: clonePointList(state.vertices),
    satPlanPts: isSatelliteNorth ? clonePointList(state.sat.planPts) : [],
    satHouseTiltDeg: isSatelliteNorth ? state.sat.houseTiltDeg : null,
    northSet: isSatelliteNorth,
    northSource: isSatelliteNorth ? 'satellite' : null,
    northAngleDeg: isSatelliteNorth ? normalizeDeg(state.northAngleDeg) : null,
    alignNorthUp: state.alignNorthUp,
    orthoSnap: state.orthoSnap,
    activeTab: state.activeTab,
    layers: { ...state.layers },
  };
}

function schedulePersist(immediate = false) {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  if (!state.planCanvas) return;

  if (immediate) {
    const rec = buildSessionRecord();
    if (rec) saveWorkspaceSession(rec).catch(() => {});
    return;
  }
  persistTimer = setTimeout(() => {
    persistTimer = null;
    const rec = buildSessionRecord();
    if (rec) saveWorkspaceSession(rec).catch(() => {});
  }, 220);
}

// ============================================================================
// Раздельная история «Отменить»:
// - правки контура сохраняют/возвращают ТОЛЬКО углы контура (Север и точки стены не трогаются!);
// - поворот листа на 90° сохраняет/возвращает лист, контур и Север вместе.
// ============================================================================
function pushContourUndoSnapshot() {
  state.undoHistory.pushContour(state.vertices);
  if (state.isSamplePlan) {
    state.sampleModified = true;
  }
}

function pushSheetRotateUndoSnapshot() {
  state.undoHistory.pushSheetRotate({
    sheetQuarterTurns: state.sheetQuarterTurns,
    planWidth: state.planWidth,
    planHeight: state.planHeight,
    vertices: state.vertices,
    satPlanPts: state.sat.planPts,
    northSet: state.northSet,
    northSource: state.northSource,
    northAngleDeg: state.northAngleDeg,
  });
  if (state.isSamplePlan) {
    state.sampleModified = true;
  }
}

function performUndo() {
  const entry = state.undoHistory.pop();
  if (!entry) return;

  const next = applyUndoEntry(
    {
      sheetQuarterTurns: state.sheetQuarterTurns,
      planWidth: state.planWidth,
      planHeight: state.planHeight,
      vertices: state.vertices,
      satPlanPts: state.sat.planPts,
      satSatPts: state.sat.satPts,
      northSet: state.northSet,
      northSource: state.northSource,
      northAngleDeg: state.northAngleDeg,
    },
    entry
  );
  if (!next) return;

  state.contourTransientHint = '';

  if (next.kind === 'contour') {
    state.vertices = next.vertices;
    state.selectedVertexIndex = Math.min(
      state.selectedVertexIndex,
      state.vertices.length - 1
    );
    recomputeVastuMap();
    schedulePersist();
    return;
  }

  // Отмена поворота листа на 90°: возвращает лист, контур, точки на плане и Север вместе
  const turnsChanged = next.turnsChanged;
  state.sheetQuarterTurns = next.sheetQuarterTurns;
  if (turnsChanged && state.basePlanCanvas) {
    state.planCanvas =
      next.sheetQuarterTurns === 0
        ? state.basePlanCanvas
        : rotatePlanCanvas(state.basePlanCanvas, next.sheetQuarterTurns);
    state.planWidth = state.planCanvas.width;
    state.planHeight = state.planCanvas.height;
  } else {
    state.planWidth = next.planWidth;
    state.planHeight = next.planHeight;
  }

  state.vertices = next.vertices;
  state.sat.planPts = next.satPlanPts;
  state.northSet = next.northSet;
  state.northSource = next.northSource;
  state.northAngleDeg = next.northAngleDeg;

  state.selectedVertexIndex = Math.min(
    state.selectedVertexIndex,
    state.vertices.length - 1
  );

  recomputeVastuMap();
  if (turnsChanged) {
    fitPlanToViewport();
  }
  schedulePersist();
}

function handleContourUndoOrPop() {
  if (state.undoHistory.length > 0) {
    performUndo();
    return;
  }
  if (state.vertices.length > 0) {
    state.contourTransientHint = '';
    pushContourUndoSnapshot();
    state.vertices.pop();
    state.selectedVertexIndex = Math.min(
      state.selectedVertexIndex,
      state.vertices.length - 1
    );
    recomputeVastuMap();
    schedulePersist();
  }
}

function pluralizeCorners(count) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} угол`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} угла`;
  return `${count} углов`;
}

function isViewingSatelliteCanvas() {
  return (
    state.activeTab === 'north' &&
    state.satViewMode === 'sat' &&
    Boolean(state.sat && state.sat.canvas)
  );
}

/**
 * Вычисляет живой экранный поворот холста плана (без учёта заморозки).
 */
function computeLivePlanScreenRotationDeg() {
  if (isViewingSatelliteCanvas()) return 0;
  return computePlanViewRotationDeg({
    isExport: false,
    activeTab: state.activeTab,
    satViewMode: state.satViewMode,
    northSet: state.northSet,
    northAngleDeg: state.northAngleDeg,
    alignNorthUp: state.alignNorthUp,
    frozenRotationDeg: null,
  });
}

/**
 * Замораживает поворот экрана на всё время любого жеста перетаскивания на плане,
 * чтобы план не вращался под пальцем.
 */
function freezeScreenRotationForGesture() {
  if (isViewingSatelliteCanvas()) return;
  if (!Number.isFinite(state.frozenRotationDeg)) {
    state.frozenRotationDeg = computeLivePlanScreenRotationDeg();
  }
}

function unfreezeScreenRotationIfIdle({ fitIfRotationChanged = false } = {}) {
  if (activePointers.size > 0) return;
  if (!Number.isFinite(state.frozenRotationDeg)) return;
  const prevRot = state.frozenRotationDeg;
  state.frozenRotationDeg = null;
  const liveRot = computeLivePlanScreenRotationDeg();
  if (fitIfRotationChanged && Math.abs(signedAngleDeltaDeg(prevRot, liveRot)) > 0.05) {
    fitPlanToViewport();
  } else {
    requestRender();
  }
}

function recomputeVastuMap() {
  if (state.planCanvas && state.vertices.length >= 3) {
    const northArg =
      state.northSet &&
      state.northSource === 'satellite' &&
      Number.isFinite(state.northAngleDeg)
        ? state.northAngleDeg
        : null;
    state.vastuMap = buildVastuMap(state.vertices, northArg);
  } else {
    state.vastuMap = null;
  }
  syncInspectorUI();
  requestRender();
}

// ============================================================================
// Масштабирование и вписывание чертежа / снимка спутника
// ============================================================================
function fitPlanToViewport() {
  if (!state.planCanvas) {
    requestRender();
    return;
  }
  const rect = canvasStage.getBoundingClientRect();
  const vw = Math.max(100, rect.width);
  const vh = Math.max(100, rect.height);

  const effectiveRotDeg = Number.isFinite(state.frozenRotationDeg)
    ? state.frozenRotationDeg
    : computeLivePlanScreenRotationDeg();

  const rotRad = (effectiveRotDeg * Math.PI) / 180;
  const absCos = Math.abs(Math.cos(rotRad));
  const absSin = Math.abs(Math.sin(rotRad));
  const effW = state.planWidth * absCos + state.planHeight * absSin;
  const effH = state.planWidth * absSin + state.planHeight * absCos;

  const isCompactPicking =
    vw < 560 && studioShell.classList.contains('is-point-picking');

  const sidePad = isCompactPicking ? 10 : vw < 520 ? 22 : 52;
  const topHudSpace = isCompactPicking ? 42 : vw < 520 ? 58 : 62;
  const bottomHudSpace = isCompactPicking ? 52 : vw < 520 ? 58 : 58;
  const availW = Math.max(60, vw - sidePad * 2);
  const availH = Math.max(60, vh - topHudSpace - bottomHudSpace);

  state.zoom = Math.min(
    Math.max(0.06, availW / Math.max(1, effW)),
    Math.max(0.06, availH / Math.max(1, effH))
  );
  state.panX = 0;
  state.panY = (topHudSpace - bottomHudSpace) * 0.5;
  requestRender();
}

/**
 * Показывает скриншот со спутника сразу крупно (по ширине экрана / с увеличением 3–4× от мелкого вписывания),
 * чтобы стена дома была крупной и точной под пальцем.
 */
function fitSatelliteToViewport({ mode = 'large' } = {}) {
  if (!state.sat.canvas) return;
  const rect = canvasStage.getBoundingClientRect();
  const vw = Math.max(100, rect.width);
  const vh = Math.max(100, rect.height);

  const sidePad = vw < 520 ? 12 : 36;
  const topSpace = vw < 520 ? 52 : 54;
  const bottomSpace = 50;
  const availW = Math.max(60, vw - sidePad * 2);
  const availH = Math.max(60, vh - topSpace - bottomSpace);

  const containZoom = Math.min(
    Math.max(0.06, availW / Math.max(1, state.sat.width)),
    Math.max(0.06, availH / Math.max(1, state.sat.height))
  );
  const fillWidthZoom = Math.max(0.08, (vw - 8) / Math.max(1, state.sat.width));
  const coverZoom = Math.max(
    fillWidthZoom,
    Math.max(0.08, (vh - 10) / Math.max(1, state.sat.height))
  );

  if (mode === 'fit') {
    state.satZoom = Math.min(4, Math.max(containZoom, fillWidthZoom * 0.96));
    state.satPanX = 0;
    state.satPanY = 0;
    requestRender();
    return;
  }

  const isPortraitScreenshot = state.sat.height > state.sat.width * 1.15;
  state.satZoom = Math.min(
    4,
    isPortraitScreenshot
      ? Math.max(containZoom, fillWidthZoom)
      : coverZoom * (vw < 560 ? 1.12 : 1.04)
  );
  state.satPanX = 0;
  state.satPanY = 0;
  requestRender();
}

function zoomByFactor(factor, pivotScreen = null) {
  const rect = canvasStage.getBoundingClientRect();
  const cx = pivotScreen ? pivotScreen.x : rect.width * 0.5;
  const cy = pivotScreen ? pivotScreen.y : rect.height * 0.5;

  if (isViewingSatelliteCanvas()) {
    const prev = state.satZoom;
    const next = Math.max(0.1, Math.min(10, prev * factor));
    const ratio = next / prev;
    const dx = cx - rect.width * 0.5 - state.satPanX;
    const dy = cy - rect.height * 0.5 - state.satPanY;
    state.satPanX -= dx * (ratio - 1);
    state.satPanY -= dy * (ratio - 1);
    state.satZoom = next;
    requestRender();
    return;
  }

  if (!state.planCanvas) return;
  const prevZoom = state.zoom;
  const nextZoom = Math.max(0.1, Math.min(10, prevZoom * factor));
  const ratio = nextZoom / prevZoom;

  const dx = cx - rect.width * 0.5 - state.panX;
  const dy = cy - rect.height * 0.5 - state.panY;
  state.panX -= dx * (ratio - 1);
  state.panY -= dy * (ratio - 1);
  state.zoom = nextZoom;
  requestRender();
}

let rafPending = false;
function requestRender() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    drawNow();
  });
}

function syncPadaZoomHintUI() {
  if (!padaZoomHint) return;
  const hasReadyMap = Boolean(
    state.northSet &&
      state.northSource === 'satellite' &&
      state.vertices.length >= 3 &&
      state.vastuMap &&
      !state.vastuMap.selfIntersects
  );
  const hiddenCount =
    state.lastRenderMeta && !state.lastRenderMeta.isSatelliteView
      ? state.lastRenderMeta.hiddenPadasCount || 0
      : 0;

  const shouldShow = Boolean(hasReadyMap && state.layers.showPadas && hiddenCount > 0);
  padaZoomHint.hidden = !shouldShow;
}

function drawNow() {
  const rect = canvasStage.getBoundingClientRect();
  const viewWidth = Math.max(1, Math.round(rect.width));
  const viewHeight = Math.max(1, Math.round(rect.height));
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);

  const targetW = Math.round(viewWidth * dpr);
  const targetH = Math.round(viewHeight * dpr);
  if (mapCanvas.width !== targetW || mapCanvas.height !== targetH) {
    mapCanvas.width = targetW;
    mapCanvas.height = targetH;
  }

  const prevHiddenPadas = state.lastRenderMeta?.hiddenPadasCount ?? -1;
  state.lastRenderMeta = renderScene(ctx, state, {
    viewWidth,
    viewHeight,
    dpr,
    isExport: false,
  });

  syncPadaZoomHintUI();
  if (
    state.activeTab === 'layers' &&
    state.layers.showPadas &&
    (state.lastRenderMeta?.hiddenPadasCount ?? 0) !== prevHiddenPadas
  ) {
    syncStatusBanner();
  }
}

// ============================================================================
// Переключение шагов (вкладок) и расчёт Севера строго по спутнику
// ============================================================================
function setActiveTab(tabName) {
  if (!tabPanes[tabName]) return;
  if (!state.planCanvas && tabName !== 'plan') {
    state.activeTab = 'plan';
    syncInspectorUI();
    requestRender();
    return;
  }

  const prevPicking = studioShell.classList.contains('is-point-picking');
  state.activeTab = tabName;
  state.contourTransientHint = '';

  if (tabName === 'north') {
    if (state.northSet && state.northSource === 'satellite') {
      if (state.satViewMode === 'idle') {
        state.satViewMode = 'done';
      }
    } else if (state.sat.canvas && state.satViewMode === 'idle') {
      state.satViewMode = state.sat.satPts.length === 2 ? 'plan-pick' : 'sat';
    }
  }

  // На шагах 1–3 сбрасываем ручное раскрытие холста «Крупнее» с шага 4
  if (tabName !== 'layers') {
    studioShell.classList.remove('canvas-expanded');
    if (toggleCanvasSizeBtn) toggleCanvasSizeBtn.textContent = 'Крупнее';
  }

  if (inspectorScroll) {
    inspectorScroll.scrollTop = 0;
  }

  syncInspectorUI();
  const nextPicking = studioShell.classList.contains('is-point-picking');

  if (isViewingSatelliteCanvas()) {
    fitSatelliteToViewport({ mode: 'large' });
  } else if (prevPicking !== nextPicking || state.planCanvas) {
    fitPlanToViewport();
  } else {
    requestRender();
  }
  schedulePersist();
}

function applySatelliteNorthAngle(deg, { keepFrozenRotation = false, fitAfter = false } = {}) {
  state.northSet = true;
  state.northSource = 'satellite';
  state.northAngleDeg = normalizeDeg(deg);
  state.legacyManualNorthNotice = false;
  if (state.isSamplePlan) {
    state.sampleModified = true;
  }

  if (!keepFrozenRotation) {
    state.frozenRotationDeg = null;
  }

  recomputeVastuMap();
  if (fitAfter) {
    fitPlanToViewport();
  }
  schedulePersist();
}

function tryComputeNorthFromSatellite() {
  if (state.sat.satPts.length < 2 || state.sat.planPts.length < 2) {
    return false;
  }
  const computed = northAngleFromWallSegments(
    state.sat.satPts[0],
    state.sat.satPts[1],
    state.sat.planPts[0],
    state.sat.planPts[1]
  );
  if (computed === null) {
    return false;
  }
  state.sat.houseTiltDeg = houseTiltFromSatelliteWall(
    state.sat.satPts[0],
    state.sat.satPts[1]
  );
  state.satShortWallWarning = '';
  state.satViewMode = 'done';
  applySatelliteNorthAngle(computed, { fitAfter: true });

  if (inspectorScroll) {
    inspectorScroll.scrollTop = 0;
  }
  return true;
}

function syncNorthStepUI(stepsInfo) {
  legacyNorthNoticeBox.hidden = !(
    state.legacyManualNorthNotice && !stepsInfo.hasNorth
  );

  const hasSat = Boolean(state.sat.canvas);
  const inPicking =
    hasSat && (state.satViewMode === 'sat' || state.satViewMode === 'plan-pick');
  const inVerify =
    stepsInfo.hasNorth &&
    (state.satViewMode === 'done' || (!inPicking && state.satViewMode === 'idle'));

  northSubUpload.hidden = inPicking || inVerify;
  northSubPicking.hidden = !inPicking;
  northSubVerify.hidden = !inVerify;

  if (inPicking) {
    const satCount = state.sat.satPts.length;
    const planCount = state.sat.planPts.length;

    satStageSatPill.classList.toggle('is-active', state.satViewMode === 'sat');
    satStageSatPill.classList.toggle('is-done', satCount === 2 && state.satViewMode !== 'sat');
    satStagePlanPill.classList.toggle('is-active', state.satViewMode === 'plan-pick');
    satStagePlanPill.classList.toggle('is-done', planCount === 2 && state.satViewMode === 'done');
    satStageVerifyPill.classList.remove('is-active');

    if (state.satViewMode === 'sat') {
      northPickingHeading.textContent = 'Отметьте точки 1 и 2 на снимке';
      satDesktopDoneBtn.disabled = satCount < 2;
      if (state.satShortWallWarning) {
        satStepHintText.textContent = state.satShortWallWarning;
        satStepHintText.classList.add('is-warning');
      } else {
        satStepHintText.classList.remove('is-warning');
        if (satCount === 0) {
          satStepHintText.textContent =
            'Разведите двумя пальцами, чтобы увеличить дом, и коснитесь первого угла наружной стены (точка «1»).';
        } else if (satCount === 1) {
          satStepHintText.textContent =
            'Точка «1» стоит — коснитесь второго угла этой же стены (точка «2»). Разведите двумя пальцами, чтобы увеличить дом.';
        } else {
          satStepHintText.textContent =
            'Точки «1» и «2» на снимке отмечены. При необходимости подправьте их перетаскиванием и нажмите «Готово».';
        }
      }
    } else {
      northPickingHeading.textContent = 'Отметьте те же точки 1 и 2 на плане';
      satDesktopDoneBtn.disabled = planCount < 2;
      if (state.satShortWallWarning) {
        satStepHintText.textContent = state.satShortWallWarning;
        satStepHintText.classList.add('is-warning');
      } else {
        satStepHintText.classList.remove('is-warning');
        if (planCount === 0) {
          satStepHintText.textContent =
            'Приблизьте план двумя пальцами или кнопкой «+» и коснитесь того же первого угла стены (точка «1»).';
        } else if (planCount === 1) {
          satStepHintText.textContent =
            'Точка «1» стоит — коснитесь второго угла этой же стены в том же порядке (точка «2»).';
        } else {
          satStepHintText.textContent =
            'Обе точки «1» и «2» на плане отмечены. Нажмите «Готово», чтобы рассчитать и проверить Север.';
        }
      }
    }
    return;
  }

  if (inVerify) {
    const roundedNorth = Math.round(state.northAngleDeg * 10) / 10;
    northReadoutBadge.textContent = `${String(roundedNorth).replace('.', ',')}°`;
    northReadoutBadge.classList.remove('is-unset');

    if (Number.isFinite(state.sat.houseTiltDeg)) {
      satHouseTiltLine.textContent = formatHouseTiltLine(state.sat.houseTiltDeg);
      satHouseTiltLine.hidden = false;
    } else {
      satHouseTiltLine.hidden = true;
    }

    satVerifyBox.hidden = false;
    northNextContourBtn.textContent = stepsInfo.hasValidContour
      ? 'Далее: 4. Карта →'
      : 'Далее: 3. Контур стен →';
  }
}

function syncMobilePickingBar(stepsInfo) {
  if (!stepsInfo.isPointPicking) {
    mobilePickingBar.hidden = true;
    return;
  }

  mobilePickingBar.hidden = false;

  if (state.activeTab === 'north' && state.satViewMode === 'sat') {
    const n = state.sat.satPts.length;
    pickingUndoBtn.disabled = false;
    pickingDoneBtn.disabled = n < 2;

    if (state.satShortWallWarning) {
      pickingBarHint.textContent = 'Стена короткая — увеличьте снимок';
      pickingBarHint.classList.add('is-warning');
    } else {
      pickingBarHint.classList.remove('is-warning');
      pickingBarHint.textContent =
        n === 0
          ? 'Снимок: коснитесь угла «1»'
          : n === 1
            ? 'Снимок: коснитесь угла «2»'
            : 'Точки 1 и 2 стоят · «Готово»';
    }
    return;
  }

  if (state.activeTab === 'north' && state.satViewMode === 'plan-pick') {
    const n = state.sat.planPts.length;
    pickingUndoBtn.disabled = false;
    pickingDoneBtn.disabled = n < 2;

    if (state.satShortWallWarning) {
      pickingBarHint.textContent = 'Стена короткая — приблизьте план';
      pickingBarHint.classList.add('is-warning');
    } else {
      pickingBarHint.classList.remove('is-warning');
      pickingBarHint.textContent =
        n === 0
          ? 'На плане: отметьте угол «1»'
          : n === 1
            ? 'На плане: отметьте угол «2»'
            : 'Точки 1 и 2 стоят · «Готово»';
    }
    return;
  }

  // Шаг 3: контур стен
  const count = state.vertices.length;
  pickingUndoBtn.disabled = state.undoHistory.length === 0 && count === 0;
  pickingDoneBtn.disabled = !stepsInfo.hasValidContour;

  if (state.vastuMap && state.vastuMap.selfIntersects) {
    pickingBarHint.textContent = 'Стены пересеклись · «Отменить»';
    pickingBarHint.classList.add('is-warning');
  } else if (state.contourTransientHint) {
    pickingBarHint.textContent = 'Приблизьте план для короткой стены';
    pickingBarHint.classList.add('is-warning');
  } else {
    pickingBarHint.classList.remove('is-warning');
    if (count === 0) {
      pickingBarHint.textContent = 'Коснитесь углов стен (от 3)';
    } else if (count < 3) {
      pickingBarHint.textContent = `${pluralizeCorners(count)} · ещё ${3 - count}`;
    } else {
      pickingBarHint.textContent = `${pluralizeCorners(count)} · нажмите «Готово»`;
    }
  }
}

function syncStatusBanner() {
  if (!state.planCanvas) {
    canvasHudTop.hidden = true;
    canvasZoomControls.hidden = true;
    return;
  }

  canvasHudTop.hidden = false;
  canvasZoomControls.hidden = false;
  const isPicking = studioShell.classList.contains('is-point-picking');
  if (toggleCanvasSizeBtn) {
    toggleCanvasSizeBtn.hidden = state.activeTab !== 'layers' || isPicking;
  }

  if (state.activeTab === 'plan') {
    statusBanner.textContent = 'План загружен · Перейдите к шагу «2. Север»';
    return;
  }

  if (state.activeTab === 'north') {
    if (state.satShortWallWarning) {
      statusBanner.textContent = state.satShortWallWarning;
      return;
    }
    if (state.satViewMode === 'sat' && state.sat.canvas) {
      const n = state.sat.satPts.length;
      statusBanner.textContent =
        n === 0
          ? 'Разведите двумя пальцами, чтобы увеличить дом, и отметьте угол «1»'
          : n === 1
            ? 'Снимок спутника: отметьте второй угол «2» подальше вдоль этой же стены'
            : 'Стена 1 → 2 на снимке отмечена — нажмите «Готово»';
      return;
    }
    if (state.satViewMode === 'plan-pick') {
      const n = state.sat.planPts.length;
      statusBanner.textContent =
        n === 0
          ? 'План квартиры: отметьте тот же угол «1» в том же порядке'
          : n === 1
            ? 'План квартиры: отметьте второй угол «2» этой же стены'
            : 'Точки «1» и «2» на плане отмечены — нажмите «Готово»';
      return;
    }
    if (state.northSet && state.northSource === 'satellite') {
      statusBanner.textContent =
        'Проверьте направление «С»: окна стены 1 → 2 смотрят туда же, что на снимке';
      return;
    }
    statusBanner.textContent = state.legacyManualNorthNotice
      ? 'Задайте Север по спутнику · Загрузите скриншот дома со спутника'
      : 'Шаг 2: загрузите скриншот дома со спутника (Север сверху)';
    return;
  }

  if (state.activeTab === 'contour') {
    if (state.contourTransientHint) {
      statusBanner.textContent = state.contourTransientHint;
      return;
    }
    if (state.vertices.length === 0) {
      statusBanner.textContent =
        'Коснитесь внутренних углов квартиры по порядку (от 3 точек)';
    } else if (state.vertices.length < 3) {
      statusBanner.textContent = `Отмечено: ${pluralizeCorners(state.vertices.length)} — добавьте ещё ${3 - state.vertices.length} для замыкания контура`;
    } else if (state.vastuMap && state.vastuMap.selfIntersects) {
      statusBanner.textContent =
        'Линии стен пересекаются: передвиньте угол или нажмите «Отменить»';
    } else {
      statusBanner.textContent = `Готово: ${pluralizeCorners(state.vertices.length)}. Неточный угол можно подвинуть пальцем`;
    }
    return;
  }

  // Шаг 4: «4. Карта»
  if (!state.northSet || state.northSource !== 'satellite') {
    statusBanner.textContent = 'Сначала задайте Север по спутнику на шаге «2. Север»';
    return;
  }
  if (!state.vastuMap || state.vastuMap.selfIntersects) {
    statusBanner.textContent =
      'Откройте шаг «3. Контур стен» и замкните внутренние углы квартиры';
    return;
  }
  if (state.vastuMap.centerOutsideOrClipped) {
    statusBanner.textContent = CENTER_OUTSIDE_NOTE;
    return;
  }

  if (
    state.layers.showPadas &&
    state.lastRenderMeta &&
    !state.lastRenderMeta.isSatelliteView &&
    (state.lastRenderMeta.hiddenPadasCount || 0) > 0
  ) {
    statusBanner.textContent = 'Приблизьте, чтобы увидеть все номера пад';
    return;
  }

  const orientWord = state.alignNorthUp ? 'Север сверху' : 'Как на листе плана';
  const isClippedByWall = Boolean(
    state.vastuMap.brahmastan && state.vastuMap.brahmastan.wasClipped
  );
  const active = [];
  if (state.layers.showSectors) active.push('8 секторов');
  if (state.layers.showBrahmastan) {
    active.push(
      isClippedByWall ? BRAHMASTAN_CLIPPED_BADGE : 'Брахмастан по форме квартиры'
    );
  }
  if (state.layers.showPadas) active.push('Сетка 32 пад');
  statusBanner.textContent =
    active.length > 0
      ? `${orientWord} · ${active.join(' · ')}`
      : 'Выберите слои ниже, чтобы отобразить их на плане';
}

function syncShareButtonVisibility(canExport) {
  if (!shareMapBtn) return;
  const ua = (navigator && navigator.userAgent) || '';
  const platInfo = detectExportPlatform({
    userAgent: ua,
    platform: navigator?.platform || '',
    maxTouchPoints: navigator?.maxTouchPoints || 0,
  });
  const hasShareApi = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const showShare = Boolean(
    platInfo.isAndroid || platInfo.isIOS || /Mobile/i.test(ua) || hasShareApi
  );

  shareMapBtn.hidden = !showShare;
  shareMapBtn.disabled = !canExport;
  if (exportCtaWrap) {
    exportCtaWrap.classList.toggle('single-action', !showShare);
  }
}

function syncInspectorUI() {
  const stepsInfo = computeStepsState(state);
  state.activeTab = stepsInfo.activeTab;

  studioShell.classList.toggle('is-empty-plan', !stepsInfo.hasPlan);
  studioShell.classList.toggle('is-point-picking', stepsInfo.isPointPicking);

  // Синхронизация 4 нумерованных вкладок шагов
  for (const step of stepsInfo.steps) {
    const btn = tabButtons[step.id];
    const pane = tabPanes[step.id];
    if (btn) {
      btn.disabled = step.disabled;
      btn.classList.toggle('is-active', step.active);
      btn.classList.toggle('is-completed', step.completed);
      btn.setAttribute('aria-selected', step.active ? 'true' : 'false');
      if (step.disabled) {
        btn.setAttribute('aria-disabled', 'true');
        btn.title = 'Сначала шаг 1: откройте план квартиры';
      } else {
        btn.removeAttribute('aria-disabled');
        btn.title = '';
      }

      const titleEl = btn.querySelector('.mode-tab-title');
      const subEl = btn.querySelector('.mode-tab-sub');
      if (titleEl) titleEl.textContent = step.displayTitle;
      if (subEl) {
        subEl.textContent = step.lockedCaption;
        subEl.hidden = !step.lockedCaption;
      }
    }
    if (pane) {
      pane.hidden = !step.active;
      pane.classList.toggle('is-active', step.active);
    }
  }

  // Шаг 1: до загрузки плана — одна крупная кнопка «Откройте план квартиры»
  planEmptyState.hidden = stepsInfo.hasPlan;
  planLoadedState.hidden = !stepsInfo.hasPlan;
  if (stepsInfo.hasPlan) {
    currentPlanTitle.textContent = state.planTitle || 'План квартиры';
    if (!stepsInfo.hasNorth) {
      planNextStepBtn.textContent = 'Далее: 2. Север по спутнику →';
    } else if (!stepsInfo.hasValidContour) {
      planNextStepBtn.textContent = 'Далее: 3. Контур стен →';
    } else {
      planNextStepBtn.textContent = 'Далее: 4. Карта →';
    }

    if (rotateSheetHint) {
      const showRotHint = Boolean(
        stepsInfo.hasNorth && state.alignNorthUp && state.satViewMode !== 'plan-pick'
      );
      rotateSheetHint.hidden = !showRotHint;
    }
  }

  // Шаг 2: Север по спутнику
  syncNorthStepUI(stepsInfo);

  // Шаг 3: Контур стен
  vertexCountBadge.textContent = pluralizeCorners(state.vertices.length);
  undoContourBtn.disabled = state.undoHistory.length === 0 && state.vertices.length === 0;
  contourDoneBtn.disabled = !stepsInfo.hasValidContour;
  deleteVertexBtn.disabled = state.vertices.length === 0;
  clearContourBtn.disabled = state.vertices.length === 0;
  orthoSnapToggle.checked = state.orthoSnap;

  if (state.vastuMap && state.vastuMap.selfIntersects) {
    contourWarningBox.hidden = false;
    contourWarningBox.textContent =
      'Линии стен пересекаются между собой. Передвиньте угол так, чтобы обход шёл последовательно по периметру, или нажмите «Отменить».';
  } else if (state.contourTransientHint) {
    contourWarningBox.hidden = false;
    contourWarningBox.textContent = state.contourTransientHint;
  } else {
    contourWarningBox.hidden = true;
  }

  // Однострочная панель на телефоне для режимов постановки точек
  syncMobilePickingBar(stepsInfo);

  // Шаг 4: слои и сохранение карты
  toggleSectors.checked = state.layers.showSectors;
  if (toggleSectorLabels) {
    toggleSectorLabels.checked = Boolean(state.layers.showSectorLabels);
  }
  toggleBrahmastan.checked = state.layers.showBrahmastan;
  togglePadas.checked = state.layers.showPadas;
  togglePadaBelts.checked = state.layers.showPadaBelts;
  togglePadaScores.checked = state.layers.showPadaScores;
  padaSuboptions.hidden = !state.layers.showPadas;
  syncPadaZoomHintUI();

  orientNorthUpBtn.classList.toggle('is-active', state.alignNorthUp);
  orientAsOnSheetBtn.classList.toggle('is-active', !state.alignNorthUp);

  const opacityPct = Math.round(state.layers.sectorOpacity * 100);
  sectorOpacitySlider.value = String(opacityPct);
  sectorOpacityValue.textContent = `${opacityPct}%`;

  const canExport = canExportVastuMap(state);
  topExportBtn.disabled = !canExport;
  // Кнопка в шапке не выставляется вперёд на шагах 1–3: показывается только на шаге 4, когда карта готова
  topExportBtn.hidden = !(canExport && state.activeTab === 'layers');
  exportPngBtn.disabled = !canExport;
  syncShareButtonVisibility(canExport);

  layersBlockedBox.hidden = stepsInfo.canShowMap;
  layersReadyContent.hidden = !stepsInfo.canShowMap;

  if (!stepsInfo.canShowMap) {
    // Всегда показываем ОДНУ кнопку следующего незавершённого шага по порядку (сначала шаг 2, затем шаг 3)
    if (!stepsInfo.hasNorth) {
      gotoNorthStepBtn.hidden = false;
      gotoContourStepBtn.hidden = true;
      layersBlockedText.textContent = stepsInfo.hasValidContour
        ? 'Контур квартиры готов. Осталось указать Север по скриншоту со спутника на шаге «2. Север».'
        : 'Сначала выполните шаг «2. Север»: загрузите скриншот дома со спутника и отметьте одну стену.';
    } else {
      gotoNorthStepBtn.hidden = true;
      gotoContourStepBtn.hidden = false;
      layersBlockedText.textContent =
        'Север по спутнику задан. Перейдите к шагу «3. Контур стен» и отметьте внутренние углы квартиры (от 3 точек).';
    }
  } else {
    if (state.vastuMap.centerOutsideOrClipped) {
      centerSummaryText.textContent = `${CENTER_OUTSIDE_NOTE}. В квартирах П-образной или сдвоенной формы расчётная точка центра попадает за пределы жилого контура.`;
    } else if (state.vastuMap.brahmastan && state.vastuMap.brahmastan.wasClipped) {
      centerSummaryText.textContent =
        'Центр квартиры (Брахмабинду) найден по настоящей форме контура. Брахмастан прижат к наружной стене (выступающая за стену часть обрезана по контуру квартиры).';
    } else {
      centerSummaryText.textContent =
        'Центр квартиры (Брахмабинду) рассчитан по настоящей форме контура и отмечен на плане.';
    }
    renderZonesList(state.vastuMap.sectors);
  }

  syncStatusBanner();
}

function renderZonesList(computedSectors) {
  const list = computedSectors && computedSectors.length > 0 ? computedSectors : SECTORS;
  zonesBalanceList.innerHTML = '';

  for (const s of list) {
    const card = document.createElement('div');
    card.className = 'zone-card';

    const swatch = document.createElement('div');
    swatch.className = 'zone-swatch';
    swatch.style.backgroundColor = s.fillColor;

    const meta = document.createElement('div');
    meta.className = 'zone-meta';

    const title = document.createElement('div');
    title.className = 'zone-title';
    title.textContent = `${s.code} · ${s.name} (${s.planet})`;

    const formula = document.createElement('div');
    formula.className = 'zone-formula';
    formula.textContent = s.formula;

    meta.appendChild(title);
    meta.appendChild(formula);

    card.appendChild(swatch);
    card.appendChild(meta);
    zonesBalanceList.appendChild(card);
  }
}

// ============================================================================
// Поиск элементов под пальцем / курсором на холсте
// ============================================================================
function getCanvasLocalPoint(clientX, clientY) {
  const rect = mapCanvas.getBoundingClientRect();
  return {
    x: clientX - rect.left,
    y: clientY - rect.top,
  };
}

/**
 * Поиск существующего угла контура для начала перетаскивания (радиус 26 px для пальца, 12 px для мыши).
 * Само одиночное касание без сдвига пальца НЕ перехватывается этим радиусом!
 */
function hitTestVertex(screenPt, isTouch = false) {
  if (!state.lastRenderMeta || state.vertices.length === 0) return -1;
  const xf = state.lastRenderMeta.transform;
  const hitR = isTouch ? 26 : 12;
  let bestIdx = -1;
  let bestDist = hitR;

  for (let i = 0; i < state.vertices.length; i++) {
    const p = xf.planToScreen(state.vertices[i]);
    const d = distance(screenPt, p);
    if (d <= bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function hitTestEdgeMidpoint(screenPt, isTouch = false) {
  if (!state.lastRenderMeta || state.vertices.length < 3) return -1;
  const xf = state.lastRenderMeta.transform;
  const hitR = isTouch ? 16 : 10;
  let bestIdx = -1;
  let bestDist = hitR;

  const vertexScreens = state.vertices.map((v) => xf.planToScreen(v));

  for (let i = 0; i < state.vertices.length; i++) {
    const a = vertexScreens[i];
    const b = vertexScreens[(i + 1) % vertexScreens.length];
    if (distance(a, b) < 44) continue;
    const mid = { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 };
    if (vertexScreens.some((vp) => distance(mid, vp) < 16)) continue;
    const d = distance(screenPt, mid);
    if (d <= bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function hitTestPointList(screenPt, imgPts, isTouch = false) {
  if (!state.lastRenderMeta || !imgPts || imgPts.length === 0) return -1;
  const xf = state.lastRenderMeta.transform;
  const hitR = isTouch ? 26 : 15;
  for (let i = 0; i < imgPts.length; i++) {
    const sp = xf.planToScreen(imgPts[i]);
    if (distance(screenPt, sp) <= hitR) return i;
  }
  return -1;
}

/**
 * Обработка одиночного касания (tap без перетаскивания) на шаге «3. Контур стен»:
 * - если касание дальше 11 px от существующих углов -> добавляет новый угол (в том числе на коротких стенах лоджии);
 * - если касание слишком близко (<= 11 px) -> не ставит дубликат, выделяет угол и просит приблизить план.
 */
function handleContourTap(pt) {
  if (!state.lastRenderMeta || !state.planCanvas) return;
  const xf = state.lastRenderMeta.transform;
  const rawImgPt = xf.screenToPlan(pt);

  if (
    rawImgPt.x < -20 ||
    rawImgPt.x > state.planWidth + 20 ||
    rawImgPt.y < -20 ||
    rawImgPt.y > state.planHeight + 20
  ) {
    return;
  }

  const vertexScreenPts = state.vertices.map((v) => xf.planToScreen(v));
  const prox = classifyContourTapProximity(
    pt,
    vertexScreenPts,
    MIN_NEW_CORNER_DIST_PX
  );

  if (prox.action === 'too-close') {
    if (prox.nearestIndex >= 0) {
      state.selectedVertexIndex = prox.nearestIndex;
    }
    state.contourTransientHint =
      'Слишком близко к существующему углу — приблизьте план двумя пальцами, чтобы отметить короткую стену.';
    syncInspectorUI();
    requestRender();
    return;
  }

  const clamped = {
    x: Math.max(0, Math.min(state.planWidth, rawImgPt.x)),
    y: Math.max(0, Math.min(state.planHeight, rawImgPt.y)),
  };

  state.contourTransientHint = '';
  pushContourUndoSnapshot();

  const refs = [];
  if (state.vertices.length >= 1) {
    refs.push(state.vertices[state.vertices.length - 1]);
  }
  if (state.vertices.length >= 2) {
    refs.push(state.vertices[0]);
  }
  const finalPt = applyOrthoSnapPoint(clamped, refs, state.zoom, state.orthoSnap);
  state.vertices.push(finalPt);
  state.selectedVertexIndex = state.vertices.length - 1;
  recomputeVastuMap();
  schedulePersist();
}

// ============================================================================
// Обработка касаний и мыши на чертеже
// ============================================================================
const activePointers = new Map();
let gesture = null;

mapCanvas.addEventListener('pointerdown', (e) => {
  if (!state.planCanvas && !isViewingSatelliteCanvas()) return;
  try {
    mapCanvas.setPointerCapture(e.pointerId);
  } catch {
    // Игнорируем синтетические события без pointerId
  }

  const pt = getCanvasLocalPoint(e.clientX, e.clientY);
  const isTouch = e.pointerType === 'touch';
  activePointers.set(e.pointerId, pt);

  // Замораживаем поворот экрана на всё время любого жеста на плане
  freezeScreenRotationForGesture();

  // Два пальца -> масштабирование щипком (pinch-to-zoom)
  if (activePointers.size === 2) {
    const pts = Array.from(activePointers.values());
    const mid = { x: (pts[0].x + pts[1].x) * 0.5, y: (pts[0].y + pts[1].y) * 0.5 };
    gesture = {
      type: 'pinch',
      startDist: Math.max(10, distance(pts[0], pts[1])),
      startZoom: isViewingSatelliteCanvas() ? state.satZoom : state.zoom,
      lastMid: mid,
    };
    return;
  }

  if (activePointers.size > 2) return;

  // 1. Режим отметки точек 1 и 2 на снимке спутника
  if (isViewingSatelliteCanvas()) {
    const hitSatIdx = hitTestPointList(pt, state.sat.satPts, isTouch);
    if (hitSatIdx !== -1) {
      gesture = {
        type: 'drag-sat-pt',
        target: 'sat',
        pointIndex: hitSatIdx,
        savedPt: { ...state.sat.satPts[hitSatIdx] },
        tooShort: false,
      };
      return;
    }
    gesture = { type: 'pan-or-tap', startPt: pt, lastPt: pt, moved: false };
    return;
  }

  // 2. Шаг «2. Север»:
  //    ручного поворота стрелки «С» НЕТ; точки «1» и «2» двигаются только на этапе plan-pick!
  if (state.activeTab === 'north') {
    const planWallHitIdx =
      state.satViewMode === 'plan-pick' && state.sat.planPts.length > 0
        ? hitTestPointList(pt, state.sat.planPts, isTouch)
        : -1;
    const hitDecision = resolvePlanTabHitAction({
      satViewMode: state.satViewMode,
      hitPlanWallPointIndex: planWallHitIdx,
    });

    if (hitDecision.action === 'drag-plan-wall-pt') {
      gesture = {
        type: 'drag-sat-pt',
        target: 'plan',
        pointIndex: hitDecision.pointIndex,
        savedPt: { ...state.sat.planPts[hitDecision.pointIndex] },
        tooShort: false,
      };
      return;
    }
  }

  // 3. Шаг «3. Контур стен»:
  //    захват существующего угла активируется ТОЛЬКО когда реально начинается перетаскивание!
  if (state.activeTab === 'contour') {
    const vIdx = hitTestVertex(pt, isTouch);
    if (vIdx !== -1) {
      gesture = {
        type: 'vertex-or-tap',
        vertexIndex: vIdx,
        startPt: pt,
        lastPt: pt,
        dragging: false,
        snapshotSaved: false,
      };
      return;
    }

    const edgeIdx = hitTestEdgeMidpoint(pt, isTouch);
    if (edgeIdx !== -1) {
      pushContourUndoSnapshot();
      state.contourTransientHint = '';
      const a = state.vertices[edgeIdx];
      const b = state.vertices[(edgeIdx + 1) % state.vertices.length];
      const inserted = { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 };
      const insertPos = edgeIdx + 1;
      state.vertices.splice(insertPos, 0, inserted);
      state.selectedVertexIndex = insertPos;
      gesture = {
        type: 'vertex-or-tap',
        vertexIndex: insertPos,
        startPt: pt,
        lastPt: pt,
        dragging: true,
        snapshotSaved: true,
      };
      recomputeVastuMap();
      schedulePersist();
      return;
    }
  }

  gesture = {
    type: 'pan-or-tap',
    startPt: pt,
    lastPt: pt,
    moved: false,
  };
});

mapCanvas.addEventListener('pointermove', (e) => {
  const pt = getCanvasLocalPoint(e.clientX, e.clientY);
  if (activePointers.has(e.pointerId)) {
    activePointers.set(e.pointerId, pt);
  }

  if (!gesture) {
    if (e.pointerType === 'mouse') {
      if (!state.planCanvas && !isViewingSatelliteCanvas()) {
        mapCanvas.style.cursor = 'default';
        return;
      }
      if (state.activeTab === 'contour') {
        const vIdx = hitTestVertex(pt, false);
        const eIdx = vIdx === -1 ? hitTestEdgeMidpoint(pt, false) : -1;
        if (vIdx !== state.hoveredVertexIndex || eIdx !== state.hoveredEdgeMidpoint) {
          state.hoveredVertexIndex = vIdx;
          state.hoveredEdgeMidpoint = eIdx;
          mapCanvas.style.cursor = vIdx !== -1 || eIdx !== -1 ? 'pointer' : 'crosshair';
          requestRender();
        }
      } else if (
        state.activeTab === 'north' &&
        (isViewingSatelliteCanvas() || state.satViewMode === 'plan-pick')
      ) {
        mapCanvas.style.cursor = 'crosshair';
      } else {
        mapCanvas.style.cursor = 'grab';
      }
    }
    return;
  }

  if (gesture.type === 'pinch' && activePointers.size >= 2) {
    const pts = Array.from(activePointers.values());
    const mid = { x: (pts[0].x + pts[1].x) * 0.5, y: (pts[0].y + pts[1].y) * 0.5 };
    const currDist = Math.max(10, distance(pts[0], pts[1]));

    if (isViewingSatelliteCanvas()) {
      state.satPanX += mid.x - gesture.lastMid.x;
      state.satPanY += mid.y - gesture.lastMid.y;
      const targetZoom = Math.max(
        0.1,
        Math.min(10, gesture.startZoom * (currDist / gesture.startDist))
      );
      zoomByFactor(targetZoom / state.satZoom, mid);
    } else {
      state.panX += mid.x - gesture.lastMid.x;
      state.panY += mid.y - gesture.lastMid.y;
      const targetZoom = Math.max(
        0.1,
        Math.min(10, gesture.startZoom * (currDist / gesture.startDist))
      );
      zoomByFactor(targetZoom / state.zoom, mid);
    }
    gesture.lastMid = mid;
    return;
  }

  if (gesture.type === 'drag-sat-pt' && state.lastRenderMeta) {
    const xf = state.lastRenderMeta.transform;
    const rawPt = xf.screenToPlan(pt);

    if (gesture.target === 'sat' && state.sat.canvas) {
      const cand = {
        x: Math.max(0, Math.min(state.sat.width, rawPt.x)),
        y: Math.max(0, Math.min(state.sat.height, rawPt.y)),
      };
      state.sat.satPts[gesture.pointIndex] = cand;

      if (state.sat.satPts.length === 2) {
        const s0 = xf.planToScreen(state.sat.satPts[0]);
        const s1 = xf.planToScreen(state.sat.satPts[1]);
        gesture.tooShort = !isWallSegmentLongEnoughOnScreen(s0, s1);
        if (!gesture.tooShort) {
          state.satShortWallWarning = '';
          state.sat.houseTiltDeg = houseTiltFromSatelliteWall(
            state.sat.satPts[0],
            state.sat.satPts[1]
          );
          if (state.sat.planPts.length === 2) {
            const deg = northAngleFromWallSegments(
              state.sat.satPts[0],
              state.sat.satPts[1],
              state.sat.planPts[0],
              state.sat.planPts[1]
            );
            if (deg !== null) {
              applySatelliteNorthAngle(deg, { keepFrozenRotation: true });
              return;
            }
          }
        }
      }
      syncInspectorUI();
      requestRender();
    } else if (gesture.target === 'plan' && state.satViewMode === 'plan-pick') {
      const cand = {
        x: Math.max(0, Math.min(state.planWidth, rawPt.x)),
        y: Math.max(0, Math.min(state.planHeight, rawPt.y)),
      };
      state.sat.planPts[gesture.pointIndex] = cand;

      if (state.sat.planPts.length === 2) {
        const s0 = xf.planToScreen(state.sat.planPts[0]);
        const s1 = xf.planToScreen(state.sat.planPts[1]);
        gesture.tooShort = !isWallSegmentLongEnoughOnScreen(s0, s1);
        if (!gesture.tooShort) {
          state.satShortWallWarning = '';
          if (state.sat.satPts.length === 2 && state.northSet) {
            const deg = northAngleFromWallSegments(
              state.sat.satPts[0],
              state.sat.satPts[1],
              state.sat.planPts[0],
              state.sat.planPts[1]
            );
            if (deg !== null) {
              state.sat.houseTiltDeg = houseTiltFromSatelliteWall(
                state.sat.satPts[0],
                state.sat.satPts[1]
              );
              applySatelliteNorthAngle(deg, { keepFrozenRotation: true });
              return;
            }
          }
        }
      }
      syncInspectorUI();
      requestRender();
    }
    return;
  }

  if (gesture.type === 'vertex-or-tap' && state.lastRenderMeta) {
    gesture.lastPt = pt;
    if (!gesture.dragging && distance(pt, gesture.startPt) < VERTEX_DRAG_START_PX) {
      return;
    }
    if (!gesture.dragging) {
      gesture.dragging = true;
      state.selectedVertexIndex = gesture.vertexIndex;
      state.contourTransientHint = '';
    }
    if (!gesture.snapshotSaved) {
      pushContourUndoSnapshot();
      gesture.snapshotSaved = true;
    }

    const idx = gesture.vertexIndex;
    const rawPlanPt = state.lastRenderMeta.transform.screenToPlan(pt);
    const clampedPt = {
      x: Math.max(0, Math.min(state.planWidth, rawPlanPt.x)),
      y: Math.max(0, Math.min(state.planHeight, rawPlanPt.y)),
    };
    const n = state.vertices.length;
    const refs =
      n >= 2
        ? [
            state.vertices[(idx - 1 + n) % n],
            n >= 3 ? state.vertices[(idx + 1) % n] : null,
          ]
        : [];
    state.vertices[idx] = applyOrthoSnapPoint(
      clampedPt,
      refs,
      state.zoom,
      state.orthoSnap
    );
    recomputeVastuMap();
    schedulePersist();
    return;
  }

  if (gesture.type === 'pan-or-tap') {
    const totalMove = distance(pt, gesture.startPt);
    if (totalMove > 6) {
      gesture.moved = true;
    }
    if (gesture.moved) {
      if (isViewingSatelliteCanvas()) {
        state.satPanX += pt.x - gesture.lastPt.x;
        state.satPanY += pt.y - gesture.lastPt.y;
      } else {
        state.panX += pt.x - gesture.lastPt.x;
        state.panY += pt.y - gesture.lastPt.y;
      }
      gesture.lastPt = pt;
      requestRender();
    }
  }
});

function finalizeRemainingPointers() {
  if (activePointers.size === 0) {
    gesture = null;
  } else if (activePointers.size === 1) {
    const remainingPt = Array.from(activePointers.values())[0];
    gesture = {
      type: 'pan-or-tap',
      startPt: remainingPt,
      lastPt: remainingPt,
      moved: true,
    };
  }
}

mapCanvas.addEventListener('pointerup', (e) => {
  const pt = getCanvasLocalPoint(e.clientX, e.clientY);
  activePointers.delete(e.pointerId);

  if (gesture && gesture.type === 'drag-sat-pt') {
    if (gesture.tooShort && gesture.savedPt) {
      if (gesture.target === 'sat') {
        state.sat.satPts[gesture.pointIndex] = gesture.savedPt;
        state.satShortWallWarning = `Отмеченная стена короче ${MIN_WALL_SEGMENT_SCREEN_PX} пикс. на экране — разведите двумя пальцами, чтобы увеличить дом, и отметьте углы подальше друг от друга.`;
      } else {
        state.sat.planPts[gesture.pointIndex] = gesture.savedPt;
        state.satShortWallWarning = `Отмеченная стена короче ${MIN_WALL_SEGMENT_SCREEN_PX} пикс. на экране — приблизьте план двумя пальцами и отметьте углы подальше друг от друга.`;
      }
      syncInspectorUI();
      requestRender();
    }
  } else if (
    gesture &&
    gesture.type === 'vertex-or-tap' &&
    !gesture.dragging &&
    state.activeTab === 'contour'
  ) {
    handleContourTap(pt);
  } else if (
    gesture &&
    gesture.type === 'pan-or-tap' &&
    !gesture.moved &&
    state.lastRenderMeta
  ) {
    const xf = state.lastRenderMeta.transform;
    const rawImgPt = xf.screenToPlan(pt);

    // 1. Отметка точек 1 и 2 на снимке спутника (с проверкой длины >= 100 экранных пикселей)
    if (isViewingSatelliteCanvas() && state.sat.canvas) {
      if (
        rawImgPt.x >= -15 &&
        rawImgPt.x <= state.sat.width + 15 &&
        rawImgPt.y >= -15 &&
        rawImgPt.y <= state.sat.height + 15 &&
        state.sat.satPts.length < 2
      ) {
        const clamped = {
          x: Math.max(0, Math.min(state.sat.width, rawImgPt.x)),
          y: Math.max(0, Math.min(state.sat.height, rawImgPt.y)),
        };
        if (state.sat.satPts.length === 0) {
          state.satShortWallWarning = '';
          state.sat.satPts.push(clamped);
          syncInspectorUI();
          requestRender();
        } else {
          const s1 = xf.planToScreen(state.sat.satPts[0]);
          const s2 = xf.planToScreen(clamped);
          if (!isWallSegmentLongEnoughOnScreen(s1, s2)) {
            state.satShortWallWarning =
              'Стена на снимке получилась слишком короткой — разведите двумя пальцами, чтобы увеличить дом, и отметьте два угла подальше друг от друга.';
            syncInspectorUI();
            requestRender();
          } else {
            state.satShortWallWarning = '';
            state.sat.satPts.push(clamped);
            state.sat.houseTiltDeg = houseTiltFromSatelliteWall(
              state.sat.satPts[0],
              state.sat.satPts[1]
            );
            syncInspectorUI();
            requestRender();
          }
        }
      }
    }
    // 2. Отметка точек 1 и 2 стены на плане квартиры (с проверкой длины >= 100 экранных пикселей)
    else if (state.activeTab === 'north' && state.satViewMode === 'plan-pick') {
      if (
        rawImgPt.x >= -15 &&
        rawImgPt.x <= state.planWidth + 15 &&
        rawImgPt.y >= -15 &&
        rawImgPt.y <= state.planHeight + 15 &&
        state.sat.planPts.length < 2
      ) {
        const clamped = {
          x: Math.max(0, Math.min(state.planWidth, rawImgPt.x)),
          y: Math.max(0, Math.min(state.planHeight, rawImgPt.y)),
        };
        if (state.sat.planPts.length === 0) {
          state.satShortWallWarning = '';
          state.sat.planPts.push(clamped);
          syncInspectorUI();
          requestRender();
        } else {
          const s1 = xf.planToScreen(state.sat.planPts[0]);
          const s2 = xf.planToScreen(clamped);
          if (!isWallSegmentLongEnoughOnScreen(s1, s2)) {
            state.satShortWallWarning =
              'Стена на плане получилась слишком короткой — приблизьте план двумя пальцами и отметьте два угла подальше друг от друга.';
            syncInspectorUI();
            requestRender();
          } else {
            state.satShortWallWarning = '';
            state.sat.planPts.push(clamped);
            syncInspectorUI();
            requestRender();
          }
        }
      }
    }
    // 3. Добавление внутреннего угла на шаге «3. Контур стен»
    else if (state.activeTab === 'contour') {
      handleContourTap(pt);
    }
  }

  finalizeRemainingPointers();
  unfreezeScreenRotationIfIdle({ fitIfRotationChanged: false });
});

// pointercancel никогда не добавляет новый угол!
mapCanvas.addEventListener('pointercancel', (e) => {
  activePointers.delete(e.pointerId);
  finalizeRemainingPointers();
  unfreezeScreenRotationIfIdle({ fitIfRotationChanged: false });
});

// Масштабирование колесом мыши / трекпадом
mapCanvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const pt = getCanvasLocalPoint(e.clientX, e.clientY);
    const factor = Math.pow(1.0018, -e.deltaY);
    zoomByFactor(factor, pt);
  },
  { passive: false }
);

// ============================================================================
// Действия кнопок «Отменить» / «Готово» в режимах постановки точек и на панелях
// ============================================================================
function handlePointPickingUndo() {
  if (state.activeTab === 'north' && state.satViewMode === 'sat') {
    state.satShortWallWarning = '';
    if (state.sat.satPts.length > 0) {
      state.sat.satPts.pop();
      syncInspectorUI();
      requestRender();
    } else {
      state.sat.canvas = null;
      state.sat.satPts = [];
      state.sat.planPts = [];
      state.satViewMode =
        state.northSet && state.northSource === 'satellite' ? 'done' : 'idle';
      syncInspectorUI();
      fitPlanToViewport();
    }
    return;
  }

  if (state.activeTab === 'north' && state.satViewMode === 'plan-pick') {
    state.satShortWallWarning = '';
    if (state.sat.planPts.length > 0) {
      state.sat.planPts.pop();
      syncInspectorUI();
      requestRender();
    } else if (state.sat.canvas) {
      state.satViewMode = 'sat';
      syncInspectorUI();
      fitSatelliteToViewport({ mode: 'large' });
    }
    return;
  }

  if (state.activeTab === 'contour') {
    handleContourUndoOrPop();
  }
}

function handlePointPickingDone() {
  if (state.activeTab === 'north' && state.satViewMode === 'sat') {
    if (state.sat.satPts.length < 2) return;
    state.satShortWallWarning = '';
    state.frozenRotationDeg = null;
    if (state.sat.planPts.length === 2) {
      tryComputeNorthFromSatellite();
    } else {
      state.satViewMode = 'plan-pick';
      syncInspectorUI();
      fitPlanToViewport();
    }
    return;
  }

  if (state.activeTab === 'north' && state.satViewMode === 'plan-pick') {
    if (state.sat.planPts.length < 2) return;
    state.satShortWallWarning = '';
    state.frozenRotationDeg = null;
    tryComputeNorthFromSatellite();
    return;
  }

  if (state.activeTab === 'contour') {
    const stepsInfo = computeStepsState(state);
    if (!stepsInfo.hasValidContour) return;
    setActiveTab(stepsInfo.hasNorth ? 'layers' : 'north');
  }
}

// ============================================================================
// Привязка кнопок интерфейса
// ============================================================================
for (const btn of Object.values(tabButtons)) {
  if (!btn) continue;
  btn.addEventListener('click', () => {
    if (btn.disabled) return;
    setActiveTab(btn.dataset.tab);
  });
}

pickingUndoBtn.addEventListener('click', handlePointPickingUndo);
pickingDoneBtn.addEventListener('click', handlePointPickingDone);
satDesktopUndoBtn.addEventListener('click', handlePointPickingUndo);
satDesktopDoneBtn.addEventListener('click', handlePointPickingDone);
contourDoneBtn.addEventListener('click', handlePointPickingDone);

planNextStepBtn.addEventListener('click', () => {
  const stepsInfo = computeStepsState(state);
  if (!stepsInfo.hasNorth) {
    setActiveTab('north');
  } else if (!stepsInfo.hasValidContour) {
    setActiveTab('contour');
  } else {
    setActiveTab('layers');
  }
});

northNextContourBtn.addEventListener('click', () => {
  const stepsInfo = computeStepsState(state);
  setActiveTab(stepsInfo.hasValidContour ? 'layers' : 'contour');
});

gotoNorthStepBtn.addEventListener('click', () => setActiveTab('north'));
gotoContourStepBtn.addEventListener('click', () => setActiveTab('contour'));

zoomInBtn.addEventListener('click', () => zoomByFactor(1.25));
zoomOutBtn.addEventListener('click', () => zoomByFactor(0.8));
zoomFitBtn.addEventListener('click', () => {
  if (isViewingSatelliteCanvas()) {
    fitSatelliteToViewport({ mode: 'fit' });
  } else {
    fitPlanToViewport();
  }
});

toggleCanvasSizeBtn.addEventListener('click', () => {
  const expanded = studioShell.classList.toggle('canvas-expanded');
  toggleCanvasSizeBtn.textContent = expanded ? 'Компактно' : 'Крупнее';
  setTimeout(() => {
    if (isViewingSatelliteCanvas()) {
      fitSatelliteToViewport({ mode: 'large' });
    } else {
      fitPlanToViewport();
    }
  }, 30);
});

// Шаг 1: загрузка собственного плана ученицы -> переход сразу на шаг 2 («2. Север»)
planFileInput.addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  planFileInput.value = '';
  if (!file) return;

  const hasExistingUserCorners =
    state.planCanvas &&
    state.vertices.length > 0 &&
    (!state.isSamplePlan || state.sampleModified);

  if (hasExistingUserCorners) {
    const confirmed = await askUserConfirmation({
      title: 'Заменить текущий план?',
      message:
        'На текущем плане уже отмечены углы контура. При открытии нового файла контур и привязка Севера будут сброшены.',
      confirmText: 'Открыть новый план',
      cancelText: 'Оставить текущий',
    });
    if (!confirmed) return;
  }

  planErrorBox.hidden = true;
  if (state.planCanvas) {
    statusBanner.textContent = 'Открываем файл плана…';
  }

  try {
    const loaded = await loadPlanFromFile(file);
    state.isSamplePlan = false;
    state.sampleModified = false;
    state.basePlanCanvas = loaded.canvas;
    state.sheetQuarterTurns = 0;
    state.planCanvas = loaded.canvas;
    state.planWidth = loaded.width;
    state.planHeight = loaded.height;
    state.planTitle = loaded.title;
    cachedBasePlanDataUrl = downscalePlanToDataUrl(loaded.canvas, 1400);

    state.vertices = [];
    state.undoHistory.clear();
    state.selectedVertexIndex = -1;
    state.contourTransientHint = '';
    state.mapExported = false;

    state.northSet = false;
    state.northSource = null;
    state.northAngleDeg = null;
    state.legacyManualNorthNotice = false;
    state.frozenRotationDeg = null;
    state.alignNorthUp = true;

    state.sat.canvas = null;
    state.sat.width = 0;
    state.sat.height = 0;
    state.sat.title = '';
    state.sat.satPts = [];
    state.sat.planPts = [];
    state.sat.houseTiltDeg = null;
    state.satShortWallWarning = '';
    state.satViewMode = 'idle';

    state.activeTab = 'north';
    recomputeVastuMap();
    fitPlanToViewport();
    schedulePersist(true);
  } catch (err) {
    const msg =
      err && err.message
        ? err.message
        : 'Не получилось открыть этот файл плана — загрузите план как фото или скриншот.';
    planErrorBox.textContent = msg;
    planErrorBox.hidden = false;
    setActiveTab('plan');
    if (state.planCanvas) {
      statusBanner.textContent = msg;
    }
  }
});

// Шаг 2: загрузка скриншота спутниковой карты (открывается сразу крупно для отметки точек 1 и 2!)
satFileInput.addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  satFileInput.value = '';
  if (!file || !state.planCanvas) return;

  planErrorBox.hidden = true;
  try {
    const loaded = await loadSatelliteFromFile(file);
    state.sat.canvas = loaded.canvas;
    state.sat.width = loaded.width;
    state.sat.height = loaded.height;
    state.sat.title = loaded.title;
    state.sat.satPts = [];
    state.sat.planPts = [];
    state.sat.houseTiltDeg = null;
    state.satShortWallWarning = '';
    state.satViewMode = 'sat';

    state.activeTab = 'north';
    syncInspectorUI();
    fitSatelliteToViewport({ mode: 'large' });
  } catch (err) {
    const msg =
      err && err.message
        ? err.message
        : 'Не получилось прочитать скриншот со спутника. Загрузите JPG или PNG.';
    planErrorBox.textContent = msg;
    planErrorBox.hidden = false;
    statusBanner.textContent = msg;
  }
});

satResetPointsBtn.addEventListener('click', () => {
  state.satShortWallWarning = '';
  if (state.sat.canvas) {
    state.sat.satPts = [];
    state.sat.planPts = [];
    state.sat.houseTiltDeg = null;
    state.satViewMode = 'sat';
    syncInspectorUI();
    fitSatelliteToViewport({ mode: 'large' });
  } else {
    state.northSet = false;
    state.northSource = null;
    state.northAngleDeg = null;
    state.sat.planPts = [];
    state.sat.houseTiltDeg = null;
    state.satViewMode = 'idle';
    recomputeVastuMap();
    fitPlanToViewport();
    schedulePersist();
  }
});

// Поворот загруженного листа плана на 90° по часовой стрелке (единый снимок в историю «Отменить»)
rotatePlan90Btn.addEventListener('click', () => {
  if (!state.planCanvas || !state.basePlanCanvas) return;
  pushSheetRotateUndoSnapshot();

  const wasNorthUp = Boolean(
    state.northSet && state.alignNorthUp && state.satViewMode !== 'plan-pick'
  );

  const rotatedState = applySheetRotation90CW({
    sheetQuarterTurns: state.sheetQuarterTurns,
    planWidth: state.planWidth,
    planHeight: state.planHeight,
    vertices: state.vertices,
    satPlanPts: state.sat.planPts,
    northSet: state.northSet,
    northSource: state.northSource,
    northAngleDeg: state.northAngleDeg,
  });

  state.sheetQuarterTurns = rotatedState.sheetQuarterTurns;
  state.planCanvas =
    state.sheetQuarterTurns === 0
      ? state.basePlanCanvas
      : rotatePlanCanvas(state.basePlanCanvas, state.sheetQuarterTurns);
  state.planWidth = state.planCanvas.width;
  state.planHeight = state.planCanvas.height;
  state.vertices = rotatedState.vertices;
  state.sat.planPts = rotatedState.satPlanPts;
  state.northSet = rotatedState.northSet;
  state.northSource = rotatedState.northSource;
  state.northAngleDeg = rotatedState.northAngleDeg;

  recomputeVastuMap();
  fitPlanToViewport();
  if (wasNorthUp) {
    statusBanner.textContent =
      'Лист повёрнут на 90° · На экране Север остаётся сверху (переключается в «4. Карта»)';
  }
  schedulePersist();
});

// Кнопки редактирования контура (сохраняют в историю ТОЛЬКО углы контура!)
undoContourBtn.addEventListener('click', () => {
  handleContourUndoOrPop();
});

deleteVertexBtn.addEventListener('click', () => {
  if (state.vertices.length === 0) return;
  state.contourTransientHint = '';
  pushContourUndoSnapshot();
  const removeIdx =
    state.selectedVertexIndex >= 0 &&
    state.selectedVertexIndex < state.vertices.length
      ? state.selectedVertexIndex
      : state.vertices.length - 1;
  state.vertices.splice(removeIdx, 1);
  state.selectedVertexIndex = Math.min(removeIdx, state.vertices.length - 1);
  recomputeVastuMap();
  schedulePersist();
});

clearContourBtn.addEventListener('click', () => {
  if (state.vertices.length === 0) return;
  state.contourTransientHint = '';
  pushContourUndoSnapshot();
  state.vertices = [];
  state.selectedVertexIndex = -1;
  recomputeVastuMap();
  schedulePersist();
});

orthoSnapToggle.addEventListener('change', () => {
  state.orthoSnap = orthoSnapToggle.checked;
  schedulePersist();
});

// Переключатели слоёв и ориентации карты
toggleSectors.addEventListener('change', () => {
  state.layers.showSectors = toggleSectors.checked;
  syncInspectorUI();
  requestRender();
  schedulePersist();
});

if (toggleSectorLabels) {
  toggleSectorLabels.addEventListener('change', () => {
    state.layers.showSectorLabels = toggleSectorLabels.checked;
    syncInspectorUI();
    requestRender();
    schedulePersist();
  });
}

toggleBrahmastan.addEventListener('change', () => {
  state.layers.showBrahmastan = toggleBrahmastan.checked;
  syncInspectorUI();
  requestRender();
  schedulePersist();
});

togglePadas.addEventListener('change', () => {
  state.layers.showPadas = togglePadas.checked;
  syncInspectorUI();
  requestRender();
  schedulePersist();
});

togglePadaBelts.addEventListener('change', () => {
  state.layers.showPadaBelts = togglePadaBelts.checked;
  requestRender();
  schedulePersist();
});

togglePadaScores.addEventListener('change', () => {
  state.layers.showPadaScores = togglePadaScores.checked;
  requestRender();
  schedulePersist();
});

orientNorthUpBtn.addEventListener('click', () => {
  if (state.alignNorthUp) return;
  state.alignNorthUp = true;
  syncInspectorUI();
  fitPlanToViewport();
  schedulePersist();
});

orientAsOnSheetBtn.addEventListener('click', () => {
  if (!state.alignNorthUp) return;
  state.alignNorthUp = false;
  syncInspectorUI();
  fitPlanToViewport();
  schedulePersist();
});

sectorOpacitySlider.addEventListener('input', () => {
  const pct = Number(sectorOpacitySlider.value) || 40;
  sectorOpacityValue.textContent = `${pct}%`;
  state.layers.sectorOpacity = pct / 100;
  requestRender();
  schedulePersist();
});

// ============================================================================
// Сохранение готовой карты и отдельная отправка через «Поделиться»
// ============================================================================
function dataUrlToBlobSync(dataUrl) {
  const parts = dataUrl.split(',');
  const mimeMatch = parts[0].match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : 'image/png';
  const binary = atob(parts[1]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}

function showSaveConfirmation(message) {
  saveToastText.textContent = message;
  saveToast.hidden = false;
  if (saveToastTimer) clearTimeout(saveToastTimer);
  saveToastTimer = setTimeout(() => {
    saveToast.hidden = true;
  }, 5500);
}

function openImageHoldOverlay(dataUrl) {
  if (!dataUrl) return;
  previewModalImg.src = dataUrl;
  imagePreviewModal.hidden = false;
}

openSavedPreviewBtn.addEventListener('click', () => {
  if (lastExportDataUrl) {
    openImageHoldOverlay(lastExportDataUrl);
  }
});

function canInvokeWebShareWithFile(file) {
  if (
    typeof navigator === 'undefined' ||
    typeof navigator.canShare !== 'function' ||
    typeof navigator.share !== 'function'
  ) {
    return false;
  }

  let shareFnSource = '';
  try {
    shareFnSource = Function.prototype.toString.call(navigator.share);
  } catch {
    shareFnSource = '';
  }
  const isNativeShare = shareFnSource.includes('[native code]');
  const ua = (navigator && navigator.userAgent) || '';

  if (isNativeShare && (navigator.webdriver || /HeadlessChrome\//i.test(ua))) {
    return false;
  }

  try {
    return Boolean(navigator.canShare({ files: [file] }));
  } catch {
    return false;
  }
}

function buildExportArtifactOrWarn() {
  if (!state.planCanvas) {
    setActiveTab('plan');
    return null;
  }
  if (!canExportVastuMap(state)) {
    if (!state.northSet || state.northSource !== 'satellite') {
      setActiveTab('north');
    } else {
      setActiveTab('contour');
    }
    return null;
  }

  const exportCanvas = exportMapToPngCanvas(state);
  if (!exportCanvas) return null;

  const filename = buildExportFilename(new Date());
  const dataUrl = exportCanvas.toDataURL('image/png');
  lastExportDataUrl = dataUrl;
  const blob = dataUrlToBlobSync(dataUrl);
  const file = new File([blob], filename, { type: 'image/png' });
  return { filename, dataUrl, blob, file };
}

function markMapExportCompleted() {
  if (!state.mapExported) {
    state.mapExported = true;
    syncInspectorUI();
  }
}

function triggerDirectFileDownload({ filename, dataUrl, blob }) {
  const platInfo = detectExportPlatform({
    userAgent: navigator?.userAgent || '',
    platform: navigator?.platform || '',
    maxTouchPoints: navigator?.maxTouchPoints || 0,
  });

  if (platInfo.isEmbeddedMessenger || !('download' in HTMLAnchorElement.prototype)) {
    markMapExportCompleted();
    openImageHoldOverlay(dataUrl);
    showSaveConfirmation('Нажмите и удерживайте картинку, чтобы сохранить');
    return;
  }

  try {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 6000);
    markMapExportCompleted();
    showSaveConfirmation(`Карта сохранена (${filename})`);
  } catch {
    markMapExportCompleted();
    openImageHoldOverlay(dataUrl);
    showSaveConfirmation('Нажмите и удерживайте картинку, чтобы сохранить');
  }
}

async function saveReadyMapPng() {
  const artifact = buildExportArtifactOrWarn();
  if (!artifact) return;

  const platInfo = detectExportPlatform({
    userAgent: navigator?.userAgent || '',
    platform: navigator?.platform || '',
    maxTouchPoints: navigator?.maxTouchPoints || 0,
  });

  if (platInfo.preferShareSheetOnDownload && canInvokeWebShareWithFile(artifact.file)) {
    try {
      await navigator.share({
        files: [artifact.file],
        title: 'Васту-карта квартиры',
      });
      markMapExportCompleted();
      showSaveConfirmation('Отправлено');
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') {
        return;
      }
    }
  }

  triggerDirectFileDownload(artifact);
}

async function shareReadyMapPng() {
  const artifact = buildExportArtifactOrWarn();
  if (!artifact) return;

  if (canInvokeWebShareWithFile(artifact.file)) {
    try {
      await navigator.share({
        files: [artifact.file],
        title: 'Васту-карта квартиры',
      });
      markMapExportCompleted();
      showSaveConfirmation('Отправлено');
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') {
        return;
      }
    }
  }

  markMapExportCompleted();
  openImageHoldOverlay(artifact.dataUrl);
  showSaveConfirmation('Нажмите и удерживайте картинку, чтобы сохранить или переслать');
}

topExportBtn.addEventListener('click', saveReadyMapPng);
exportPngBtn.addEventListener('click', saveReadyMapPng);
if (shareMapBtn) {
  shareMapBtn.addEventListener('click', shareReadyMapPng);
}

// Клавиши быстрого управления (Cmd/Ctrl+Z для отмены и Escape для закрытия окон)
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!confirmModal.hidden) {
      closeConfirmModal(false);
      return;
    }
    if (!imagePreviewModal.hidden) {
      imagePreviewModal.hidden = true;
      return;
    }
  }

  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
    if (confirmModal.hidden && (state.undoHistory.length > 0 || state.vertices.length > 0)) {
      e.preventDefault();
      handlePointPickingUndo();
    }
  }
});

let lastObservedStageWidth = 0;
let lastObservedStageHeight = 0;
const resizeObserver = new ResizeObserver((entries) => {
  const entry = entries && entries[0];
  const w = entry ? Math.round(entry.contentRect.width) : 0;
  const h = entry ? Math.round(entry.contentRect.height) : 0;
  if (w === lastObservedStageWidth && h === lastObservedStageHeight) return;
  lastObservedStageWidth = w;
  lastObservedStageHeight = h;

  // Не сбиваем масштаб и замороженный поворот посреди активного жеста пальцем!
  if (gesture || activePointers.size > 0 || Number.isFinite(state.frozenRotationDeg)) {
    requestRender();
    return;
  }
  if (isViewingSatelliteCanvas()) {
    fitSatelliteToViewport({ mode: 'large' });
  } else if (state.planCanvas) {
    fitPlanToViewport();
  } else {
    requestRender();
  }
});
resizeObserver.observe(canvasStage);

// ============================================================================
// Инициализация и восстановление сохранённой работы ученицы:
// - при первом входе открывается Шаг 1 («Откройте план квартиры»), шаги 2–4 заблокированы;
// - старый черновик с «ручным» Севером открывается без ошибок, сохраняет план и контур,
//   и переводит ученицу на Шаг 2 с просьбой задать Север по спутнику.
// ============================================================================
function resetToFreshStep1() {
  state.isSamplePlan = false;
  state.sampleModified = false;
  state.basePlanCanvas = null;
  state.sheetQuarterTurns = 0;
  state.planCanvas = null;
  state.planWidth = 0;
  state.planHeight = 0;
  state.planTitle = '';
  cachedBasePlanDataUrl = null;

  state.vertices = [];
  state.undoHistory.clear();
  state.selectedVertexIndex = -1;
  state.contourTransientHint = '';
  state.mapExported = false;

  state.northSet = false;
  state.northSource = null;
  state.northAngleDeg = null;
  state.legacyManualNorthNotice = false;
  state.frozenRotationDeg = null;
  state.alignNorthUp = true;

  state.sat.canvas = null;
  state.sat.satPts = [];
  state.sat.planPts = [];
  state.sat.houseTiltDeg = null;
  state.satShortWallWarning = '';
  state.satViewMode = 'idle';

  state.activeTab = 'plan';
  recomputeVastuMap();
}

async function restoreOrInit() {
  const saved = await loadWorkspaceSession();
  const normalized = normalizeRestoredDraft(saved);

  if (normalized.hasDraft) {
    try {
      if (normalized.isSamplePlan) {
        const sample = createSampleFloorPlan();
        state.isSamplePlan = true;
        state.sampleModified = normalized.sampleModified;
        state.basePlanCanvas = sample.canvas;
        cachedBasePlanDataUrl = null;
      } else if (normalized.basePlanDataUrl) {
        const restoredBase = await restorePlanCanvasFromDataUrl(
          normalized.basePlanDataUrl,
          normalized.basePlanWidth,
          normalized.basePlanHeight
        );
        state.isSamplePlan = false;
        state.sampleModified = false;
        state.basePlanCanvas = restoredBase;
        cachedBasePlanDataUrl = normalized.basePlanDataUrl;
      } else {
        throw new Error('Missing saved plan image');
      }

      state.sheetQuarterTurns = normalized.sheetQuarterTurns;
      state.planCanvas =
        state.sheetQuarterTurns === 0
          ? state.basePlanCanvas
          : rotatePlanCanvas(state.basePlanCanvas, state.sheetQuarterTurns);
      state.planWidth = state.planCanvas.width;
      state.planHeight = state.planCanvas.height;
      state.planTitle = normalized.planTitle;

      state.vertices = normalized.vertices;
      state.undoHistory.clear();
      state.selectedVertexIndex = -1;
      state.contourTransientHint = '';
      state.mapExported = false;

      state.northSet = normalized.northSet;
      state.northSource = normalized.northSource;
      state.northAngleDeg = normalized.northAngleDeg;
      state.legacyManualNorthNotice = normalized.needsSatelliteNorthPrompt;

      state.sat.canvas = null;
      state.sat.satPts = [];
      state.sat.planPts = normalized.satPlanPts;
      state.sat.houseTiltDeg = normalized.satHouseTiltDeg;
      state.satViewMode = normalized.northSet ? 'done' : 'idle';

      state.alignNorthUp = normalized.alignNorthUp;
      state.orthoSnap = normalized.orthoSnap;
      state.layers = normalized.layers;

      recomputeVastuMap();
      setActiveTab(normalized.activeTab);
      fitPlanToViewport();
      return;
    } catch {
      // Если сохранённые данные повреждены, мягко начинаем с Шага 1
    }
  }

  resetToFreshStep1();
}

function setupFontReadyRedraw() {
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      if (state.isSamplePlan && state.basePlanCanvas) {
        const refreshed = createSampleFloorPlan();
        state.basePlanCanvas = refreshed.canvas;
        state.planCanvas =
          state.sheetQuarterTurns === 0
            ? state.basePlanCanvas
            : rotatePlanCanvas(state.basePlanCanvas, state.sheetQuarterTurns);
      }
      requestRender();
    });
  }
}

restoreOrInit().then(() => {
  setupFontReadyRedraw();
});

// Экспорт ссылки на состояние для автопроверок
window.__vastuApp = {
  state,
  setActiveTab,
  recomputeVastuMap,
  syncInspectorUI,
  fitPlanToViewport,
  fitSatelliteToViewport,
  performUndo,
  handlePointPickingUndo,
  handlePointPickingDone,
  computeStepsState: () => computeStepsState(state),
  exportMapToPngCanvas: () => exportMapToPngCanvas(state),
};
