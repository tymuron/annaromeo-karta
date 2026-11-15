import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  ensureDir(dest);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// 1. Copy local fonts (Cormorant & Manrope, Cyrillic + Latin, WOFF2)
const fontsOutDir = path.join(__dirname, 'assets', 'fonts');
ensureDir(fontsOutDir);

const fontPackages = [
  {
    pkg: '@fontsource/cormorant',
    cssFiles: ['400.css', '400-italic.css', '500.css', '600.css'],
  },
  {
    pkg: '@fontsource/manrope',
    cssFiles: ['400.css', '500.css', '600.css'],
  },
];

const allowedSubsets = ['cyrillic-ext', 'cyrillic', 'latin-ext', 'latin'];
const cssBlocks = [
  '/* Локальные шрифты бренда Анны Ромео (Cormorant и Manrope). Без внешних CDN. */',
];

for (const { pkg, cssFiles } of fontPackages) {
  const pkgDir = path.join(__dirname, 'node_modules', pkg);
  for (const cssFile of cssFiles) {
    const rawCss = fs.readFileSync(path.join(pkgDir, cssFile), 'utf8');
    const blocks = rawCss.split(/(?=\/\*\s*[a-z0-9-]+\s*\*\/)/g);
    for (const block of blocks) {
      const commentMatch = block.match(/\/\*\s*([a-z0-9-]+)\s*\*\//);
      if (!commentMatch) continue;
      const tag = commentMatch[1];
      const matchesSubset = allowedSubsets.some((sub) => {
        const idx = tag.indexOf(`-${sub}-`);
        return idx !== -1;
      });
      if (!matchesSubset) continue;

      const woff2Match = block.match(/\.\/files\/([a-z0-9.-]+\.woff2)/);
      if (!woff2Match) continue;
      const fileName = woff2Match[1];
      fs.copyFileSync(
        path.join(pkgDir, 'files', fileName),
        path.join(fontsOutDir, fileName)
      );

      const cleanedBlock = block
        .replace(
          /src:\s*url\([^)]+\)\s*format\('woff2'\)[^;]*;/,
          `src: url('../assets/fonts/${fileName}') format('woff2');`
        )
        .trim();
      cssBlocks.push(cleanedBlock);
    }
  }
}

ensureDir(path.join(__dirname, 'styles'));
fs.writeFileSync(
  path.join(__dirname, 'styles', 'fonts.css'),
  cssBlocks.join('\n\n') + '\n',
  'utf8'
);

// 2. Copy local PDF.js legacy build + WASM decoders (for iOS < 17.4 & BTI CCITT/JBIG2/JPX scans)
const vendorDir = path.join(__dirname, 'vendor');
fs.rmSync(vendorDir, { recursive: true, force: true });
ensureDir(vendorDir);

const pdfLegacyBuildDir = path.join(__dirname, 'node_modules', 'pdfjs-dist', 'legacy', 'build');
for (const file of ['pdf.min.mjs', 'pdf.worker.min.mjs']) {
  fs.copyFileSync(path.join(pdfLegacyBuildDir, file), path.join(vendorDir, file));
}

copyDir(
  path.join(__dirname, 'node_modules', 'pdfjs-dist', 'wasm'),
  path.join(vendorDir, 'wasm')
);
copyDir(
  path.join(__dirname, 'node_modules', 'pdfjs-dist', 'iccs'),
  path.join(vendorDir, 'iccs')
);

// 3. Assemble static dist/ directory (for Render Static Site publish directory)
const distDir = path.join(__dirname, 'dist');
fs.rmSync(distDir, { recursive: true, force: true });
ensureDir(distDir);

if (fs.existsSync(path.join(__dirname, 'index.html'))) {
  fs.copyFileSync(
    path.join(__dirname, 'index.html'),
    path.join(distDir, 'index.html')
  );
}
for (const folder of ['styles', 'src', 'assets', 'vendor']) {
  copyDir(path.join(__dirname, folder), path.join(distDir, folder));
}

console.log('Сборка завершена: шрифты, PDF-модуль и папка dist/ готовы.');
