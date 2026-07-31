PII Sanitizer Extension - Icon Design
=====================================

The extension needs icons in three sizes:
- icon16.png (16x16)
- icon48.png (48x48)
- icon128.png (128x128)

To create simple icons, you can:

1. **Use an online tool**: 
   - https://www.favicon-generator.org/
   - https://www.icoconverter.com/

2. **Create with ImageMagick** (if installed):
   ```bash
   # Create a simple shield icon
   convert -size 128x128 xc:#4CAF50 -fill white \
     -draw "circle 64,64 64,30" \
     -fill white -font Arial-Bold -pointsize 48 \
     -gravity center -annotate +0+0 'P' \
     icon128.png
   
   convert -resize 48x48 icon128.png icon48.png
   convert -resize 16x16 icon128.png icon16.png
   ```

3. **Use macOS Preview**: 
   - Create a simple 128x128 PNG in any editor
   - Duplicate and resize to 48x48 and 16x16

4. **Use a favicon generator with text**:
   - Search for "create favicon with text"
   - Use "P" or "🛡️" as the icon symbol
   - Download in all three sizes

The icons directory is ready for you to add these files.