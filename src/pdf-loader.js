/**
 * Чтение планов квартир из локальных файлов устройства (JPG, PNG, WebP и PDF — 1-я страница).
 * Всё выполняется в браузере без отправки на сервер и без обращения к внешним CDN.
 */

let pdfjsPromise = null;

async function loadPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('../vendor/pdf.min.mjs').then((mod) => {
      const workerUrl = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;
      mod.GlobalWorkerOptions.workerSrc = workerUrl;
      return mod;
    });
  }
  return pdfjsPromise;
}

/**
 * Поворачивает исходный Canvas/Image кратно 90° и возвращает новый Canvas.
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

async function renderImageFileToCanvas(file) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Не удалось прочитать файл изображения.'));
    reader.readAsDataURL(file);
  });

  const img = await new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () =>
      reject(new Error('Формат изображения не поддерживается браузером. Попробуйте PNG или JPG.'));
    el.src = dataUrl;
  });

  // Ограничиваем максимальную сторону до 3200 px для плавной работы на телефоне
  const maxSide = 3200;
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  return canvas;
}

async function renderPdfFirstPageToCanvas(file) {
  const pdfjs = await loadPdfJs();
  const buffer = await file.arrayBuffer();
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    useSystemFonts: true,
  });

  const pdf = await loadingTask.promise;
  const page = await pdf.getPage(1);
  const baseViewport = page.getViewport({ scale: 1 });
  const targetMaxSide = 2400;
  const scale = Math.min(
    3,
    Math.max(1.2, targetMaxSide / Math.max(baseViewport.width, baseViewport.height))
  );
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

/**
 * Принимает File (JPG, PNG, WebP или PDF) и возвращает { canvas, width, height, title }.
 */
export async function loadPlanFromFile(file) {
  if (!file) {
    throw new Error('Файл не выбран.');
  }

  const isPdf =
    file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');

  const canvas = isPdf
    ? await renderPdfFirstPageToCanvas(file)
    : await renderImageFileToCanvas(file);

  return {
    canvas,
    width: canvas.width,
    height: canvas.height,
    title: file.name || 'Загруженный план',
  };
}
