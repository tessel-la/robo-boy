const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const toIco = require('to-ico');

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
const logoPath = path.join(__dirname, '../images/logo_rb.jpg');

// Define comprehensive icon sizes for all platforms and devices
const sizes = [
  // Favicons
  { width: 16, height: 16, name: 'favicon-16x16.png' },
  { width: 32, height: 32, name: 'favicon-32x32.png' },
  { width: 48, height: 48, name: 'favicon-48x48.png' },
  { width: 64, height: 64, name: 'favicon-64x64.png' },
  
  // Android Chrome icons
  { width: 36, height: 36, name: 'icon-36x36.png' },
  { width: 48, height: 48, name: 'icon-48x48.png' },
  { width: 72, height: 72, name: 'icon-72x72.png' },
  { width: 96, height: 96, name: 'icon-96x96.png' },
  { width: 128, height: 128, name: 'icon-128x128.png' },
  { width: 144, height: 144, name: 'icon-144x144.png' },
  { width: 152, height: 152, name: 'icon-152x152.png' },
  { width: 192, height: 192, name: 'icon-192x192.png' },
  { width: 384, height: 384, name: 'icon-384x384.png' },
  { width: 512, height: 512, name: 'icon-512x512.png' },
  
  // PWA standard sizes
  { width: 192, height: 192, name: 'pwa-192x192.png' },
  { width: 512, height: 512, name: 'pwa-512x512.png' },
  
  // Apple iOS icons (comprehensive list for all devices including iPhone 12 mini)
  { width: 57, height: 57, name: 'apple-icon-57x57.png' },
  { width: 60, height: 60, name: 'apple-icon-60x60.png' },
  { width: 72, height: 72, name: 'apple-icon-72x72.png' },
  { width: 76, height: 76, name: 'apple-icon-76x76.png' },
  { width: 114, height: 114, name: 'apple-icon-114x114.png' },
  { width: 120, height: 120, name: 'apple-icon-120x120.png' },
  { width: 144, height: 144, name: 'apple-icon-144x144.png' },
  { width: 152, height: 152, name: 'apple-icon-152x152.png' },
  { width: 167, height: 167, name: 'apple-icon-167x167.png' },
  { width: 180, height: 180, name: 'apple-touch-icon.png' },
  { width: 180, height: 180, name: 'apple-icon-180x180.png' },
  
  // iOS-specific duplicates for compatibility
  { width: 180, height: 180, name: 'ios-apple-touch-icon.png' },
  { width: 57, height: 57, name: 'ios-mini-touch-icon.png' },
  
  // Windows tiles
  { width: 70, height: 70, name: 'ms-icon-70x70.png' },
  { width: 150, height: 150, name: 'ms-icon-150x150.png' },
  { width: 310, height: 310, name: 'ms-icon-310x310.png' },
  
  // Maskable icons (with proper safe zone - 20% padding for better compatibility)
  { width: 192, height: 192, name: 'maskable-icon-192x192.png', maskable: true },
  { width: 512, height: 512, name: 'maskable-icon-512x512.png', maskable: true },
  
  // Additional large sizes for high-DPI displays
  { width: 256, height: 256, name: 'icon-256x256.png' },
  { width: 1024, height: 1024, name: 'icon-1024x1024.png' },
  
  // Apple launch/splash screen icons (square versions)
  { width: 1024, height: 1024, name: 'apple-launch-icon-1024x1024.png' },
  { width: 2048, height: 2048, name: 'apple-launch-icon-2048x2048.png' }
];

// Generate icons in different sizes
async function generateIcons() {
  try {
    console.log('Starting icon generation...');
    
    // Load the source image and get its metadata
    const image = sharp(logoPath);
    const metadata = await image.metadata();
    console.log(`Source image: ${metadata.width}x${metadata.height}, format: ${metadata.format}`);
    
    // Generate each size
    for (const size of sizes) {
      const outputPath = path.join(imagesPath, size.name);
      let processedImage = image.clone();
      
      // If it's a maskable icon, add padding for safe zone
      if (size.maskable) {
        // Use 20% padding (10% on each side) for better safe zone compliance
        const paddingPercent = 0.1;
        const actualSize = Math.floor(size.width * (1 - paddingPercent * 2));
        const padding = Math.floor(size.width * paddingPercent);
        
        processedImage = image.clone()
          .resize(actualSize, actualSize, {
            fit: 'contain',
            background: { r: 0, g: 0, b: 0, alpha: 0 }
          })
          .extend({
            top: padding,
            bottom: padding,
            left: padding,
            right: padding,
            background: { r: 0, g: 0, b: 0, alpha: 0 } // Transparent padding
          });
      } else {
        // Regular icon - resize with contain to preserve aspect ratio
        processedImage = processedImage.resize(size.width, size.height, {
          fit: 'contain',
          background: { r: 0, g: 0, b: 0, alpha: 0 } // Transparent background
        });
      }
      
      await processedImage.png().toFile(outputPath);
      console.log(`Generated ${size.name} (${size.width}x${size.height})`);
    }

    // Generate favicon.ico with multiple sizes
    console.log('Generating favicon.ico...');
    const icoSizes = [16, 32, 48, 64];
    const icoBuffers = await Promise.all(
      icoSizes.map(size =>
        sharp(logoPath)
          .resize(size, size, {
            fit: 'contain',
            background: { r: 0, g: 0, b: 0, alpha: 0 }
          })
          .png()
          .toBuffer()
      )
    );
    const icoBuffer = await toIco(icoBuffers);
    fs.writeFileSync(path.join(publicPath, 'favicon.ico'), icoBuffer);
    console.log('Generated favicon.ico');
    
    // Copy the original logo to public/images as logo.png
    await sharp(logoPath)
      .png()
      .toFile(path.join(imagesPath, 'logo.png'));
    console.log('Copied original logo to public/images/logo.png');
    
    // Generate Apple launch screen backgrounds (if needed)
    const launchScreenSizes = [
      { width: 1125, height: 2436, name: 'apple-launch-1125x2436.png' },
      { width: 1242, height: 2688, name: 'apple-launch-1242x2688.png' },
      { width: 2732, height: 2732, name: 'apple-launch-2732x2732.png' }
    ];
    
    console.log('Generating Apple launch screens...');
    for (const launch of launchScreenSizes) {
      const outputPath = path.join(imagesPath, launch.name);
      
             // Create a centered logo on a colored background for launch screens
       await sharp({
         create: {
           width: launch.width,
           height: launch.height,
           channels: 4,
           background: { r: 40, g: 44, b: 52, alpha: 1 } // Match your theme color
         }
       })
       .composite([{
         input: await sharp(logoPath)
           .resize(Math.floor(Math.min(launch.width * 0.3, launch.height * 0.3)), null, {
             fit: 'inside',
             withoutEnlargement: true
           })
           .png()
           .toBuffer(),
         gravity: 'center'
       }])
      .png()
      .toFile(outputPath);
      
      console.log(`Generated ${launch.name}`);
    }
    
    console.log('\n✅ All icons generated successfully!');
    console.log(`📱 Total icons created: ${sizes.length + icoSizes.length + launchScreenSizes.length + 1}`);
    console.log('🔍 Icons include support for:');
    console.log('   - All iOS devices (including iPhone 12 mini, Pro, Max)');
    console.log('   - Android devices (all DPI ranges)');
    console.log('   - Windows PWA tiles');
    console.log('   - Maskable icons with proper safe zones');
    console.log('   - High-DPI displays');
    console.log('   - Apple launch screens');
    
  } catch (err) {
    console.error('❌ Error generating icons:', err);
    process.exit(1);
  }
}

generateIcons(); 