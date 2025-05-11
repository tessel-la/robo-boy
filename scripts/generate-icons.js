const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

// Ensure directories exist
const publicPath = path.join(__dirname, '../public');
const imagesPath = path.join(publicPath, 'images');

if (!fs.existsSync(publicPath)) {
  fs.mkdirSync(publicPath, { recursive: true });
}
if (!fs.existsSync(imagesPath)) {
  fs.mkdirSync(imagesPath, { recursive: true });
}

// Source logo path
const logoPath = path.join(__dirname, '../images/logo.png');

// Define icon sizes to generate
const sizes = [
  { width: 16, height: 16, name: 'favicon-16x16.png' },
  { width: 32, height: 32, name: 'favicon-32x32.png' },
  { width: 48, height: 48, name: 'favicon-48x48.png' },
  { width: 64, height: 64, name: 'favicon-64x64.png' },
  { width: 72, height: 72, name: 'icon-72x72.png' },
  { width: 96, height: 96, name: 'icon-96x96.png' },
  { width: 128, height: 128, name: 'icon-128x128.png' },
  { width: 144, height: 144, name: 'icon-144x144.png' },
  { width: 152, height: 152, name: 'icon-152x152.png' },
  { width: 192, height: 192, name: 'pwa-192x192.png' },
  { width: 384, height: 384, name: 'icon-384x384.png' },
  { width: 512, height: 512, name: 'pwa-512x512.png' },
  // Apple specific sizes
  { width: 180, height: 180, name: 'apple-touch-icon.png' },
  // Create a maskable icon (same size with transparent padding for safe area)
  { width: 512, height: 512, name: 'maskable-icon-512x512.png', maskable: true }
];

// Generate icons in different sizes
async function generateIcons() {
  try {
    // Load the source image
    const image = sharp(logoPath);
    
    // Generate each size
    for (const size of sizes) {
      const outputPath = path.join(imagesPath, size.name);
      let processedImage = image.clone().resize(size.width, size.height);
      
      // If it's a maskable icon, add padding (10% on each side)
      if (size.maskable) {
        const paddingPercent = 0.1; // 10% padding
        const actualSize = Math.floor(size.width * (1 - paddingPercent * 2)); // Size after padding
        
        processedImage = image.clone()
          .resize(actualSize, actualSize)
          .extend({
            top: Math.floor(size.height * paddingPercent),
            bottom: Math.floor(size.height * paddingPercent),
            left: Math.floor(size.width * paddingPercent),
            right: Math.floor(size.width * paddingPercent),
            background: { r: 255, g: 255, b: 255, alpha: 0 } // Transparent padding
          });
      }
      
      await processedImage.toFile(outputPath);
      console.log(`Generated ${size.name}`);
    }
    
    // Also copy the original file to public/images
    await sharp(logoPath).toFile(path.join(imagesPath, 'logo.png'));
    console.log('Copied original logo to public/images');
    
    console.log('All icons generated successfully!');
  } catch (err) {
    console.error('Error generating icons:', err);
  }
}

generateIcons(); 