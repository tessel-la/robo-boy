#!/bin/bash

# Make sure public directory exists
mkdir -p public/images

# Source logo path
SOURCE_LOGO="images/logo.png"

# Generate favicon and standard icon sizes
SIZES=(16 32 48 64 72 96 128 144 152 180 192 384 512)

for SIZE in "${SIZES[@]}"; do
  if [ $SIZE -eq 180 ]; then
    # Special name for Apple touch icon
    convert "$SOURCE_LOGO" -resize ${SIZE}x${SIZE} public/images/apple-touch-icon.png
    echo "Generated apple-touch-icon.png (${SIZE}x${SIZE})"
  elif [ $SIZE -eq 192 ]; then
    # Special name for PWA 192x192
    convert "$SOURCE_LOGO" -resize ${SIZE}x${SIZE} public/images/pwa-192x192.png
    echo "Generated pwa-192x192.png"
  elif [ $SIZE -eq 512 ]; then
    # Special name for PWA 512x512
    convert "$SOURCE_LOGO" -resize ${SIZE}x${SIZE} public/images/pwa-512x512.png
    echo "Generated pwa-512x512.png"
  elif [ $SIZE -le 64 ]; then
    # Favicon format for smaller sizes
    convert "$SOURCE_LOGO" -resize ${SIZE}x${SIZE} public/images/favicon-${SIZE}x${SIZE}.png
    echo "Generated favicon-${SIZE}x${SIZE}.png"
  else
    # Standard icon format for larger sizes
    convert "$SOURCE_LOGO" -resize ${SIZE}x${SIZE} public/images/icon-${SIZE}x${SIZE}.png
    echo "Generated icon-${SIZE}x${SIZE}.png"
  fi
done

# Create maskable icon with padding (for Android)
# 10% padding on all sides
SIZE=512
PADDING_PERCENT=10
INNER_SIZE=$((SIZE * (100 - 2*PADDING_PERCENT) / 100))
PADDING=$((SIZE * PADDING_PERCENT / 100))

convert "$SOURCE_LOGO" -resize ${INNER_SIZE}x${INNER_SIZE} \
  -background none -gravity center -extent ${SIZE}x${SIZE} \
  public/images/maskable-icon-512x512.png
echo "Generated maskable-icon-512x512.png"

# Copy original logo to public directory
cp "$SOURCE_LOGO" public/images/logo.png
echo "Copied original logo to public/images/"

# Create a multi-size favicon.ico file (optional but useful)
convert "$SOURCE_LOGO" -resize 16x16 -resize 32x32 -resize 48x48 -gravity center \
  -background none -define icon:auto-resize=16,32,48 public/favicon.ico
echo "Generated favicon.ico with multiple sizes"

echo "All icons generated successfully!" 