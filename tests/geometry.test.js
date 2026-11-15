import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeDeg,
  azimuthToUnitVector,
  signedAngleDeltaDeg,
  northAngleFromWallSegments,
  houseTiltFromSatelliteWall,
  polygonArea,
  computePolygonCenter,
  isPointInPolygon,
  hasSelfIntersection,
  extractPiecesBoundaryLoops,
  computeSectors,
  getSectorForPoint,
  getPadaForPoint,
  computePadaGrid,
  buildVastuMap,
  CENTER_OUTSIDE_NOTE,
  BRAHMASTAN_CLIPPED_NOTE,
  BRAHMASTAN_CLIPPED_BADGE,
} from '../src/geometry.js';
import {
  MIN_WALL_SEGMENT_SCREEN_PX,
  MIN_NORTH_HANDLE_TURN_DEG,
  MIN_NEW_CORNER_DIST_PX,
  applySheetRotation90CW,
  createUndoHistory,
  applyUndoEntry,
  computePlanViewRotationDeg,
  resolvePlanTabHitAction,
  isWallSegmentLongEnoughOnScreen,
  shouldCommitNorthHandleTurn,
  classifyContourTapProximity,
  applyOrthoSnapPoint,
  formatHouseTiltLine,
  detectExportPlatform,
  buildExportFilename,
  validateNorthDegreeInput,
  canExportVastuMap,
} from '../src/state-helpers.js';

function approxEqual(actual, expected, eps = 1e-6, msg = '') {
  assert.ok(
    Math.abs(actual - expected) <= eps,
    `${msg ? msg + ': ' : ''}ожидалось ${expected}, получено ${actual} (разница ${Math.abs(actual - expected)})`
  );
}

test('Центр прямоугольной квартиры совпадает с пересечением диагоналей', () => {
  const rect = [
    { x: 120, y: 80 },
    { x: 520, y: 80 },
    { x: 520, y: 380 },
    { x: 120, y: 380 },
  ];

  const center = computePolygonCenter(rect);
  assert.ok(center);
  approxEqual(center.x, 320, 1e-9, 'center.x');
  approxEqual(center.y, 230, 1e-9, 'center.y');
  approxEqual(polygonArea(rect), 400 * 300, 1e-6, 'площадь прямоугольника');

  const rectReversedWithMidpoint = [
    { x: 120, y: 80 },
    { x: 120, y: 380 },
    { x: 320, y: 380 },
    { x: 520, y: 380 },
    { x: 520, y: 80 },
  ];
  const center2 = computePolygonCenter(rectReversedWithMidpoint);
  approxEqual(center2.x, 320, 1e-9, 'center2.x');
  approxEqual(center2.y, 230, 1e-9, 'center2.y');
});

test('Центр Г-образной квартиры совпадает с расчётом по двум прямоугольникам (метод С. А. Балуты)', () => {
  const lShape = [
    { x: 0, y: 0 },
    { x: 6, y: 0 },
    { x: 6, y: 6 },
    { x: 12, y: 6 },
    { x: 12, y: 10 },
    { x: 0, y: 10 },
  ];

  const area = polygonArea(lShape);
  approxEqual(area, 84, 1e-9, 'площадь Г-образной квартиры');

  const center = computePolygonCenter(lShape);
  assert.ok(center);
  approxEqual(center.x, 33 / 7, 1e-9, 'Cx Г-образной квартиры');
  approxEqual(center.y, 41 / 7, 1e-9, 'Cy Г-образной квартиры');
  assert.equal(isPointInPolygon(center, lShape), true);

  const shiftedReversed = [...lShape.slice(3), ...lShape.slice(0, 3)].reverse();
  const centerRev = computePolygonCenter(shiftedReversed);
  approxEqual(centerRev.x, 33 / 7, 1e-9);
  approxEqual(centerRev.y, 41 / 7, 1e-9);
});

test('Расчёт Севера и угла поворота дома (±45° по модулю 90°) по двум отрезкам стены', () => {
  const satW2E_1 = { x: 100, y: 200 };
  const satW2E_2 = { x: 300, y: 200 };
  const planL2R_1 = { x: 50, y: 80 };
  const planL2R_2 = { x: 450, y: 80 };
  approxEqual(
    northAngleFromWallSegments(satW2E_1, satW2E_2, planL2R_1, planL2R_2),
    0,
    1e-9,
    'Стена параллельна на снимке и плане -> Север 0°'
  );
  approxEqual(houseTiltFromSatelliteWall(satW2E_1, satW2E_2), 0, 1e-9);
  assert.equal(
    formatHouseTiltLine(houseTiltFromSatelliteWall(satW2E_1, satW2E_2)),
    'Дом повёрнут на 0° относительно сторон света'
  );

  // Если перепутать порядок точек 1 и 2 ТОЛЬКО на плане (отметить 2 -> 1), Север меняется ровно на 180°
  approxEqual(
    northAngleFromWallSegments(satW2E_1, satW2E_2, planL2R_2, planL2R_1),
    180,
    1e-9,
    'Смена порядка точек 1 и 2 на плане разворачивает Север ровно на 180°'
  );

  // Если поменять местами 1 и 2 и на спутнике, и на плане одновременно — угол Севера сохраняется
  approxEqual(
    northAngleFromWallSegments(satW2E_2, satW2E_1, planL2R_2, planL2R_1),
    0,
    1e-9
  );

  // Дом на спутнике повёрнут на +22° по часовой стрелке: стена идёт под азимутом 112°
  const dir112 = azimuthToUnitVector(112);
  const satTilted1 = { x: 200, y: 200 };
  const satTilted2 = { x: 200 + dir112.x * 150, y: 200 + dir112.y * 150 };
  const computedNorth = northAngleFromWallSegments(
    satTilted1,
    satTilted2,
    planL2R_1,
    planL2R_2
  );
  approxEqual(computedNorth, 338, 1e-6, 'Дом под углом +22° на спутнике -> Север 338° на листе');

  // Угол поворота дома по модулю 90° одинаков для любой из 4 перпендикулярных стен и при обратном порядке 1↔2
  approxEqual(houseTiltFromSatelliteWall(satTilted1, satTilted2), 22, 1e-6);
  approxEqual(houseTiltFromSatelliteWall(satTilted2, satTilted1), 22, 1e-6);
  const dir202 = azimuthToUnitVector(202);
  approxEqual(
    houseTiltFromSatelliteWall(
      { x: 0, y: 0 },
      { x: dir202.x * 120, y: dir202.y * 120 }
    ),
    22,
    1e-6
  );
  assert.equal(
    formatHouseTiltLine(houseTiltFromSatelliteWall(satTilted1, satTilted2)),
    'Дом повёрнут на 22° относительно сторон света'
  );

  // Отрицательный поворот (-18°: стена под азимутом 72°)
  const dir72 = azimuthToUnitVector(72);
  const tiltNeg = houseTiltFromSatelliteWall(
    { x: 0, y: 0 },
    { x: dir72.x * 120, y: dir72.y * 120 }
  );
  approxEqual(tiltNeg, -18, 1e-6);
  assert.equal(formatHouseTiltLine(tiltNeg), 'Дом повёрнут на −18° относительно сторон света');

  const computedFlipped = northAngleFromWallSegments(
    satTilted2,
    satTilted1,
    planL2R_1,
    planL2R_2
  );
  approxEqual(computedFlipped, normalizeDeg(computedNorth + 180), 1e-6);

  assert.equal(
    northAngleFromWallSegments(satW2E_1, satW2E_1, planL2R_1, planL2R_2),
    null
  );
  assert.equal(houseTiltFromSatelliteWall(satW2E_1, satW2E_1), null);

  approxEqual(signedAngleDeltaDeg(355, 10), 15, 1e-9);
  approxEqual(signedAngleDeltaDeg(10, 355), -15, 1e-9);
});

test('Углы 8 секторов относительно произвольного Севера и отсутствие секторов, пока Север не задан', () => {
  const lShape = [
    { x: 100, y: 100 },
    { x: 460, y: 100 },
    { x: 460, y: 340 },
    { x: 700, y: 340 },
    { x: 700, y: 580 },
    { x: 100, y: 580 },
  ];
  const totalArea = polygonArea(lShape);
  const center = computePolygonCenter(lShape);

  const mapWithoutNorth = buildVastuMap(lShape, null);
  assert.ok(mapWithoutNorth);
  assert.equal(mapWithoutNorth.northSet, false);
  assert.equal(mapWithoutNorth.northAngleDeg, null);
  assert.equal(mapWithoutNorth.sectors.length, 0);
  assert.equal(mapWithoutNorth.padaGrid, null);

  for (const northDeg of [0, 21, 33.5, 90, 145, 278.25, 359.5]) {
    const sectors = computeSectors(lShape, center, northDeg);
    assert.equal(sectors.length, 8);

    const northSector = sectors.find((s) => s.code === 'С');
    approxEqual(northSector.centerPlanDeg, normalizeDeg(northDeg), 1e-9);
    approxEqual(northSector.startPlanDeg, normalizeDeg(northDeg - 22.5), 1e-9);
    approxEqual(northSector.endPlanDeg, normalizeDeg(northDeg + 22.5), 1e-9);

    const swSector = sectors.find((s) => s.code === 'ЮЗ');
    approxEqual(swSector.centerPlanDeg, normalizeDeg(northDeg + 225), 1e-9);

    const sumArea = sectors.reduce((acc, s) => acc + s.area, 0);
    approxEqual(sumArea, totalArea, 1e-3, `Сумма секторов при Севере ${northDeg}°`);

    for (const s of sectors) {
      const dir = azimuthToUnitVector(s.centerPlanDeg);
      const probe = { x: center.x + dir.x * 50, y: center.y + dir.y * 50 };
      const detected = getSectorForPoint(probe, center, northDeg);
      assert.equal(detected.code, s.code);
    }
  }
});

test('Брахмастан по форме квартиры: чистый внешний контур без внутренних швов треугольников и пометка обрезки стеной', () => {
  // 1) Обычная Г-образная квартира: Брахмастан целиком внутри стен (1/9 площади)
  const regularL = [
    { x: 0, y: 0 },
    { x: 80, y: 0 },
    { x: 80, y: 50 },
    { x: 120, y: 50 },
    { x: 120, y: 100 },
    { x: 0, y: 100 },
  ];
  const map1 = buildVastuMap(regularL, 0);
  assert.equal(map1.centerInside, true);
  assert.equal(map1.centerOutsideOrClipped, false);
  assert.equal(map1.centerNote, null);
  assert.equal(map1.brahmastanClippedByWall, false);
  assert.equal(map1.brahmastanClippedNote, null);
  approxEqual(map1.brahmastan.area, polygonArea(regularL) / 9, 1e-5);
  assert.equal(map1.brahmastan.wasClipped, false);
  assert.equal(map1.brahmastan.outlineLoops.length, 1);

  // 2) Несимметричная Г-образная квартира: Брахмастан обрезан стеной (wasClipped = true),
  //    причём его внешний контур собирается в единый замкнутый многоугольник без внутренних швов треугольников!
  const partialClipL = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 40 },
    { x: 15, y: 40 },
    { x: 15, y: 120 },
    { x: 0, y: 120 },
  ];
  const map2 = buildVastuMap(partialClipL, 0);
  const bs2 = map2.brahmastan;
  assert.equal(map2.centerInside, true, 'Центр несимметричной Г-квартиры лежит внутри стен');
  assert.equal(bs2.wasClipped, true, 'Выступающий угол Брахмастана отсечён');
  assert.equal(map2.brahmastanClippedByWall, true, 'Включён признак обрезанного стеной Брахмастана');
  assert.equal(map2.brahmastanClippedNote, BRAHMASTAN_CLIPPED_NOTE);
  assert.equal(map2.brahmastanClippedBadge, BRAHMASTAN_CLIPPED_BADGE);
  assert.ok(bs2.area > 0, 'Оставшаяся внутри стен площадь Брахмастана строго больше нуля');
  assert.ok(bs2.area < bs2.rawArea, 'Отсечённая площадь меньше расчётной 1/9');

  // Проверяем, что вместо 6 отдельных кусков-треугольников со швами строится 1 внешний контур той же площади
  assert.ok(bs2.pieces.length >= 4, 'Исходно Брахмастан состоит из нескольких треугольных кусков');
  assert.equal(bs2.outlineLoops.length, 1, 'Внешний контур склеен в один замкнутый полигон без внутренних швов');
  approxEqual(
    polygonArea(bs2.outlineLoops[0]),
    bs2.area,
    1e-4,
    'Площадь внешнего контура в точности равна суммарной площади кусков Брахмастана'
  );
  // Ни одно ребро внешнего контура не проходит через внутренний центр Брахмабинду
  for (const pt of bs2.outlineLoops[0]) {
    const distToCenter = Math.hypot(pt.x - map2.center.x, pt.y - map2.center.y);
    assert.ok(distToCenter > 1, 'Внешний контур не заходит во внутреннюю вершину веера треугольников');
    assert.equal(isPointInPolygon(pt, partialClipL), true);
  }

  // Также проверим extractPiecesBoundaryLoops напрямую на двух смежных треугольниках квадрата
  const twoTriangles = [
    [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 40 },
    ],
    [
      { x: 0, y: 0 },
      { x: 40, y: 40 },
      { x: 0, y: 40 },
    ],
  ];
  const sqLoops = extractPiecesBoundaryLoops(twoTriangles);
  assert.equal(sqLoops.length, 1);
  assert.equal(sqLoops[0].length, 4, 'Диагональный шов двух треугольников полностью удалён');
  approxEqual(polygonArea(sqLoops[0]), 1600, 1e-6);

  // 3) Узкий Г-образный уголок (thinCornerL): центр вне стен, а отсечённый Брахмастан имеет нулевую площадь
  const thinCornerL = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 18 },
    { x: 18, y: 18 },
    { x: 18, y: 100 },
    { x: 0, y: 100 },
  ];
  const mapThin = buildVastuMap(thinCornerL, 15);
  assert.equal(mapThin.centerInside, false);
  approxEqual(mapThin.brahmastan.area, 0, 1e-6);
  assert.equal(mapThin.brahmastan.isEmpty, true);
  assert.equal(mapThin.centerOutsideOrClipped, true);
  assert.equal(mapThin.centerNote, CENTER_OUTSIDE_NOTE);

  // 4) П-образная квартира: центр во внутреннем дворе вне стен
  const uShape = [
    { x: 0, y: 0 },
    { x: 120, y: 0 },
    { x: 120, y: 100 },
    { x: 95, y: 100 },
    { x: 95, y: 22 },
    { x: 25, y: 22 },
    { x: 25, y: 100 },
    { x: 0, y: 100 },
  ];
  const mapU = buildVastuMap(uShape, 0);
  assert.equal(mapU.centerInside, false);
  assert.equal(mapU.centerOutsideOrClipped, true);
  assert.equal(mapU.centerNote, 'Центр вне стен — покажите эту карту Анне');
});

test('Пункт 1: отмена правки контура трогает ТОЛЬКО углы контура (Север и точки стены прежние), а отмена поворота листа возвращает всё вместе', () => {
  const history = createUndoHistory();

  // Ученица загрузила свой план (Север ещё не задан) и поставила 4 угла + 1 лишний 5-й угол
  const corners4 = [
    { x: 100, y: 120 },
    { x: 520, y: 120 },
    { x: 520, y: 420 },
    { x: 100, y: 420 },
  ];
  const corners5WithExtra = [
    ...corners4,
    { x: 80, y: 270 }, // лишний 5-й угол
  ];

  // Шаги обводки записались ДО того, как ученица задала Север!
  history.pushContour([]);
  history.pushContour(corners4.slice(0, 1));
  history.pushContour(corners4.slice(0, 2));
  history.pushContour(corners4.slice(0, 3));
  history.pushContour(corners4); // снимок перед добавлением лишнего 5-го угла

  // Затем ученица перешла во вкладку «Север» и задала Север по спутнику ПОСЛЕ обводки контура
  const currentAfterNorth = {
    sheetQuarterTurns: 0,
    planWidth: 1000,
    planHeight: 700,
    vertices: corners5WithExtra,
    satPlanPts: [
      { x: 100, y: 120 },
      { x: 520, y: 120 },
    ],
    satSatPts: [
      { x: 220, y: 180 },
      { x: 480, y: 260 },
    ],
    northSet: true,
    northAngleDeg: 338,
  };

  // Ученица возвращается в «Контур стен» и нажимает «Отменить» на лишнем 5-м угле
  const entry = history.pop();
  assert.equal(entry.kind, 'contour');
  const afterContourUndo = applyUndoEntry(currentAfterNorth, entry);

  assert.deepEqual(afterContourUndo.vertices, corners4, 'Лишний угол отменён, остались 4 угла');
  assert.equal(afterContourUndo.northSet, true, 'Север НЕ стёрся при отмене угла');
  approxEqual(afterContourUndo.northAngleDeg, 338, 1e-9, 'Угол Севера НЕ откатился и НЕ перевернулся');
  assert.deepEqual(afterContourUndo.satPlanPts, currentAfterNorth.satPlanPts, 'Точки стены на плане прежние');
  assert.deepEqual(afterContourUndo.satSatPts, currentAfterNorth.satSatPts, 'Точки стены на спутнике прежние');

  // Даже если дальше был прежний Север (например 158°), а потом ученица поправила Север на 338° и нажала «Отменить» угла:
  history.pushContour(corners4);
  const stateWithEditedCornerAndNewNorth = {
    ...afterContourUndo,
    vertices: [...corners4, { x: 300, y: 430 }],
    northSet: true,
    northAngleDeg: 338,
  };
  const afterSecondContourUndo = applyUndoEntry(stateWithEditedCornerAndNewNorth, history.pop());
  assert.deepEqual(afterSecondContourUndo.vertices, corners4);
  assert.equal(afterSecondContourUndo.northSet, true);
  approxEqual(afterSecondContourUndo.northAngleDeg, 338, 1e-9);

  // Теперь проверяем «Повернуть лист на 90°» и его отмену: лист, контур, точки плана и Север возвращаются ВМЕСТЕ!
  history.pushSheetRotate(afterContourUndo);
  const rotatedState = {
    ...applySheetRotation90CW(afterContourUndo),
    satSatPts: afterContourUndo.satSatPts,
  };
  assert.equal(rotatedState.sheetQuarterTurns, 1);
  assert.equal(rotatedState.planWidth, 700);
  assert.equal(rotatedState.planHeight, 1000);
  approxEqual(rotatedState.northAngleDeg, normalizeDeg(338 + 90), 1e-9);

  const rotateUndoEntry = history.pop();
  assert.equal(rotateUndoEntry.kind, 'sheet-rotate');
  const restoredFromRotate = applyUndoEntry(rotatedState, rotateUndoEntry);

  assert.equal(restoredFromRotate.turnsChanged, true);
  assert.equal(restoredFromRotate.sheetQuarterTurns, 0);
  assert.equal(restoredFromRotate.planWidth, 1000);
  assert.equal(restoredFromRotate.planHeight, 700);
  assert.equal(restoredFromRotate.northSet, true);
  approxEqual(restoredFromRotate.northAngleDeg, 338, 1e-9);
  assert.deepEqual(restoredFromRotate.vertices, corners4);
  assert.deepEqual(restoredFromRotate.satPlanPts, currentAfterNorth.satPlanPts);
  assert.deepEqual(restoredFromRotate.satSatPts, currentAfterNorth.satSatPts);
});

test('Пункт 2: в «Проверке «С»» точки «1» и «2» только для показа, «С» перехватывается раньше маркеров, а поворот экрана заморожен на всё время жеста', () => {
  // 1) Стрелка «С» проверяется раньше любых маркеров стены даже при наложении в одну точку экрана
  assert.deepEqual(
    resolvePlanTabHitAction({
      hitNorthHandle: true,
      satViewMode: 'plan-pick',
      hitPlanWallPointIndex: 0,
    }),
    { action: 'rotate-north', pointIndex: -1 },
    'Стрелка «С» имеет приоритет над точками стены'
  );
  assert.deepEqual(
    resolvePlanTabHitAction({
      hitNorthHandle: true,
      satViewMode: 'done',
      hitPlanWallPointIndex: 1,
    }),
    { action: 'rotate-north', pointIndex: -1 }
  );

  // 2) В виде «Проверка «С»» (satViewMode === 'done', план повёрнут севером вверх) точки «1» и «2» ТОЛЬКО для показа:
  //    касание по ним НЕ запускает перетаскивание и не уводит Север!
  assert.deepEqual(
    resolvePlanTabHitAction({
      hitNorthHandle: false,
      satViewMode: 'done',
      hitPlanWallPointIndex: 0,
    }),
    { action: 'pan-or-tap', pointIndex: -1 },
    'В виде Проверка «С» точки 1 и 2 не перетаскиваются'
  );

  // 3) Во вкладке «2. На плане» (satViewMode === 'plan-pick') лист НЕ повёрнут (0°), и точки «1» и «2» доступны для поправки
  assert.deepEqual(
    resolvePlanTabHitAction({
      hitNorthHandle: false,
      satViewMode: 'plan-pick',
      hitPlanWallPointIndex: 1,
    }),
    { action: 'drag-plan-wall-pt', pointIndex: 1 }
  );
  approxEqual(
    computePlanViewRotationDeg({
      activeTab: 'plan',
      satViewMode: 'plan-pick',
      northSet: true,
      northAngleDeg: 62,
      alignNorthUp: true,
      frozenRotationDeg: null,
    }),
    0,
    1e-9,
    'Во вкладке «2. На плане» лист не повёрнут'
  );

  // 4) Во время любого жеста перетаскивания поворот экрана заморожен (frozenRotationDeg = -62°),
  //    поэтому при вращении «С» с 62° на 95° план не крутится под пальцем до отпускания!
  approxEqual(
    computePlanViewRotationDeg({
      activeTab: 'plan',
      satViewMode: 'done',
      northSet: true,
      northAngleDeg: 95,
      alignNorthUp: true,
      frozenRotationDeg: -62,
    }),
    -62,
    1e-9,
    'Во время жеста экран держит замороженный поворот -62°, не вращаясь под пальцем'
  );
  approxEqual(
    computePlanViewRotationDeg({
      activeTab: 'plan',
      satViewMode: 'done',
      northSet: true,
      northAngleDeg: 95,
      alignNorthUp: true,
      frozenRotationDeg: null,
    }),
    -95,
    1e-9,
    'После завершения жеста план встаёт по новому Северу (-95°)'
  );
});

test('Пункты 3, 7, 8: минимальная длина стены 100 px, порог поворота стрелки «С» (> 3°) и разделение Android / iPhone при сохранении', () => {
  // Пункт 3: отрезок стены короче 100 экранных px отклоняется и на спутнике, и на плане
  assert.equal(MIN_WALL_SEGMENT_SCREEN_PX, 100);
  assert.equal(
    isWallSegmentLongEnoughOnScreen({ x: 100, y: 100 }, { x: 130, y: 100 }),
    false,
    'Стена 30 px слишком короткая — отклоняем'
  );
  assert.equal(
    isWallSegmentLongEnoughOnScreen({ x: 100, y: 100 }, { x: 199, y: 100 }),
    false,
    'Стена 99 px короче порога 100 px — отклоняем'
  );
  assert.equal(
    isWallSegmentLongEnoughOnScreen({ x: 100, y: 100 }, { x: 200, y: 100 }),
    true,
    'Стена 100 px принимается'
  );
  assert.equal(
    isWallSegmentLongEnoughOnScreen({ x: 50, y: 60 }, { x: 170, y: 140 }),
    true,
    'Стена ~144 px принимается'
  );

  // Пункт 8: касание «С» без заданного Севера не задаёт Север около 0°, нужен поворот > 3°
  assert.equal(MIN_NORTH_HANDLE_TURN_DEG, 3);
  assert.equal(
    shouldCommitNorthHandleTurn({ wasNorthSet: false, maxAbsDeltaDeg: 0 }),
    false,
    'Простое касание «С» без поворота не задаёт Север'
  );
  assert.equal(
    shouldCommitNorthHandleTurn({ wasNorthSet: false, maxAbsDeltaDeg: 2.8 }),
    false,
    'Дрожание пальца на 2.8° не задаёт Север'
  );
  assert.equal(
    shouldCommitNorthHandleTurn({ wasNorthSet: false, maxAbsDeltaDeg: 3.2 }),
    true,
    'Настоящий поворот стрелки на 3.2° (> 3°) задаёт Север'
  );
  assert.equal(
    shouldCommitNorthHandleTurn({ wasNorthSet: true, maxAbsDeltaDeg: 1.0 }),
    true,
    'Если Север уже был задан, тонкая подстройка на 1° сохраняется'
  );

  // Пункт 7: Android скачивает файл по «Скачать карту», iPhone открывает системное меню «Поделиться»
  const androidChrome = detectExportPlatform({
    userAgent:
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
    platform: 'Linux armv8l',
    maxTouchPoints: 5,
  });
  assert.equal(androidChrome.isAndroid, true);
  assert.equal(androidChrome.isIOS, false);
  assert.equal(
    androidChrome.preferShareSheetOnDownload,
    false,
    'На Android «Скачать карту» скачивает файл напрямую, не подменяя его окном Поделиться'
  );

  const iphoneSafari = detectExportPlatform({
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
    platform: 'iPhone',
    maxTouchPoints: 5,
  });
  assert.equal(iphoneSafari.isIOS, true);
  assert.equal(iphoneSafari.preferShareSheetOnDownload, true);

  const ipadOS = detectExportPlatform({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
    platform: 'MacIntel',
    maxTouchPoints: 5,
  });
  assert.equal(ipadOS.isIOS, true);
  assert.equal(ipadOS.preferShareSheetOnDownload, true);

  const telegramIOS = detectExportPlatform({
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Telegram/10.5',
    platform: 'iPhone',
    maxTouchPoints: 5,
  });
  assert.equal(telegramIOS.isEmbeddedMessenger, true);
  assert.equal(telegramIOS.preferShareSheetOnDownload, false);
});

test('Пункт 9: короткие стены и квартира с лоджией — касание дальше 11 px добавляет угол, выравнивание 90° не схлопывает торец лоджии', () => {
  assert.equal(MIN_NEW_CORNER_DIST_PX, 11);

  const existingScreenCorners = [
    { x: 100, y: 100 },
    { x: 260, y: 100 },
    { x: 260, y: 116 }, // короткий торец лоджии всего 16 px на экране (внутри прежнего радиуса 26 px!)
  ];

  // Новое касание в 16 px от предыдущего угла (короткая стена лоджии) ДОБАВЛЯЕТ угол, а не теряется!
  const tapShortWall = classifyContourTapProximity(
    { x: 244, y: 116 },
    existingScreenCorners
  );
  assert.equal(tapShortWall.action, 'add', 'Касание на расстоянии 16 px добавляет новый угол короткой стены');

  // Слишком близкое касание (7 px от существующего угла) возвращает too-close для подсказки «приблизьте план»
  const tapTooClose = classifyContourTapProximity(
    { x: 265, y: 112 },
    existingScreenCorners
  );
  assert.equal(tapTooClose.action, 'too-close');

  // Помощник прямого угла 90° выравнивает микроскопический перекос по X (2 px),
  // но НЕ схлопывает короткую 14-пиксельную вертикальную стену торца лоджии в предыдущую точку!
  const snappedShortLedge = applyOrthoSnapPoint(
    { x: 262, y: 114 },
    [{ x: 260, y: 100 }],
    1,
    true
  );
  assert.deepEqual(
    snappedShortLedge,
    { x: 260, y: 114 },
    'Короткий вертикальный торец лоджии (14 px) выровнен под 90°, но сохранил свою длину'
  );

  // Квартира с выступающей застеклённой лоджией и короткими боковыми простенками (по 14 ед. при ширине квартиры 420 ед.)
  const apartmentWithLoggia = [
    { x: 0, y: 14 },
    { x: 150, y: 14 },
    { x: 150, y: 0 },   // короткий левый торец лоджии (длина 14)
    { x: 310, y: 0 },   // фасад остекления лоджии
    { x: 310, y: 14 },  // короткий правый торец лоджии (длина 14)
    { x: 420, y: 14 },
    { x: 420, y: 280 },
    { x: 0, y: 280 },
  ];

  // Прогоняем последовательную обводку всех 8 углов квартиры с лоджией с включённым 90° выравниванием
  const tracedVertices = [];
  for (const rawCorner of apartmentWithLoggia) {
    // Имитируем небольшую погрешность пальца ±1.5 px на каждом углу, в том числе на коротких торцах лоджии
    const noisy = { x: rawCorner.x + 1.2, y: rawCorner.y - 0.9 };
    if (tracedVertices.length > 0) {
      const prox = classifyContourTapProximity(noisy, tracedVertices);
      assert.equal(prox.action, 'add', 'Ни один угол лоджии не должен блокироваться соседним углом');
    }
    const prev = tracedVertices[tracedVertices.length - 1];
    const snapped = applyOrthoSnapPoint(noisy, prev ? [prev] : [], 1, true);
    tracedVertices.push(snapped);
  }

  assert.equal(tracedVertices.length, 8, 'Все 8 углов квартиры с лоджией сохранены');
  assert.equal(hasSelfIntersection(tracedVertices), false, 'Контур квартиры с лоджией без самопересечений');

  const loggiaMap = buildVastuMap(apartmentWithLoggia, 18);
  assert.ok(loggiaMap);
  const expectedArea = 420 * (280 - 14) + (310 - 150) * 14;
  approxEqual(loggiaMap.area, expectedArea, 1e-6, 'Площадь квартиры вместе с лоджией');
  assert.equal(loggiaMap.centerInside, true);
  assert.equal(loggiaMap.sectors.length, 8);
  assert.equal(loggiaMap.padaGrid.padas.length, 32);
});

test('Имя файла сохранения, валидация поля градусов 0–360 и запрет сохранения без контура или Севера', () => {
  assert.equal(
    buildExportFilename(new Date(2026, 10, 15)),
    'karta-kvartiry-2026-11-15.png'
  );
  assert.equal(
    buildExportFilename(new Date(2026, 2, 5)),
    'karta-kvartiry-2026-03-05.png'
  );

  assert.equal(validateNorthDegreeInput('0').ok, true);
  assert.equal(validateNorthDegreeInput('360').ok, true);
  assert.equal(validateNorthDegreeInput('22,5').value, 22.5);
  assert.equal(validateNorthDegreeInput('-5').ok, false);
  assert.equal(validateNorthDegreeInput('360.5').ok, false);
  assert.equal(validateNorthDegreeInput('420').ok, false);
  assert.equal(validateNorthDegreeInput('12e2').ok, false);

  const validVertices = [
    { x: 0, y: 0 },
    { x: 200, y: 0 },
    { x: 200, y: 200 },
    { x: 0, y: 200 },
  ];
  const map = buildVastuMap(validVertices, 40);

  assert.equal(
    canExportVastuMap({
      planCanvas: {},
      northSet: false,
      northAngleDeg: null,
      vertices: validVertices,
      vastuMap: buildVastuMap(validVertices, null),
    }),
    false
  );
  assert.equal(
    canExportVastuMap({
      planCanvas: {},
      northSet: true,
      northAngleDeg: 40,
      vertices: validVertices.slice(0, 2),
      vastuMap: null,
    }),
    false
  );
  assert.equal(
    canExportVastuMap({
      planCanvas: {},
      northSet: true,
      northAngleDeg: 40,
      vertices: validVertices,
      vastuMap: map,
    }),
    true
  );
});

test('Сетка пад: 32 радиальные пады по 11,25°, нумерация С. А. Балуты и концентрические пояса', () => {
  const poly = [
    { x: 50, y: 50 },
    { x: 450, y: 50 },
    { x: 450, y: 260 },
    { x: 620, y: 260 },
    { x: 620, y: 480 },
    { x: 50, y: 480 },
  ];
  const northDeg = 24;
  const map = buildVastuMap(poly, northDeg);
  assert.ok(map);

  const { padaGrid } = map;
  assert.equal(padaGrid.padas.length, 32);

  const p1 = padaGrid.padas.find((p) => p.number === 1);
  const p9 = padaGrid.padas.find((p) => p.number === 9);
  const p17 = padaGrid.padas.find((p) => p.number === 17);
  const p25 = padaGrid.padas.find((p) => p.number === 25);
  const p32 = padaGrid.padas.find((p) => p.number === 32);

  approxEqual(p1.centerAzimuth, 90, 1e-9);
  approxEqual(p9.centerAzimuth, 180, 1e-9);
  approxEqual(p17.centerAzimuth, 270, 1e-9);
  approxEqual(p25.centerAzimuth, 0, 1e-9);
  approxEqual(p32.centerAzimuth, 78.75, 1e-9);
  assert.equal(p32.score, 5);
  assert.equal(padaGrid.padas.find((p) => p.number === 24).score, 4);
  assert.equal(p9.score, -5);

  approxEqual(p25.centerPlanDeg, normalizeDeg(northDeg), 1e-9);
  approxEqual(p1.centerPlanDeg, normalizeDeg(northDeg + 90), 1e-9);

  const sumPadaAreas = padaGrid.padas.reduce((acc, p) => acc + p.area, 0);
  approxEqual(sumPadaAreas, map.area, 1e-2, 'Сумма площадей 32 пад');

  const northRayDir = azimuthToUnitVector(northDeg);
  const northPoint = {
    x: map.center.x + northRayDir.x * 100,
    y: map.center.y + northRayDir.y * 100,
  };
  assert.equal(getPadaForPoint(northPoint, map.center, northDeg).number, 25);

  const rect = [
    { x: 0, y: 0 },
    { x: 180, y: 0 },
    { x: 180, y: 90 },
    { x: 0, y: 90 },
  ];
  const rectGrid = computePadaGrid(rect, null, 0);
  const rectArea = polygonArea(rect);
  approxEqual(rectGrid.belts[0].area, rectArea / 81, 1e-5, 'Пояс 1/9 (Брахмабинду)');
  approxEqual(rectGrid.belts[1].area, rectArea / 9, 1e-5, 'Пояс 3/9 (Брахмастан)');
  approxEqual(rectGrid.belts[2].area, (rectArea * 25) / 81, 1e-5, 'Пояс 5/9 (Дева)');
  approxEqual(rectGrid.belts[3].area, (rectArea * 49) / 81, 1e-5, 'Пояс 7/9 (Манушья)');
});

test('Обнаружение самопересекающегося контура («песочные часы»)', () => {
  const validQuad = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ];
  const bowtie = [
    { x: 0, y: 0 },
    { x: 100, y: 100 },
    { x: 100, y: 0 },
    { x: 0, y: 100 },
  ];
  assert.equal(hasSelfIntersection(validQuad), false);
  assert.equal(hasSelfIntersection(bowtie), true);
});
