# PowerShell script to generate PWA icons

# Create necessary directories
New-Item -ItemType Directory -Force -Path "public\images"

# Function to check if ImageMagick is installed
function Check-ImageMagick {
    try {
        $null = Get-Command magick -ErrorAction Stop
        return $true
    } catch {
        Write-Warning "ImageMagick not found. Please install it from https://imagemagick.org/"
        Write-Warning "Alternatively, you can manually resize the logo.png using an image editor."
        return $false
    }
}

# Source logo path
$sourceLogo = "images\logo.png"

# Check if logo exists
if (-not (Test-Path $sourceLogo)) {
    Write-Error "Source logo not found at path: $sourceLogo"
    exit 1
}

# Copy original logo to public/images/
Copy-Item $sourceLogo -Destination "public\images\logo.png" -Force
Write-Host "Copied original logo to public\images\"

# Check if ImageMagick is available
$hasImageMagick = Check-ImageMagick

if ($hasImageMagick) {
    # Define icon sizes to generate
    $sizes = @(16, 32, 48, 64, 72, 96, 128, 144, 152, 180, 192, 384, 512)

    foreach ($size in $sizes) {
        if ($size -eq 180) {
            # Special name for Apple touch icon
            magick convert "$sourceLogo" -resize ${size}x${size} "public\images\apple-touch-icon.png"
            Write-Host "Generated apple-touch-icon.png (${size}x${size})"
        } elseif ($size -eq 192) {
            # Special name for PWA 192x192
            magick convert "$sourceLogo" -resize ${size}x${size} "public\images\pwa-192x192.png"
            Write-Host "Generated pwa-192x192.png"
        } elseif ($size -eq 512) {
            # Special name for PWA 512x512
            magick convert "$sourceLogo" -resize ${size}x${size} "public\images\pwa-512x512.png"
            Write-Host "Generated pwa-512x512.png"
        } elseif ($size -le 64) {
            # Favicon format for smaller sizes
            magick convert "$sourceLogo" -resize ${size}x${size} "public\images\favicon-${size}x${size}.png"
            Write-Host "Generated favicon-${size}x${size}.png"
        } else {
            # Standard icon format for larger sizes
            magick convert "$sourceLogo" -resize ${size}x${size} "public\images\icon-${size}x${size}.png"
            Write-Host "Generated icon-${size}x${size}.png"
        }
    }

    # Create maskable icon with padding (for Android)
    # 10% padding on all sides
    $size = 512
    $paddingPercent = 10
    $innerSize = [int]($size * (100 - 2*$paddingPercent) / 100)

    magick convert "$sourceLogo" -resize ${innerSize}x${innerSize} `
        -background none -gravity center -extent ${size}x${size} `
        "public\images\maskable-icon-512x512.png"
    Write-Host "Generated maskable-icon-512x512.png"

    # Create a multi-size favicon.ico file
    magick convert "$sourceLogo" -resize 16x16 -resize 32x32 -resize 48x48 -gravity center `
        -background none -define icon:auto-resize=16,32,48 "public\favicon.ico"
    Write-Host "Generated favicon.ico with multiple sizes"

    Write-Host "All icons generated successfully!"
} else {
    Write-Host "Please install ImageMagick to generate all icons automatically,"
    Write-Host "or manually create the required icon sizes using your preferred image editor."
    Write-Host "Required icon sizes are listed in the manifest.webmanifest file."
} 