const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const pngToIco = require('png-to-ico');

const root = path.resolve(__dirname, '..');
const publicPath = path.join(root, 'public');
const source = path.join(root, 'images/logo.png');

async function syncAndroidIcons() {
  // Tauri generates these icons once during init; builds otherwise keep stale template artwork.
  const destination = path.join(root, 'src-tauri/gen/android/app/src/main/res');
  await fs.cp(path.join(root, 'src-tauri/icons/android'), destination, { recursive: true });
}

async function generateIcons() {
  const manifest = JSON.parse(await fs.readFile(path.join(publicPath, 'manifest.webmanifest'), 'utf8'));
  const icons = new Map(manifest.icons.map(icon => [icon.src, icon]));
  for (const icon of icons.values()) {
    const [width, height] = icon.sizes.split('x').map(Number);
    // Keep the mark inside the mask's central safe circle, with an opaque background.
    const inset = icon.purpose?.includes('maskable') ? Math.ceil(width * 0.2) : 0;
    await sharp(source)
      .resize(width - inset * 2, height - inset * 2, { fit: 'contain' })
      .extend({ top: inset, bottom: inset, left: inset, right: inset, background: '#fff8cc' })
      .png()
      .toFile(path.join(publicPath, icon.src.replace(/^\//, '')));
  }
  await fs.writeFile(
    path.join(publicPath, 'favicon.ico'),
    await pngToIco(await sharp(source).resize(256, 256).png().toBuffer())
  );
  await fs.copyFile(source, path.join(publicPath, 'images/logo.png'));
  console.log(`Generated ${icons.size} web icons and favicon.ico from images/logo.png.`);
}

(async () => {
  if (process.argv.includes('--android')) await syncAndroidIcons();
  else await generateIcons();
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
