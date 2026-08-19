import pngToIco from 'png-to-ico';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_LOGO = '';

async function generateIcons(logoPath) {
  logoPath = logoPath || DEFAULT_LOGO;

  if (!fs.existsSync(logoPath)) {
    console.error('Source image not found:', logoPath);
    process.exit(1);
  }

  const buildDir = path.join(__dirname, '..', 'build');
  const iconsDir = path.join(buildDir, 'icons');

  console.log('Generating icons from:', logoPath);
  console.log('');

  if (!fs.existsSync(iconsDir)) {
    fs.mkdirSync(iconsDir, { recursive: true });
  }

  const metadata = await sharp(logoPath).metadata();
  console.log(`Source image: ${metadata.width}x${metadata.height}`);
  console.log('');

  try {
    const icoBuffer = await pngToIco(logoPath, {
      sizes: [16, 24, 32, 48, 64, 128, 256]
    });
    const icoPath = path.join(buildDir, 'icon.ico');
    fs.writeFileSync(icoPath, icoBuffer);
    console.log('  ✓ build/icon.ico (Windows)');
  } catch (err) {
    console.error('Error creating .ico:', err.message);
  }

  const sizes = [
    { size: 16,   name: 'icon_16x16.png' },
    { size: 32,   name: 'icon_16x16@2x.png' },
    { size: 32,   name: 'icon_32x32.png' },
    { size: 64,   name: 'icon_32x32@2x.png' },
    { size: 128,  name: 'icon_128x128.png' },
    { size: 256,  name: 'icon_128x128@2x.png' },
    { size: 256,  name: 'icon_256x256.png' },
    { size: 512,  name: 'icon_256x256@2x.png' },
    { size: 512,  name: 'icon_512x512.png' },
    { size: 1024, name: 'icon_512x512@2x.png' },
  ];

  console.log('');
  console.log('Generating PNG icons:');

  for (const { size, name } of sizes) {
    const outputPath = path.join(iconsDir, name);
    await sharp(logoPath)
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(outputPath);
    console.log(`  ✓ ${name} (${size}x${size})`);
  }

  const publicIcon = path.join(__dirname, '..', 'public', 'icon.png');
  await sharp(logoPath).resize(256, 256).png().toFile(publicIcon);
  console.log('');
  console.log('  ✓ public/icon.png (256x256)');

  console.log('');
  console.log('========================================');
  console.log('All icons generated successfully!');
  console.log('========================================');
  console.log('');
  console.log('Windows:  build/icon.ico');
  console.log('Linux:    build/icons/');
  console.log('macOS:    build/icon.icns (electron-builder auto-generates from icons/)');
  console.log('');
  console.log('Note: build/icon.iconset/ is no longer needed and can be deleted.');
}

const logoArg = process.argv[2];
generateIcons(logoArg).catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
