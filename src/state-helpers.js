/**
 * Чистые вспомогательные функции состояния, истории «Отменить», поворота листа,
 * проверки поля градусов и формирования имени сохраняемого файла карты.
 */

import { normalizeDeg } from './geometry.js';

export function clonePointList(pts) {
  if (!Array.isArray(pts)) return [];
  return pts.map((p) => ({ x: p.x, y: p.y }));
}

/**
 * Поворачивает список точек плана на 90° по часовой стрелке для листа с прежней высотой oldHeight.
 */
export function rotatePoints90CW(points, oldHeight) {
  return clonePointList(points).map((p) => ({
    x: oldHeight - p.y,
    y: p.x,
  }));
}

/**
 * Применяет поворот листа на 90° по часовой стрелке ко всем связанным данным
 * (размерам листа, контуру квартиры, опорным точкам плана и направлению Севера, если оно задано).
 */
export function applySheetRotation90CW(current) {
  const oldWidth = current.planWidth;
  const oldHeight = current.planHeight;
  const nextTurns = (((current.sheetQuarterTurns || 0) + 1) % 4 + 4) % 4;
  const hasNorth = Boolean(current.northSet && Number.isFinite(current.northAngleDeg));

  return {
    sheetQuarterTurns: nextTurns,
    planWidth: oldHeight,
    planHeight: oldWidth,
    vertices: rotatePoints90CW(current.vertices || [], oldHeight),
    satPlanPts: rotatePoints90CW(current.satPlanPts || [], oldHeight),
    northSet: hasNorth,
    northAngleDeg: hasNorth ? normalizeDeg(current.northAngleDeg + 90) : null,
  };
}

/**
 * Создаёт стек истории «Отменить», хранящий контур, ориентацию листа и Север единым снимком.
 */
export function createUndoHistory(maxEntries = 40) {
  const stack = [];

  function serializeState(s) {
    return {
      sheetQuarterTurns: s.sheetQuarterTurns || 0,
      planWidth: s.planWidth || 0,
      planHeight: s.planHeight || 0,
      vertices: clonePointList(s.vertices || []),
      satPlanPts: clonePointList(s.satPlanPts || []),
      northSet: Boolean(s.northSet),
      northAngleDeg:
        s.northSet && Number.isFinite(s.northAngleDeg)
          ? normalizeDeg(s.northAngleDeg)
          : null,
    };
  }

  return {
    push(state) {
      stack.push(serializeState(state));
      if (stack.length > maxEntries) {
        stack.shift();
      }
    },
    pop() {
      if (stack.length === 0) return null;
      return stack.pop();
    },
    clear() {
      stack.length = 0;
    },
    get length() {
      return stack.length;
    },
  };
}

/**
 * Имя файла сохраняемой карты: karta-kvartiry-ГГГГ-ММ-ДД.png
 */
export function buildExportFilename(date = new Date()) {
  const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  const yyyy = String(d.getFullYear()).padStart(4, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `karta-kvartiry-${yyyy}-${mm}-${dd}.png`;
}

/**
 * Проверяет ввод градусов Севера: допускается пустая строка во время набора
 * либо число строго в пределах [0, 360] (с точкой или запятой, без знаков + / - / e).
 */
export function validateNorthDegreeInput(rawText) {
  const str = String(rawText ?? '').trim();
  if (str === '') {
    return { ok: true, empty: true, value: null };
  }
  if (!/^\d+(?:[.,]\d*)?$/.test(str)) {
    return { ok: false, empty: false, value: null };
  }
  const normalized = str.replace(',', '.');
  const num = Number(normalized);
  if (!Number.isFinite(num) || num < 0 || num > 360) {
    return { ok: false, empty: false, value: null };
  }
  return { ok: true, empty: false, value: num };
}

/**
 * Разрешено ли сохранять готовую карту (нужны и замкнутый контур без самопересечений, и заданный Север).
 */
export function canExportVastuMap(state) {
  if (!state || !state.planCanvas) return false;
  if (!state.northSet || !Number.isFinite(state.northAngleDeg)) return false;
  if (!Array.isArray(state.vertices) || state.vertices.length < 3) return false;
  if (!state.vastuMap || state.vastuMap.selfIntersects) return false;
  return true;
}
