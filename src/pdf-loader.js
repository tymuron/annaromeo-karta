/**
 * Чтение планов квартир и спутниковых снимков из локальных файлов устройства
 * (JPG, PNG, WebP и первая страница PDF).
 * Обработка выполняется в браузере без отправки файлов в сеть.
 */

const PDF_FALLBACK_MESSAGE =
  'Не получилось открыть этот PDF на телефоне — загрузите план как фото или скриншот';
const IMAGE_FALLBACK_MESSAGE =
  'Не получилось прочитать изображение. Выберите файл JPG, PNG или скриншот экрана.';

const MAX_IOS_CANVAS_PIXELS = 15_500_000; // строго ниже лимита iOS (16 Мп)
const PDF_TARGET_SIDE_PX = 2000;
const IMAGE_MAX_SIDE_PX = 3000;
const SAT_MAX_SIDE_PX = 2000;
const PDF_TIMEOUT_MS = 15000;

let pdfjsPromise = null;

async function loadPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('./pdf-polyfills.mjs')
      .then(() => import('../vendor/pdf.min.mjs'))
      .then((mod) => {
        const workerUrl = new URL('../vendor/pdf.worker.entry.mjs', import.meta.url).href;
        mod.GlobalWorkerOptions.workerSrc = workerUrl;
        return mod;
      })
      .catch((err) => {
        pdfjsPromise = null;
        throw err;
      });
  }
  return pdfjsPromise;
}

function fitDimensionsWithinLimits(rawWidth, rawHeight, maxSidePx) {
  const sw = Math.max(1, Number(rawWidth) || 1);
  const sh = Math.max(1, Number(rawHeight) || 1);
  let scale = Math.min(1, maxSidePx / Math.max(sw, sh));
  const areaAfterSide = sw * scale * (sh * scale);
  if (areaAfterSide > MAX_IOS_CANVAS_PIXELS) {
    scale *= Math.sqrt(MAX_IOS_CANVAS_PIXELS / areaAfterSide);
  }
  return {
    width: Math.max(1, Math.floor(sw * scale)),
    height: Math.max(1, Math.floor(sh * scale)),
  };
}

/**
 * Проверяет, не отрисовался ли лист полностью белым / пустым.
 */
export function isCanvasBlankWhite(ctx, width, height) {
  if (width <= 0 || height <= 0) return true;
  const imgData = ctx.getImageData(0, 0, width, height).data;
  // Плотный шаг выборки (каждый 2-й пиксель) ловит даже тонкие линии 1px скана БТИ
  const stride = 8; // 2 пикселя * 4 канала RGBA
  for (let i = 0; i < imgData.length; i += stride) {
    const a = imgData[i + 3];
    if (a === 0) continue;
    const r = imgData[i];
    const g = imgData[i + 1];
    const b = imgData[i + 2];
    if (r < 250 || g < 250 || b < 250) {
      return false;
    }
  }
  return true;
}

/**
 * Поворачивает исходный Canvas/Image кратно 90° по часовой стрелке и возвращает новый Canvas.
 */
export function rotatePlanCanvas(source, quarterTurns = 1) {
  const turns = ((quarterTurns % 4) + 4) % 4;
  const sw = source.naturalWidth || source.width;
  const sh = source.naturalHeight || source.height;
  const out = document.createElement('canvas');

  if (turns % 2 === 1) {
    out.width = sh;
    out.height = sw;
  } else {
    out.width = sw;
    out.height = sh;
  }

  const ctx = out.getContext('2d');
  ctx.save();
  if (turns === 1) {
    ctx.translate(out.width, 0);
    ctx.rotate(Math.PI / 2);
  } else if (turns === 2) {
    ctx.translate(out.width, out.height);
    ctx.rotate(Math.PI);
  } else if (turns === 3) {
    ctx.translate(0, out.height);
    ctx.rotate(-Math.PI / 2);
  }
  ctx.drawImage(source, 0, 0, sw, sh);
  ctx.restore();
  return out;
}

async function renderImageFileToCanvas(file, maxSidePx = IMAGE_MAX_SIDE_PX) {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error(IMAGE_FALLBACK_MESSAGE));
      el.src = objectUrl;
    });

    if (!img.naturalWidth || !img.naturalHeight) {
      throw new Error(IMAGE_FALLBACK_MESSAGE);
    }

    const { width, height } = fitDimensionsWithinLimits(
      img.naturalWidth,
      img.naturalHeight,
      maxSidePx
    );

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    return canvas;
  } catch {
    throw new Error(IMAGE_FALLBACK_MESSAGE);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function renderPdfFirstPageToCanvas(file) {
  let loadingTask = null;
  let timeoutId = null;

  const workPromise = (async () => {
    const pdfjs = await loadPdfJs();
    const buffer = await file.arrayBuffer();
    const wasmUrl = new URL('../vendor/wasm/', import.meta.url).href;
    const iccUrl = new URL('../vendor/iccs/', import.meta.url).href;

    loadingTask = pdfjs.getDocument({
      data: new Uint8Array(buffer),
      wasmUrl,
      iccUrl,
      isEvalSupported: false,
      useSystemFonts: true,
    });

    const pdf = await loadingTask.promise;
    const page = await pdf.getPage(1);
    const baseViewport = page.getViewport({ scale: 1 });
    const maxBaseSide = Math.max(1, baseViewport.width, baseViewport.height);

    let scale = Math.min(4, PDF_TARGET_SIDE_PX / maxBaseSide);
    const estPixels = baseViewport.width * scale * (baseViewport.height * scale);
    if (estPixels > MAX_IOS_CANVAS_PIXELS) {
      scale *= Math.sqrt(MAX_IOS_CANVAS_PIXELS / estPixels);
    }

    const viewport = page.getViewport({ scale });
    const width = Math.max(1, Math.floor(viewport.width));
    const height = Math.max(1, Math.floor(viewport.height));

    if (width * height > 16_000_000) {
      throw new Error(PDF_FALLBACK_MESSAGE);
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);

    await page.render({ canvasContext: ctx, viewport }).promise;

    if (isCanvasBlankWhite(ctx, width, height)) {
      throw new Error(PDF_FALLBACK_MESSAGE);
    }

    return canvas;
  })();

  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(PDF_FALLBACK_MESSAGE));
    }, PDF_TIMEOUT_MS);
  });

  try {
    return await Promise.race([workPromise, timeoutPromise]);
  } catch {
    throw new Error(PDF_FALLBACK_MESSAGE);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    if (loadingTask && typeof loadingTask.destroy === 'function') {
      loadingTask.destroy().catch(() => {});
    }
  }
}

/**
 * Открывает файл плана квартиры (JPG, PNG, WebP или PDF) и возвращает { canvas, width, height, title }.
 */
export async function loadPlanFromFile(file) {
  if (!file) {
    throw new Error('Выберите файл плана квартиры.');
  }

  const isPdf =
    file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');

  const canvas = isPdf
    ? await renderPdfFirstPageToCanvas(file)
    : await renderImageFileToCanvas(file, IMAGE_MAX_SIDE_PX);

  return {
    canvas,
    width: canvas.width,
    height: canvas.height,
    title: file.name || 'План квартиры',
  };
}

/**
 * Открывает скриншот спутниковой карты (JPG, PNG, WebP) и возвращает { canvas, width, height, title }.
 */
export async function loadSatelliteFromFile(file) {
  if (!file) {
    throw new Error('Выберите скриншот со спутника.');
  }
  const isPdf =
    file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
  if (isPdf) {
    throw new Error('Для спутникового снимка загрузите скриншот (JPG или PNG).');
  }
  const canvas = await renderImageFileToCanvas(file, SAT_MAX_SIDE_PX);
  return {
    canvas,
    width: canvas.width,
    height: canvas.height,
    title: file.name || 'Снимок со спутника',
  };
}
