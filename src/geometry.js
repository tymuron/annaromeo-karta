/**
 * Геометрическое ядро конструктора Васту-карты (метод школы С. А. Балуты / Анны Ромео).
 *
 * Система координат плана:
 *   x — вправо, y — вниз.
 *   Азимут на плане (в градусах): 0° — вверх (x=0, y=-1), по часовой стрелке:
 *   90° — вправо, 180° — вниз, 270° — влево.
 */

import { SECTORS, PADAS, CONCENTRIC_BELTS, BRAHMASTAN_META } from './vastu-data.js';

const EPS = 1e-7;

/** Приводит угол в градусах к диапазону [0, 360). */
export function normalizeDeg(deg) {
  const n = Number(deg) || 0;
  const mod = ((n % 360) + 360) % 360;
  return Object.is(mod, -0) || Math.abs(mod - 360) < 1e-12 ? 0 : mod;
}

/** Единичный вектор на плане для заданного угла (0° = вверх, по часовой стрелке). */
export function azimuthToUnitVector(deg) {
  const rad = (normalizeDeg(deg) * Math.PI) / 180;
  return {
    x: Math.sin(rad),
    y: -Math.cos(rad),
  };
}

/** Угол вектора на плане в градусах [0, 360) (0° = вверх, по часовой стрелке). */
export function vectorToAzimuthDeg(dx, dy) {
  if (Math.abs(dx) < 1e-12 && Math.abs(dy) < 1e-12) return 0;
  const rad = Math.atan2(dx, -dy);
  return normalizeDeg((rad * 180) / Math.PI);
}

/** Кратчайшая знаковая разница углов (в градусах) от fromDeg к toDeg в диапазоне (-180, 180]. */
export function signedAngleDeltaDeg(fromDeg, toDeg) {
  const diff = (((Number(toDeg) - Number(fromDeg)) % 360) + 540) % 360 - 180;
  return diff === -180 ? 180 : diff;
}

/**
 * Вычисляет направление географического Севера на плане (в градусах по часовой стрелке от верха листа)
 * по двум отмеченным углам одной и той же наружной стены:
 * - satPoint1 -> satPoint2: отрезок стены на спутниковом снимке (где Север строго сверху, 0°);
 * - planPoint1 -> planPoint2: те же два угла в том же порядке на плане квартиры.
 */
export function northAngleFromWallSegments(satPoint1, satPoint2, planPoint1, planPoint2) {
  if (
    !satPoint1 ||
    !satPoint2 ||
    !planPoint1 ||
    !planPoint2 ||
    !Number.isFinite(satPoint1.x) ||
    !Number.isFinite(satPoint1.y) ||
    !Number.isFinite(satPoint2.x) ||
    !Number.isFinite(satPoint2.y) ||
    !Number.isFinite(planPoint1.x) ||
    !Number.isFinite(planPoint1.y) ||
    !Number.isFinite(planPoint2.x) ||
    !Number.isFinite(planPoint2.y)
  ) {
    return null;
  }

  const satDx = satPoint2.x - satPoint1.x;
  const satDy = satPoint2.y - satPoint1.y;
  const planDx = planPoint2.x - planPoint1.x;
  const planDy = planPoint2.y - planPoint1.y;

  if (Math.hypot(satDx, satDy) < 1e-6 || Math.hypot(planDx, planDy) < 1e-6) {
    return null;
  }

  const satWallAzimuth = vectorToAzimuthDeg(satDx, satDy);
  const planWallAzimuth = vectorToAzimuthDeg(planDx, planDy);
  return normalizeDeg(planWallAzimuth - satWallAzimuth);
}

/**
 * Вычисляет угол поворота дома относительно сторон света по стене на спутниковом снимке:
 * направление стены по модулю 90°, приведённое к диапазону (-45°, +45°].
 * Не зависит от того, какая из четырёх взаимно перпендикулярных стен выбрана и в каком порядке поставлены 1 и 2.
 */
export function houseTiltFromSatelliteWall(satPoint1, satPoint2) {
  if (
    !satPoint1 ||
    !satPoint2 ||
    !Number.isFinite(satPoint1.x) ||
    !Number.isFinite(satPoint1.y) ||
    !Number.isFinite(satPoint2.x) ||
    !Number.isFinite(satPoint2.y)
  ) {
    return null;
  }
  const dx = satPoint2.x - satPoint1.x;
  const dy = satPoint2.y - satPoint1.y;
  if (Math.hypot(dx, dy) < 1e-6) return null;

  const az = vectorToAzimuthDeg(dx, dy);
  const mod90 = ((az % 90) + 90) % 90;
  const tilt = mod90 > 45 ? mod90 - 90 : mod90;
  return Object.is(tilt, -0) || Math.abs(tilt) < 1e-12 ? 0 : tilt;
}

/** Расстояние между двумя точками. */
export function distance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Очищает список вершин от подряд идущих дубликатов. */
export function cleanPolygonVertices(vertices, minDist = 1e-6) {
  if (!Array.isArray(vertices)) return [];
  const out = [];
  for (const pt of vertices) {
    if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) continue;
    if (out.length === 0 || distance(out[out.length - 1], pt) > minDist) {
      out.push({ x: pt.x, y: pt.y });
    }
  }
  if (out.length > 1 && distance(out[0], out[out.length - 1]) <= minDist) {
    out.pop();
  }
  return out;
}

/**
 * Знаковая площадь многоугольника (формула Гаусса / шнуровки).
 * В экранных координатах (x вправо, y вниз) положительна при обходе по часовой стрелке.
 */
export function polygonSignedArea(vertices) {
  const pts = cleanPolygonVertices(vertices);
  const n = pts.length;
  if (n < 3) return 0;
  const ox = pts[0].x;
  const oy = pts[0].y;
  let twiceArea = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    twiceArea += (a.x - ox) * (b.y - oy) - (b.x - ox) * (a.y - oy);
  }
  return twiceArea * 0.5;
}

/** Абсолютная площадь многоугольника. */
export function polygonArea(vertices) {
  return Math.abs(polygonSignedArea(vertices));
}

/**
 * Геометрический центр плоской фигуры (центр квартиры по её настоящей форме — Брахмабинду).
 * Даёт тот же точный результат, что и разбиение сложной/Г-образной квартиры на прямоугольники
 * с пропорцией площадей по методу С. А. Балуты (т. 2, с. 41–42).
 */
export function computePolygonCenter(vertices) {
  const pts = cleanPolygonVertices(vertices);
  const n = pts.length;
  if (n < 3) return null;

  const ox = pts[0].x;
  const oy = pts[0].y;
  let twiceArea = 0;
  let cxAcc = 0;
  let cyAcc = 0;

  for (let i = 0; i < n; i++) {
    const ax = pts[i].x - ox;
    const ay = pts[i].y - oy;
    const bx = pts[(i + 1) % n].x - ox;
    const by = pts[(i + 1) % n].y - oy;
    const cross = ax * by - bx * ay;
    twiceArea += cross;
    cxAcc += (ax + bx) * cross;
    cyAcc += (ay + by) * cross;
  }

  if (Math.abs(twiceArea) < 1e-8) {
    return null;
  }

  const inv3A = 1 / (3 * twiceArea);
  return {
    x: ox + cxAcc * inv3A,
    y: oy + cyAcc * inv3A,
  };
}

/** Проверка принадлежности точки многоугольнику (включая границу). */
export function isPointInPolygon(point, vertices) {
  const pts = cleanPolygonVertices(vertices);
  const n = pts.length;
  if (n < 3) return false;

  // Проверка попадания ровно на ребро
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    if (pointToSegmentDistance(point, a, b) <= 1e-6) {
      return true;
    }
  }

  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = pts[i].x;
    const yi = pts[i].y;
    const xj = pts[j].x;
    const yj = pts[j].y;

    const intersects =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Расстояние от точки до отрезка AB и проекция точки на отрезок. */
export function projectPointToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-12) {
    return { x: a.x, y: a.y, t: 0, dist: distance(p, a) };
  }
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  const proj = { x: a.x + t * dx, y: a.y + t * dy };
  return { ...proj, t, dist: distance(p, proj) };
}

export function pointToSegmentDistance(p, a, b) {
  return projectPointToSegment(p, a, b).dist;
}

function segmentsProperlyIntersect(a, b, c, d) {
  const cross = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);

  if (
    ((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS)) &&
    ((d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS))
  ) {
    return true;
  }

  const onSeg = (p, q, r) =>
    Math.abs(cross(p, q, r)) <= EPS &&
    Math.min(p.x, q.x) - EPS <= r.x &&
    r.x <= Math.max(p.x, q.x) + EPS &&
    Math.min(p.y, q.y) - EPS <= r.y &&
    r.y <= Math.max(p.y, q.y) + EPS;

  if (onSeg(c, d, a) || onSeg(c, d, b) || onSeg(a, b, c) || onSeg(a, b, d)) {
    return true;
  }
  return false;
}

/** Проверяет, пересекаются ли несмежные стены многоугольника сами с собой. */
export function hasSelfIntersection(vertices) {
  const pts = cleanPolygonVertices(vertices);
  const n = pts.length;
  if (n < 4) return false;

  for (let i = 0; i < n; i++) {
    const a1 = pts[i];
    const a2 = pts[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // смежные рёбра в начале/конце
      const b1 = pts[j];
      const b2 = pts[(j + 1) % n];
      if (segmentsProperlyIntersect(a1, a2, b1, b2)) {
        return true;
      }
    }
  }
  return false;
}

/** Упрощает коллинеарные вершины перед триангуляцией. */
function simplifyCollinear(pts) {
  let work = cleanPolygonVertices(pts);
  let changed = true;
  while (changed && work.length >= 3) {
    changed = false;
    const next = [];
    const m = work.length;
    for (let i = 0; i < m; i++) {
      const prev = work[(i - 1 + m) % m];
      const curr = work[i];
      const after = work[(i + 1) % m];
      const ux = curr.x - prev.x;
      const uy = curr.y - prev.y;
      const vx = after.x - curr.x;
      const vy = after.y - curr.y;
      const cross = ux * vy - uy * vx;
      const scale = Math.hypot(ux, uy) * Math.hypot(vx, vy);
      if (scale < 1e-12 || Math.abs(cross) <= 1e-8 * scale) {
        changed = true;
        continue;
      }
      next.push(curr);
    }
    work = cleanPolygonVertices(next);
  }
  return work;
}

function pointInTriangleInclusive(p, a, b, c) {
  // Предполагается положительный обход (a -> b -> c): cross(b-a, c-a) > 0
  const c1 = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  const c2 = (c.x - b.x) * (p.y - b.y) - (c.y - b.y) * (p.x - b.x);
  const c3 = (a.x - c.x) * (p.y - c.y) - (a.y - c.y) * (p.x - c.x);
  return c1 >= -1e-8 && c2 >= -1e-8 && c3 >= -1e-8;
}

/**
 * Триангуляция произвольного простого многоугольника (включая Г-образные, П-образные и с выступами)
 * методом отсечения ушей (Ear Clipping). Возвращает массив выпуклых треугольников [[p0, p1, p2], ...].
 */
export function triangulatePolygon(vertices) {
  let pts = simplifyCollinear(vertices);
  if (pts.length < 3) return [];
  if (polygonSignedArea(pts) < 0) {
    pts = [...pts].reverse();
  }
  if (pts.length === 3) {
    return polygonArea(pts) > 1e-9 ? [pts] : [];
  }

  const remaining = pts.map((p) => ({ x: p.x, y: p.y }));
  const triangles = [];
  let guard = remaining.length * remaining.length + 20;

  while (remaining.length > 3 && guard-- > 0) {
    const m = remaining.length;
    let earFound = false;

    for (const tolerance of [1e-9, -1e-7]) {
      for (let i = 0; i < m; i++) {
        const prev = remaining[(i - 1 + m) % m];
        const curr = remaining[i];
        const next = remaining[(i + 1) % m];

        const cross =
          (curr.x - prev.x) * (next.y - curr.y) -
          (curr.y - prev.y) * (next.x - curr.x);
        if (cross <= tolerance) continue;

        let hasPointInside = false;
        if (cross > 1e-9) {
          for (let j = 0; j < m; j++) {
            if (j === (i - 1 + m) % m || j === i || j === (i + 1) % m) continue;
            const cand = remaining[j];
            if (
              distance(cand, prev) <= 1e-7 ||
              distance(cand, curr) <= 1e-7 ||
              distance(cand, next) <= 1e-7
            ) {
              continue;
            }
            if (pointInTriangleInclusive(cand, prev, curr, next)) {
              hasPointInside = true;
              break;
            }
          }
        }

        if (!hasPointInside) {
          const tri = [prev, curr, next];
          if (polygonArea(tri) > 1e-9) {
            triangles.push(tri);
          }
          remaining.splice(i, 1);
          earFound = true;
          break;
        }
      }
      if (earFound) break;
    }

    if (!earFound) {
      break;
    }
  }

  if (remaining.length === 3 && polygonArea(remaining) > 1e-9) {
    triangles.push(remaining);
  }
  return triangles;
}

/**
 * Отсечение выпуклого многоугольника subject другим выпуклым многоугольником clip
 * (алгоритм Сазерленда — Ходжмана). Оба приводятся к положительному обходу.
 */
export function clipConvexPolygon(subjectVertices, clipVertices) {
  let output = cleanPolygonVertices(subjectVertices);
  let clip = cleanPolygonVertices(clipVertices);
  if (output.length < 3 || clip.length < 3) return [];

  if (polygonSignedArea(output) < 0) output = [...output].reverse();
  if (polygonSignedArea(clip) < 0) clip = [...clip].reverse();

  const edgeCross = (a, b, p) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);

  const lineIntersection = (s, e, a, b) => {
    const dx1 = e.x - s.x;
    const dy1 = e.y - s.y;
    const dx2 = b.x - a.x;
    const dy2 = b.y - a.y;
    const denom = dx1 * dy2 - dy1 * dx2;
    if (Math.abs(denom) < 1e-12) {
      return { x: (s.x + e.x) * 0.5, y: (s.y + e.y) * 0.5 };
    }
    const t = ((a.x - s.x) * dy2 - (a.y - s.y) * dx2) / denom;
    return {
      x: s.x + t * dx1,
      y: s.y + t * dy1,
    };
  };

  for (let i = 0; i < clip.length; i++) {
    const cp1 = clip[i];
    const cp2 = clip[(i + 1) % clip.length];
    const input = output;
    output = [];
    if (input.length === 0) break;

    let s = input[input.length - 1];
    for (const e of input) {
      const eInside = edgeCross(cp1, cp2, e) >= -1e-8;
      const sInside = edgeCross(cp1, cp2, s) >= -1e-8;

      if (eInside) {
        if (!sInside) {
          output.push(lineIntersection(s, e, cp1, cp2));
        }
        output.push(e);
      } else if (sInside) {
        output.push(lineIntersection(s, e, cp1, cp2));
      }
      s = e;
    }
    output = cleanPolygonVertices(output, 1e-7);
  }

  return polygonArea(output) > 1e-8 ? output : [];
}

/**
 * Точное пересечение двух произвольных (в том числе невыпуклых) простых многоугольников.
 * Возвращает список неперекрывающихся выпуклых кусков с одинаковым обходом и суммарную площадь.
 */
export function intersectPolygons(polyA, polyB) {
  const trisA = triangulatePolygon(polyA);
  const trisB = triangulatePolygon(polyB);
  const pieces = [];
  let totalArea = 0;

  for (const ta of trisA) {
    for (const tb of trisB) {
      const clipped = clipConvexPolygon(ta, tb);
      if (clipped.length >= 3) {
        const a = polygonArea(clipped);
        if (a > 1e-7) {
          pieces.push(clipped);
          totalArea += a;
        }
      }
    }
  }

  return { pieces, area: totalArea };
}

/**
 * Извлекает только внешний контур (замкнутые граничные петли без внутренних швов триангуляции)
 * для набора неперекрывающихся кусков многоугольника pieces.
 */
export function extractPiecesBoundaryLoops(pieces) {
  if (!Array.isArray(pieces) || pieces.length === 0) return [];

  const orientedPieces = [];
  for (const rawPoly of pieces) {
    let pts = cleanPolygonVertices(rawPoly, 1e-5);
    if (pts.length < 3 || polygonArea(pts) <= 1e-7) continue;
    if (polygonSignedArea(pts) < 0) {
      pts = [...pts].reverse();
    }
    orientedPieces.push(pts);
  }

  if (orientedPieces.length === 0) return [];
  if (orientedPieces.length === 1) {
    const single = simplifyCollinear(orientedPieces[0]);
    return single.length >= 3 ? [single] : [orientedPieces[0]];
  }

  const SNAP_TOL = 1e-4;
  const canonicalNodes = [];

  function getCanonicalNodeIndex(pt) {
    for (let i = 0; i < canonicalNodes.length; i++) {
      if (distance(canonicalNodes[i], pt) <= SNAP_TOL) {
        return i;
      }
    }
    canonicalNodes.push({ x: pt.x, y: pt.y });
    return canonicalNodes.length - 1;
  }

  const indexedPieces = orientedPieces.map((poly) =>
    poly.map((pt) => getCanonicalNodeIndex(pt))
  );

  // Разбиваем каждое ребро промежуточными каноническими вершинами (устранение T-стыков)
  const rawDirectedEdges = [];
  for (const nodeLoop of indexedPieces) {
    const m = nodeLoop.length;
    for (let i = 0; i < m; i++) {
      const aIdx = nodeLoop[i];
      const bIdx = nodeLoop[(i + 1) % m];
      if (aIdx === bIdx) continue;
      const a = canonicalNodes[aIdx];
      const b = canonicalNodes[bIdx];
      const segLen = distance(a, b);
      if (segLen <= SNAP_TOL) continue;

      const mids = [];
      for (let k = 0; k < canonicalNodes.length; k++) {
        if (k === aIdx || k === bIdx) continue;
        const cand = canonicalNodes[k];
        const proj = projectPointToSegment(cand, a, b);
        if (proj.dist <= SNAP_TOL && proj.t > 1e-5 && proj.t < 1 - 1e-5) {
          mids.push({ idx: k, t: proj.t });
        }
      }
      mids.sort((p, q) => p.t - q.t);

      const chain = [aIdx, ...mids.map((item) => item.idx), bIdx];
      for (let c = 0; c < chain.length - 1; c++) {
        if (chain[c] !== chain[c + 1]) {
          rawDirectedEdges.push([chain[c], chain[c + 1]]);
        }
      }
    }
  }

  // Взаимно уничтожаем внутренние швы (пары встречных рёбер u->v и v->u)
  const edgeCounts = new Map();
  for (const [u, v] of rawDirectedEdges) {
    const revKey = `${v}:${u}`;
    const revCount = edgeCounts.get(revKey) || 0;
    if (revCount > 0) {
      if (revCount === 1) edgeCounts.delete(revKey);
      else edgeCounts.set(revKey, revCount - 1);
    } else {
      const fwdKey = `${u}:${v}`;
      edgeCounts.set(fwdKey, (edgeCounts.get(fwdKey) || 0) + 1);
    }
  }

  const outgoing = new Map();
  for (const [key, count] of edgeCounts.entries()) {
    const [uStr, vStr] = key.split(':');
    const u = Number(uStr);
    const v = Number(vStr);
    if (!outgoing.has(u)) outgoing.set(u, []);
    for (let c = 0; c < count; c++) {
      outgoing.get(u).push(v);
    }
  }

  const loops = [];
  for (const startNode of outgoing.keys()) {
    while (outgoing.has(startNode) && outgoing.get(startNode).length > 0) {
      const loopPts = [];
      let curr = startNode;
      let guard = rawDirectedEdges.length + 10;
      while (guard-- > 0) {
        loopPts.push(canonicalNodes[curr]);
        const nextList = outgoing.get(curr);
        if (!nextList || nextList.length === 0) break;
        const next = nextList.pop();
        if (nextList.length === 0) outgoing.delete(curr);
        curr = next;
        if (curr === startNode) break;
      }
      if (loopPts.length >= 3) {
        const simplified = simplifyCollinear(loopPts);
        if (simplified.length >= 3 && polygonArea(simplified) > 1e-7) {
          loops.push(simplified);
        }
      }
    }
  }

  return loops;
}

/** Масштабирует многоугольник гомотетично относительно центра C с коэффициентом scale. */
export function scalePolygonFromCenter(vertices, center, scale) {
  return cleanPolygonVertices(vertices).map((v) => ({
    x: center.x + (v.x - center.x) * scale,
    y: center.y + (v.y - center.y) * scale,
  }));
}

/**
 * Находит пересечения луча (из origin вдоль угла rayPlanDeg) со стенами многоугольника.
 * Возвращает отсортированный по удалению массив точек { x, y, dist, edgeIndex }.
 */
export function rayPolygonIntersections(origin, rayPlanDeg, vertices) {
  const pts = cleanPolygonVertices(vertices);
  const n = pts.length;
  if (n < 3) return [];

  const dir = azimuthToUnitVector(rayPlanDeg);
  const hits = [];

  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const denom = dir.x * ey - dir.y * ex;
    if (Math.abs(denom) < 1e-11) continue;

    const ox = a.x - origin.x;
    const oy = a.y - origin.y;
    const t = (ox * ey - oy * ex) / denom;
    const u = (ox * dir.y - oy * dir.x) / denom;

    if (t >= -1e-7 && u >= -1e-7 && u <= 1 + 1e-7) {
      const dist = Math.max(0, t);
      const hitPt = {
        x: origin.x + dir.x * dist,
        y: origin.y + dir.y * dist,
        dist,
        edgeIndex: i,
      };
      if (!hits.some((h) => distance(h, hitPt) < 1e-5)) {
        hits.push(hitPt);
      }
    }
  }

  hits.sort((p, q) => p.dist - q.dist);
  return hits;
}

/** Строит выпуклый треугольник-клин для сектора [startPlanDeg, endPlanDeg] (дуга < 90°). */
function buildRadialWedgeTriangle(center, startPlanDeg, spanDeg, maxRadius) {
  const reach = maxRadius * 4;
  const u1 = azimuthToUnitVector(startPlanDeg);
  const u2 = azimuthToUnitVector(startPlanDeg + spanDeg);
  return [
    { x: center.x, y: center.y },
    { x: center.x + u1.x * reach, y: center.y + u1.y * reach },
    { x: center.x + u2.x * reach, y: center.y + u2.y * reach },
  ];
}

function maxDistanceFromCenter(center, vertices) {
  let maxD = 1;
  for (const v of vertices) {
    const d = distance(center, v);
    if (d > maxD) maxD = d;
  }
  return maxD;
}

export const CENTER_OUTSIDE_NOTE = 'Центр вне стен — покажите эту карту Анне';
export const BRAHMASTAN_CLIPPED_NOTE =
  'Брахмастан прижат к наружной стене (обрезан по контуру квартиры)';
export const BRAHMASTAN_CLIPPED_BADGE = 'Брахмастан обрезан стеной';

/**
 * Брахмастан по форме квартиры (Р8 и Р9, _resheniya-anny.md:23-24; С. А. Балута, т. 2, с. 42–43):
 * 1) Центр соединяется со всеми внутренними углами, от центра откладывается 1/3 каждого отрезка
 *    (площадь невырезанного Брахмастана равна 1/9 площади квартиры).
 * 2) За пределами стен квартиры Брахмастан находиться не может: любая часть вне контура отсекается.
 * 3) Если центр вне стен или Брахмастан пуст / почти весь отсечён (осталось < 25% его расчётной площади),
 *    выставляется флаг isMostlyClipped.
 */
export function computeBrahmastan(vertices, centerInput = null) {
  const pts = cleanPolygonVertices(vertices);
  const center = centerInput || computePolygonCenter(pts);
  if (!center || pts.length < 3) return null;

  const centerInside = isPointInPolygon(center, pts);
  const apartmentArea = polygonArea(pts);
  const rawVertices = scalePolygonFromCenter(pts, center, 1 / 3);
  const rawArea = polygonArea(rawVertices);
  const { pieces, area } = intersectPolygons(rawVertices, pts);
  const wasClipped = rawArea - area > Math.max(1e-5, rawArea * 1e-5);
  const outlineLoops = wasClipped
    ? extractPiecesBoundaryLoops(pieces)
    : rawVertices.length >= 3
      ? [rawVertices]
      : [];
  const retainedRatio = rawArea > 0 ? area / rawArea : 0;
  const isEmpty = area <= 1e-5 || pieces.length === 0;
  const isMostlyClipped = isEmpty || retainedRatio < 0.25;

  const raysToCorners = pts.map((corner, idx) => ({
    index: idx,
    corner,
    thirdPoint: rawVertices[idx],
  }));

  return {
    meta: BRAHMASTAN_META,
    center,
    centerInside,
    rawVertices,
    pieces,
    outlineLoops,
    rawArea,
    area,
    retainedRatio,
    shareOfApartment: apartmentArea > 0 ? area / apartmentArea : 0,
    wasClipped,
    isEmpty,
    isMostlyClipped,
    raysToCorners,
  };
}

/**
 * 8 осей по сторонам света (С, СВ, В, ЮВ, Ю, ЮЗ, З, СЗ) из центра квартиры (Брахмабинду)
 * до контура квартиры и чуть за него.
 * Главные оси (С–Ю, В–З) помечены isCardinal = true, диагональные (СВ–ЮЗ, ЮВ–СЗ) — isCardinal = false.
 * Оси идут строго по сторонам света от центра (относительно географического Севера northAngleDeg), а не по стенам.
 */
export function computeAxes(vertices, centerInput = null, northAngleDeg = 0) {
  const pts = cleanPolygonVertices(vertices);
  const center = centerInput || computePolygonCenter(pts);
  if (!center || pts.length < 3) return [];

  const north = normalizeDeg(northAngleDeg);
  const maxR = maxDistanceFromCenter(center, pts);
  const overhangDist = Math.max(8, Math.min(28, maxR * 0.045));

  return SECTORS.map((sector) => {
    const azimuthDeg = sector.centerAzimuth;
    const planDeg = normalizeDeg(north + azimuthDeg);
    const dir = azimuthToUnitVector(planDeg);
    const isCardinal = azimuthDeg % 90 === 0;
    const hits = rayPolygonIntersections(center, planDeg, pts);
    const outerHit = hits.length > 0 ? hits[hits.length - 1] : null;

    let contourDist;
    if (outerHit) {
      contourDist = outerHit.dist;
    } else {
      let maxProj = 0;
      for (const v of pts) {
        const proj = (v.x - center.x) * dir.x + (v.y - center.y) * dir.y;
        if (proj > maxProj) maxProj = proj;
      }
      contourDist = Math.max(maxProj, maxR * 0.35);
    }

    const contourPoint = outerHit
      ? { x: outerHit.x, y: outerHit.y }
      : {
          x: center.x + dir.x * contourDist,
          y: center.y + dir.y * contourDist,
        };

    const endDist = contourDist + overhangDist;
    const endPoint = {
      x: center.x + dir.x * endDist,
      y: center.y + dir.y * endDist,
    };

    return {
      id: sector.id,
      code: sector.code,
      name: sector.name,
      azimuthDeg,
      planDeg,
      isCardinal,
      dir,
      origin: { x: center.x, y: center.y },
      contourHit: outerHit,
      contourDist,
      contourPoint,
      overhangDist,
      endDist,
      endPoint,
    };
  });
}

/**
 * 8 радиальных секторов по 45° относительно географического Севера на плане (northAngleDeg).
 * Для каждого сектора возвращает точные отсечённые по контуру куски, площадь, долю площади и точку подписи.
 */
export function computeSectors(vertices, centerInput = null, northAngleDeg = 0) {
  const pts = cleanPolygonVertices(vertices);
  const center = centerInput || computePolygonCenter(pts);
  if (!center || pts.length < 3) return [];

  const north = normalizeDeg(northAngleDeg);
  const totalArea = polygonArea(pts);
  const apartmentTris = triangulatePolygon(pts);
  const maxR = maxDistanceFromCenter(center, pts);

  return SECTORS.map((sector) => {
    const centerPlanDeg = normalizeDeg(north + sector.centerAzimuth);
    const startPlanDeg = normalizeDeg(centerPlanDeg - 22.5);
    const endPlanDeg = normalizeDeg(centerPlanDeg + 22.5);
    const wedge = buildRadialWedgeTriangle(center, startPlanDeg, 45, maxR);

    const pieces = [];
    let area = 0;
    let cxWeighted = 0;
    let cyWeighted = 0;

    for (const tri of apartmentTris) {
      const clipped = clipConvexPolygon(tri, wedge);
      if (clipped.length >= 3) {
        const a = polygonArea(clipped);
        if (a > 1e-7) {
          pieces.push(clipped);
          area += a;
          const pieceCenter = computePolygonCenter(clipped);
          if (pieceCenter) {
            cxWeighted += pieceCenter.x * a;
            cyWeighted += pieceCenter.y * a;
          }
        }
      }
    }

    const axisHits = rayPolygonIntersections(center, centerPlanDeg, pts);
    const boundaryStartHits = rayPolygonIntersections(center, startPlanDeg, pts);
    const outerHit = axisHits.length > 0 ? axisHits[axisHits.length - 1] : null;

    let labelPoint;
    if (area > 1e-6) {
      labelPoint = { x: cxWeighted / area, y: cyWeighted / area };
      if (!isPointInPolygon(labelPoint, pts) && outerHit) {
        const dir = azimuthToUnitVector(centerPlanDeg);
        labelPoint = {
          x: center.x + dir.x * outerHit.dist * 0.62,
          y: center.y + dir.y * outerHit.dist * 0.62,
        };
      }
    } else {
      const dir = azimuthToUnitVector(centerPlanDeg);
      const fallbackDist = outerHit ? outerHit.dist * 0.65 : maxR * 0.5;
      labelPoint = {
        x: center.x + dir.x * fallbackDist,
        y: center.y + dir.y * fallbackDist,
      };
    }

    return {
      ...sector,
      centerPlanDeg,
      startPlanDeg,
      endPlanDeg,
      pieces,
      area,
      share: totalArea > 0 ? area / totalArea : 0,
      sharePercent: totalArea > 0 ? (area / totalArea) * 100 : 0,
      labelPoint,
      axisOuterHit: outerHit,
      boundaryOuterHit:
        boundaryStartHits.length > 0
          ? boundaryStartHits[boundaryStartHits.length - 1]
          : null,
    };
  });
}

/** Определяет, в какой из 8 секторов попадает произвольная точка относительно центра и Севера. */
export function getSectorForPoint(point, center, northAngleDeg = 0) {
  const planDeg = vectorToAzimuthDeg(point.x - center.x, point.y - center.y);
  const geoAzimuth = normalizeDeg(planDeg - northAngleDeg);
  for (const sector of SECTORS) {
    const diff = Math.abs((((geoAzimuth - sector.centerAzimuth + 540) % 360) - 180));
    if (diff <= 22.5 + 1e-9) {
      return sector;
    }
  }
  return SECTORS[0];
}

/** Определяет номер пады (1..32) для произвольной точки относительно центра и Севера. */
export function getPadaForPoint(point, center, northAngleDeg = 0) {
  const planDeg = vectorToAzimuthDeg(point.x - center.x, point.y - center.y);
  const geoAzimuth = normalizeDeg(planDeg - northAngleDeg);
  for (const pada of PADAS) {
    const diff = Math.abs((((geoAzimuth - pada.centerAzimuth + 540) % 360) - 180));
    if (diff <= 5.625 + 1e-9) {
      return pada;
    }
  }
  return PADAS[0];
}

/**
 * Сетка пад по С. А. Балуте (32 радиальные пады по 11,25° вокруг центра + концентрические пояса по форме квартиры).
 */
export function computePadaGrid(vertices, centerInput = null, northAngleDeg = 0) {
  const pts = cleanPolygonVertices(vertices);
  const center = centerInput || computePolygonCenter(pts);
  if (!center || pts.length < 3) return null;

  const north = normalizeDeg(northAngleDeg);
  const apartmentTris = triangulatePolygon(pts);
  const maxR = maxDistanceFromCenter(center, pts);

  const padas = PADAS.map((pada) => {
    const centerPlanDeg = normalizeDeg(north + pada.centerAzimuth);
    const startPlanDeg = normalizeDeg(centerPlanDeg - 5.625);
    const endPlanDeg = normalizeDeg(centerPlanDeg + 5.625);
    const wedge = buildRadialWedgeTriangle(center, startPlanDeg, 11.25, maxR);

    const pieces = [];
    let area = 0;
    for (const tri of apartmentTris) {
      const clipped = clipConvexPolygon(tri, wedge);
      if (clipped.length >= 3) {
        const a = polygonArea(clipped);
        if (a > 1e-7) {
          pieces.push(clipped);
          area += a;
        }
      }
    }

    const centerHits = rayPolygonIntersections(center, centerPlanDeg, pts);
    const startHits = rayPolygonIntersections(center, startPlanDeg, pts);
    const outerWallHit = centerHits.length > 0 ? centerHits[centerHits.length - 1] : null;
    const boundaryWallHit = startHits.length > 0 ? startHits[startHits.length - 1] : null;

    const dir = azimuthToUnitVector(centerPlanDeg);
    const labelDist = outerWallHit ? outerWallHit.dist * 0.88 : maxR * 0.85;
    const labelPoint = {
      x: center.x + dir.x * labelDist,
      y: center.y + dir.y * labelDist,
    };

    return {
      ...pada,
      centerPlanDeg,
      startPlanDeg,
      endPlanDeg,
      pieces,
      area,
      outerWallHit,
      boundaryWallHit,
      labelPoint,
    };
  });

  const belts = CONCENTRIC_BELTS.map((belt) => {
    const rawVertices = scalePolygonFromCenter(pts, center, belt.scale);
    const rawArea = polygonArea(rawVertices);
    const { pieces, area } = intersectPolygons(rawVertices, pts);
    const wasClipped = rawArea - area > Math.max(1e-5, rawArea * 1e-5);
    const outlineLoops = wasClipped
      ? extractPiecesBoundaryLoops(pieces)
      : rawVertices.length >= 3
        ? [rawVertices]
        : [];
    return {
      ...belt,
      rawVertices,
      pieces,
      outlineLoops,
      area,
    };
  });

  return {
    center,
    northAngleDeg: north,
    padas,
    belts,
  };
}

/** Полный расчёт Васту-карты по контуру и направлению Севера (northAngleDeg может быть null, если Север ещё не задан). */
export function buildVastuMap(vertices, northAngleDeg = null) {
  const pts = cleanPolygonVertices(vertices);
  if (pts.length < 3) return null;

  const selfIntersects = hasSelfIntersection(pts);
  const center = computePolygonCenter(pts);
  if (!center) return null;

  const area = polygonArea(pts);
  const centerInside = isPointInPolygon(center, pts);
  const brahmastan = computeBrahmastan(pts, center);
  const centerOutsideOrClipped =
    !centerInside || !brahmastan || brahmastan.isMostlyClipped;
  const centerNote = centerOutsideOrClipped ? CENTER_OUTSIDE_NOTE : null;
  const brahmastanClippedByWall = Boolean(
    brahmastan && brahmastan.wasClipped && !brahmastan.isEmpty
  );
  const brahmastanClippedNote = brahmastanClippedByWall
    ? BRAHMASTAN_CLIPPED_NOTE
    : null;
  const brahmastanClippedBadge = brahmastanClippedByWall
    ? BRAHMASTAN_CLIPPED_BADGE
    : null;

  const hasNorth =
    northAngleDeg !== null &&
    northAngleDeg !== undefined &&
    northAngleDeg !== '' &&
    Number.isFinite(Number(northAngleDeg));

  const normalizedNorth = hasNorth ? normalizeDeg(Number(northAngleDeg)) : null;
  const axes = hasNorth ? computeAxes(pts, center, normalizedNorth) : [];
  const sectors = hasNorth ? computeSectors(pts, center, normalizedNorth) : [];
  const padaGrid = hasNorth ? computePadaGrid(pts, center, normalizedNorth) : null;

  return {
    vertices: pts,
    area,
    center,
    centerInside,
    centerOutsideOrClipped,
    centerNote,
    brahmastanClippedByWall,
    brahmastanClippedNote,
    brahmastanClippedBadge,
    selfIntersects,
    northSet: hasNorth,
    northAngleDeg: normalizedNorth,
    brahmastan,
    axes,
    sectors,
    padaGrid,
  };
}
