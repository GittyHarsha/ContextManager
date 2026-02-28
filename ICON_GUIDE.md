# ContextManager Extension Icon

## Icon Requirements

For VS Code Marketplace, the extension needs:
- **Filename**: `icon.png`
- **Size**: 128x128 pixels (minimum), recommended 256x256 or 512x512
- **Format**: PNG with transparency
- **Theme**: Should work well on both light and dark backgrounds

## Design Concept

The icon should represent:
- **Book/Knowledge**: A book or stack of books (primary element)
- **AI/Automation**: Subtle sparkle, circuit, or brain element
- **Context/Organization**: Layers, folders, or connected nodes

### Suggested Design

**Primary Element**: An open book icon in the center
**Accent**: Small sparkle/star in the top-right corner
**Color Scheme**: 
- Primary: Blue (#007ACC - VS Code blue) or Purple (#9B4DCA)
- Accent: Gold/Yellow (#FFC83D) for the sparkle
- Background: Transparent or subtle gradient

## How to Create the Icon

### Option 1: Using Figma (Recommended)
1. Create a new 512x512px canvas
2. Draw an open book shape (simplified, recognizable at small sizes)
3. Add a small sparkle/star icon in the top-right
4. Use the color scheme above
5. Export as PNG at 512x512

### Option 2: Using Canva
1. Create a 512x512px design
2. Search for "book icon" in elements
3. Customize colors to match the scheme
4. Add a star/sparkle shape
5. Download as PNG with transparent background

### Option 3: Using an Icon Generator
1. Visit https://icon.kitchen/ or similar
2. Upload a book + sparkle SVG or emoji
3. Generate at 512x512
4. Download and save as `icon.png`

### Option 4: Use SVG and Convert

Create an SVG file first (see icon-template.svg below), then convert to PNG:

```bash
# Using ImageMagick
convert -background none -size 512x512 icon.svg icon.png

# Using Inkscape
inkscape icon.svg --export-png=icon.png --export-width=512 --export-height=512
```

## SVG Template

Save this as `icon-template.svg`:

```svg
<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <!-- Background circle -->
  <circle cx="256" cy="256" r="230" fill="#007ACC" opacity="0.9"/>
  
  <!-- Open book -->
  <path d="M 156 200 L 156 360 L 256 340 L 256 180 Z" fill="#FFFFFF" opacity="0.95"/>
  <path d="M 256 180 L 256 340 L 356 360 L 356 200 Z" fill="#FFFFFF" opacity="0.85"/>
  <path d="M 156 200 Q 206 180 256 180 Q 306 180 356 200" stroke="#FFFFFF" stroke-width="3" fill="none"/>
  
  <!-- Center line -->
  <line x1="256" y1="180" x2="256" y2="340" stroke="#007ACC" stroke-width="4"/>
  
  <!-- Sparkle/AI indicator -->
  <circle cx="380" cy="140" r="30" fill="#FFC83D"/>
  <path d="M 380 110 L 380 170 M 350 140 L 410 140" stroke="#FFFFFF" stroke-width="8" stroke-linecap="round"/>
  <path d="M 360 120 L 400 160 M 400 120 L 360 160" stroke="#FFFFFF" stroke-width="6" stroke-linecap="round"/>
</svg>
```

## Testing the Icon

After creating the icon:
1. Save as `icon.png` in the root of the extension folder
2. The `package.json` already references `icon.png`
3. Reload VS Code extension development host to see the icon in:
   - Extension marketplace view
   - Extension sidebar
   - Command palette extension commands

## Icon Guidelines

✅ **DO:**
- Keep it simple and recognizable at small sizes
- Use high contrast for visibility
- Test on both light and dark backgrounds
- Use consistent stroke weights
- Center the main element

❌ **DON'T:**
- Use gradients that make text hard to read
- Add too many details (won't be visible at small sizes)
- Use very thin lines (< 2px at 128x128size)
- Copy other extension icons
- Use copyrighted imagery

## Placeholder

Until a proper icon is created, you can use a simple colored square or the VS Code book icon as a temporary placeholder.

For a quick placeholder, you can use an emoji-to-PNG service:
1. Go to https://emoji.aranja.com/
2. Search for "📚" (books emoji) or "🤖📖" (robot + book)
3. Download at 512x512
4. Save as `icon.png`

---

**Note**: Once you have the `icon.png` file, place it in the root directory of the extension (same level as `package.json`).
