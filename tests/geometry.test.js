import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeDeg,
  azimuthToUnitVector,
  vectorToAzimuthDeg,
  northAngleFromCompass,
  polygonArea,
  computePolygonCenter,
  isPointInPolygon,
  hasSelfIntersection,
  computeBrahmastan,
  computeSectors,
  getSectorForPoint,
  getPadaForPoint,
  computePadaGrid,
  buildVastuMap,
} from '../src/geometry.js';

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

  // При обходе против часовой стрелки и добавлении промежуточной точки на стене центр не меняется
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
  // Г-образная квартира:
  // Левое крыло R1: [0..6] x [0..10] -> площадь S1 = 60, центр C1 = (3, 5)
  // Правое нижнее крыло R2: [6..12] x [6..10] -> площадь S2 = 24, центр C2 = (9, 8)
  // По правилу пропорции площадей С. А. Балуты (т. 2, с. 41–42):
  //   Cx = (60*3 + 24*9) / (60 + 24) = 396 / 84 = 33 / 7
  //   Cy = (60*5 + 24*8) / (60 + 24) = 492 / 84 = 41 / 7
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

  // Проверка независимости от циклического сдвига и обратного обхода
  const shiftedReversed = [...lShape.slice(3), ...lShape.slice(0, 3)].reverse();
  const centerRev = computePolygonCenter(shiftedReversed);
  approxEqual(centerRev.x, 33 / 7, 1e-9);
  approxEqual(centerRev.y, 41 / 7, 1e-9);
});

test('Углы 8 секторов относительно произвольного Севера и сумма их площадей', () => {
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

  for (const northDeg of [0, 21, 33.5, 90, 145, 278.25, 359.5]) {
    const sectors = computeSectors(lShape, center, northDeg);
    assert.equal(sectors.length, 8);

    // Северный сектор обязан смотреть на northDeg (±22.5°)
    const northSector = sectors.find((s) => s.code === 'С');
    approxEqual(northSector.centerPlanDeg, normalizeDeg(northDeg), 1e-9);
    approxEqual(northSector.startPlanDeg, normalizeDeg(northDeg - 22.5), 1e-9);
    approxEqual(northSector.endPlanDeg, normalizeDeg(northDeg + 22.5), 1e-9);

    // Юго-западный сектор обязан смотреть на northDeg + 225°
    const swSector = sectors.find((s) => s.code === 'ЮЗ');
    approxEqual(swSector.centerPlanDeg, normalizeDeg(northDeg + 225), 1e-9);

    // Сумма площадей всех 8 отсечённых секторов строго равна площади квартиры
    const sumArea = sectors.reduce((acc, s) => acc + s.area, 0);
    approxEqual(sumArea, totalArea, 1e-3, `Сумма секторов при Севере ${northDeg}°`);

    const sumPercent = sectors.reduce((acc, s) => acc + s.sharePercent, 0);
    approxEqual(sumPercent, 100, 1e-5);

    // Проверка точечного классификатора секторов для лучей вдоль осей
    for (const s of sectors) {
      const dir = azimuthToUnitVector(s.centerPlanDeg);
      const probe = { x: center.x + dir.x * 50, y: center.y + dir.y * 50 };
      const detected = getSectorForPoint(probe, center, northDeg);
      assert.equal(detected.code, s.code);
    }
  }
});

test('Перевод азимута компаса телефона в направление Севера на плане', () => {
  // Верхняя стена на плане смотрит вверх (луч 0°), компас телефона показывает 90° (Восток) -> Север слева (270°)
  approxEqual(northAngleFromCompass(90, 0), 270, 1e-9);
  // Компас показывает 30° -> Север отклонён на 30° против часовой стрелки от верха (330°)
  approxEqual(northAngleFromCompass(30, 0), 330, 1e-9);
  // Если ученица встала лицом вправо по плану (луч 90°), а компас показал 90° (Восток) -> Север ровно сверху (0°)
  approxEqual(northAngleFromCompass(90, 90), 0, 1e-9);

  // Обратимость преобразования единичного вектора и угла
  for (const deg of [0, 11.25, 45, 90, 135, 180, 225, 270, 315, 348.75]) {
    const u = azimuthToUnitVector(deg);
    approxEqual(vectorToAzimuthDeg(u.x, u.y), deg, 1e-9);
  }
});

test('Брахмастан по форме квартиры: 1/9 площади и отсечение за пределами стен (Р8, Р9)', () => {
  // 1) Обычная Г-образная квартира, где Брахмастан целиком помещается внутри стен
  const regularL = [
    { x: 0, y: 0 },
    { x: 80, y: 0 },
    { x: 80, y: 50 },
    { x: 120, y: 50 },
    { x: 120, y: 100 },
    { x: 0, y: 100 },
  ];
  const bs1 = computeBrahmastan(regularL);
  assert.ok(bs1);
  approxEqual(bs1.rawArea, polygonArea(regularL) / 9, 1e-5, '1/9 площади до отсечения');
  assert.equal(bs1.wasClipped, false);
  approxEqual(bs1.area, polygonArea(regularL) / 9, 1e-5, '1/9 площади внутри стен');
  approxEqual(bs1.shareOfApartment, 1 / 9, 1e-6);

  // Проверка построения третей от центра до каждого угла
  for (let i = 0; i < regularL.length; i++) {
    const expectedX = bs1.center.x + (regularL[i].x - bs1.center.x) / 3;
    const expectedY = bs1.center.y + (regularL[i].y - bs1.center.y) / 3;
    approxEqual(bs1.rawVertices[i].x, expectedX, 1e-9);
    approxEqual(bs1.rawVertices[i].y, expectedY, 1e-9);
  }

  // 2) Тонкая угловая Г-образная квартира (случай рис. 16 у С. А. Балуты, т. 2, с. 43):
  // часть гомотетичного контура 1/3 выходит во внутренний двор за пределы стен и обязана отсекаться!
  const thinCornerL = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 18 },
    { x: 18, y: 18 },
    { x: 18, y: 100 },
    { x: 0, y: 100 },
  ];
  const bs2 = computeBrahmastan(thinCornerL);
  assert.ok(bs2);
  approxEqual(bs2.rawArea, polygonArea(thinCornerL) / 9, 1e-5);
  assert.equal(bs2.wasClipped, true, 'Выступающая за стены часть Брахмастана должна отсекаться');
  assert.ok(bs2.area < bs2.rawArea, 'Отсечённая площадь меньше 1/9');

  // Все вершины оставшихся кусков Брахмастана лежат внутри или на границе квартиры
  for (const piece of bs2.pieces) {
    for (const pt of piece) {
      assert.equal(isPointInPolygon(pt, thinCornerL), true);
    }
  }
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

  // Ключевые пады по книге С. А. Балуты (т. 3, с. 94, рис. 110):
  // Пада 1 = Восток (90°), Пада 9 = Юг (180°), Пада 17 = Запад (270°), Пада 25 = Север (0°), Пада 32 = 78.75° (+5)
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
  assert.equal(p24Score(padaGrid), 4);
  assert.equal(p9.score, -5);

  // Учёт поворота Севера на плане
  approxEqual(p25.centerPlanDeg, normalizeDeg(northDeg), 1e-9);
  approxEqual(p1.centerPlanDeg, normalizeDeg(northDeg + 90), 1e-9);

  // Сумма площадей 32 пад равна полной площади Г-образной квартиры
  const sumPadaAreas = padaGrid.padas.reduce((acc, p) => acc + p.area, 0);
  approxEqual(sumPadaAreas, map.area, 1e-2, 'Сумма площадей 32 пад');

  // Проверка поиска пады по лучу
  const northRayDir = azimuthToUnitVector(northDeg);
  const northPoint = {
    x: map.center.x + northRayDir.x * 100,
    y: map.center.y + northRayDir.y * 100,
  };
  assert.equal(getPadaForPoint(northPoint, map.center, northDeg).number, 25);

  // Концентрические пояса: 1/9, 3/9, 5/9, 7/9 (площади 1/81, 1/9, 25/81, 49/81 для выпуклой фигуры)
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

function p24Score(padaGrid) {
  return padaGrid.padas.find((p) => p.number === 24).score;
}

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
