const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const pngToIco = require('png-to-ico');

const root = path.resolve(__dirname, '..');
const publicPath = path.join(root, 'public');
const desktopPath = path.join(root, 'src-tauri/icons');
const source = path.join(root, 'images/logo.png');
// Apple's macOS template radius (185.4 of 824), used for every rounded icon so the corners match
// the platforms that round icons themselves.
const CORNER = 0.225;

async function syncAndroidIcons() {
  // Tauri generates these icons once during init; builds otherwise keep stale template artwork.
  const destination = path.join(root, 'src-tauri/gen/android/app/src/main/res');
  await fs.cp(path.join(root, 'src-tauri/icons/android'), destination, { recursive: true });
}

// The artwork with transparent rounded corners, optionally inset in a transparent canvas.
async function rounded(size, inset = 0) {
  const body = size - inset * 2;
  const mask = `<svg xmlns="http://www.w3.org/2000/svg" width="${body}" height="${body}">
    <rect width="${body}" height="${body}" rx="${body * CORNER}"/></svg>`;
  const shape = await sharp(source)
    .resize(body, body)
    .composite([{ input: Buffer.from(mask), blend: 'dest-in' }])
    .png()
    .toBuffer();
  return sharp(shape)
    .extend({ top: inset, bottom: inset, left: inset, right: inset, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

// An .icns made of PNG entries, which macOS has read since 10.7.
async function icns() {
  const types = { icp4: 16, icp5: 32, ic11: 32, ic12: 64, ic07: 128, ic13: 256, ic08: 256, ic14: 512, ic09: 512, ic10: 1024 };
  const entries = await Promise.all(
    Object.entries(types).map(async ([type, size]) => {
      // macOS draws app icons as given; its template insets the rounded body 100 units in 1024.
      const png = await rounded(size, Math.round((size * 100) / 1024));
      const header = Buffer.alloc(8);
      header.write(type, 0, 'ascii');
      header.writeUInt32BE(png.length + 8, 4);
      return Buffer.concat([header, png]);
    })
  );
  const header = Buffer.alloc(8);
  header.write('icns', 0, 'ascii');
  header.writeUInt32BE(8 + entries.reduce((total, entry) => total + entry.length, 0), 4);
  return Buffer.concat([header, ...entries]);
}

async function generateIcons() {
  const manifest = JSON.parse(await fs.readFile(path.join(publicPath, 'manifest.webmanifest'), 'utf8'));
  const icons = new Map(manifest.icons.map(icon => [icon.src, icon]));
  for (const icon of icons.values()) {
    const [width, height] = icon.sizes.split('x').map(Number);
    const destination = path.join(publicPath, icon.src.replace(/^\//, ''));
    if (icon.purpose?.includes('maskable')) {
      // Keep the mark inside the mask's central safe circle, with an opaque background.
      const inset = Math.ceil(width * 0.2);
      await sharp(source)
        .resize(width - inset * 2, height - inset * 2, { fit: 'contain' })
        .extend({ top: inset, bottom: inset, left: inset, right: inset, background: '#fff8cc' })
        .png()
        .toFile(destination);
    } else if (/apple|ios/.test(icon.src)) {
      // iOS rounds touch icons itself and fills transparent pixels with black, so they stay square.
      await sharp(source).resize(width, height).png().toFile(destination);
    } else {
      // Browsers and desktop systems show these as drawn.
      await fs.writeFile(destination, await rounded(width));
    }
  }
  await fs.writeFile(path.join(publicPath, 'favicon.ico'), await pngToIco(await rounded(256)));
  await fs.copyFile(source, path.join(publicPath, 'images/logo.png'));

  // Linux and Windows desktop builds (Tauri and Electron) show these as drawn too. The iOS and
  // Android sets stay square: those launchers apply their own mask.
  for (const [name, size] of [
    ['32x32.png', 32],
    ['64x64.png', 64],
    ['128x128.png', 128],
    ['128x128@2x.png', 256],
    ['icon.png', 512],
  ])
    await fs.writeFile(path.join(desktopPath, name), await rounded(size));
  await fs.writeFile(path.join(desktopPath, 'icon.ico'), await pngToIco(await rounded(256)));
  await fs.writeFile(path.join(desktopPath, 'icon.icns'), await icns());
  console.log(`Generated ${icons.size} web icons, favicon.ico and the desktop icons from images/logo.png.`);
}

(async () => {
  if (process.argv.includes('--android')) await syncAndroidIcons();
  else await generateIcons();
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
