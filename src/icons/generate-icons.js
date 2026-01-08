/**
 * Icon Generator Script for Zendesk KPI Tracker
 *
 * This script generates PNG icons from the SVG source.
 *
 * Prerequisites:
 *   npm install sharp
 *
 * Usage:
 *   node generate-icons.js
 *
 * Or use an online converter:
 *   1. Go to https://convertio.co/svg-png/
 *   2. Upload icon.svg
 *   3. Download and resize to 16x16, 32x32, 48x48, 128x128
 */

const fs = require('fs');
const path = require('path');

// Check if sharp is available
let sharp;
try {
  sharp = require('sharp');
} catch (e) {
  console.log('Sharp not installed. Install with: npm install sharp');
  console.log('Or use the manual method described below.\n');
  createPlaceholderIcons();
  process.exit(0);
}

const sizes = [16, 32, 48, 128];
const svgPath = path.join(__dirname, 'icon.svg');

async function generateIcons() {
  const svgBuffer = fs.readFileSync(svgPath);

  for (const size of sizes) {
    const outputPath = path.join(__dirname, `icon${size}.png`);

    await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toFile(outputPath);

    console.log(`Generated: icon${size}.png`);
  }

  console.log('\nAll icons generated successfully!');
}

function createPlaceholderIcons() {
  console.log('Creating placeholder icons...\n');
  console.log('For best results, convert icon.svg to PNG manually using:');
  console.log('  - https://convertio.co/svg-png/');
  console.log('  - https://svgtopng.com/');
  console.log('  - Figma, Sketch, or any design tool\n');
  console.log('Required sizes: 16x16, 32x32, 48x48, 128x128\n');

  // Create simple placeholder PNGs (1x1 blue pixel, scaled by browser)
  // These are minimal valid PNGs that Chrome will accept
  const placeholderPNG = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
    0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, // IDAT chunk
    0x54, 0x08, 0xd7, 0x63, 0x58, 0xb5, 0xd5, 0x01,
    0x00, 0x02, 0x5e, 0x01, 0x23, 0x46, 0x95, 0xfb,
    0xdb, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, // IEND chunk
    0x44, 0xae, 0x42, 0x60, 0x82
  ]);

  sizes.forEach(size => {
    fs.writeFileSync(path.join(__dirname, `icon${size}.png`), placeholderPNG);
    console.log(`Created placeholder: icon${size}.png`);
  });

  console.log('\nPlaceholder icons created. Replace with proper icons for production.');
}

generateIcons().catch((err) => {
  console.error('Error generating icons:', err);
  createPlaceholderIcons();
});
