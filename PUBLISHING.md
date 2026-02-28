# Publishing ContextManager to VS Code Marketplace

This guide walks you through publishing ContextManager to the Visual Studio Code Marketplace.

## Pre-Publishing Checklist

### ✅ Required Files
- [x] `README.md` - Professional documentation with features, usage, screenshots
- [x] `package.json` - Complete metadata with proper publisher, description, keywords
- [x] `LICENSE` - MIT license included
- [x] `CHANGELOG.md` - Release notes and version history
- [ ] `icon.png` - 128x128 or larger PNG icon (see ICON_GUIDE.md)
- [x] `.vscodeignore` - Optimized to exclude unnecessary files

### ✅ Code Quality
- [x] TypeScript compiles without errors (run `npm run compile`)
- [x] No console errors during activation
- [x] All commands work as expected
- [x] Error handling for edge cases
- [x] Configuration settings implemented
- [ ] Extension tested in clean VS Code installation

### ✅ Documentation
- [x] Clear feature descriptions in README
- [x] Usage examples and screenshots (add screenshots when available)
- [x] Configuration options documented
- [x] Contributing guidelines
- [x] Known issues section

### ✅ Package.json Metadata
- [x] Unique extension name
- [x] Clear display name
- [x] Compelling description
- [x] Relevant categories
- [x] Searchable keywords
- [x] Repository and bug URLs
- [x] License field
- [ ] Publisher name (change from "local-dev" to your publisher ID)
- [ ] Version number (currently 0.1.0)

## Step-by-Step Publishing Guide

### 1. Create Publisher Account

1. Go to [Visual Studio Marketplace](https://marketplace.visualstudio.com/manage)
2. Sign in with Microsoft, GitHub, or Azure DevOps account
3. Create a new publisher:
   - Choose a unique publisher ID (e.g., "yourcompany" or "yourname")
   - Provide display name and description
   - Add verified email addresses

### 2. Get Personal Access Token (PAT)

1. Go to [Azure DevOps](https://dev.azure.com)
2. Click on your profile → Security → Personal Access Tokens
3. Create new token with:
   - **Name**: "VS Code Marketplace"
   - **Organization**: All accessible organizations
   - **Scopes**: **Marketplace** (Manage)
   - **Expiration**: 90 days or custom
4. Copy the token immediately (you won't see it again)

### 3. Install vsce (VS Code Extension Manager)

```bash
npm install -g @vscode/vsce
```

### 4. Update package.json

Before publishing, update these fields in `package.json`:

```json
{
  "name": "context-manager",
  "publisher": "YOUR-PUBLISHER-ID",  // Change this!
  "version": "0.1.0",
  "displayName": "ContextManager - AI Project Assistant",
  "icon": "icon.png",  // Make sure this file exists
  "repository": {
    "type": "git",
    "url": "YOUR-GITHUB-REPO-URL"  // Update if forking
  }
}
```

### 5. Create the Extension Package

```bash
# Navigate to extension directory
cd codebase-navigator

# Compile TypeScript
npm run compile

# Create .vsix package
vsce package

# This creates: context-manager-0.1.0.vsix
```

### 6. Test the Package Locally

```bash
# Install in VS Code
code --install-extension context-manager-0.1.0.vsix

# Or through VS Code UI:
# 1. Open Extensions view (Ctrl+Shift+X)
# 2. Click "..." menu → "Install from VSIX"
# 3. Select your .vsix file
```

Test all features thoroughly in a clean VS Code installation.

### 7. Publish to Marketplace

```bash
# Login with your PAT
vsce login YOUR-PUBLISHER-ID
# Enter your Personal Access Token when prompted

# Publish the extension
vsce publish

# Or increment version and publish in one command:
vsce publish patch  # 0.1.0 → 0.1.1
vsce publish minor  # 0.1.0 → 0.2.0
vsce publish major  # 0.1.0 → 1.0.0
```

### 8. Verify Publication

1. Go to [Marketplace Management](https://marketplace.visualstudio.com/manage)
2. Check your extension appears in the list
3. View the public page: `https://marketplace.visualstudio.com/items?itemName=YOUR-PUBLISHER.context-manager`
4. Verify all information displays correctly:
   - Icon
   - Description
   - README
   - Screenshots
   - Changelog

### 9. Post-Publishing

1. **Update Repository**:
   - Tag the release in git: `git tag v0.1.0 && git push --tags`
   - Create a GitHub Release with release notes

2. **Monitor**:
   - Watch for user feedback and issues
   - Check installation metrics
   - Respond to Q&A section on marketplace

3. **Promote**:
   - Share on social media
   - Post on relevant forums/communities
   - Add to your portfolio

## Version Updates

### Patch Release (Bug Fixes)
```bash
# Update version in package.json (0.1.0 → 0.1.1)
# Update CHANGELOG.md with fixes
npm run compile
vsce publish patch
```

### Minor Release (New Features)
```bash
# Update version in package.json (0.1.0 → 0.2.0)
# Update CHANGELOG.md with features
npm run compile
vsce publish minor
```

### Major Release (Breaking Changes)
```bash
# Update version in package.json (0.1.0 → 1.0.0)
# Update CHANGELOG.md with breaking changes
# Update README with migration guide
npm run compile
vsce publish major
```

## Common Issues & Solutions

### ❌ "Missing icon.png"
**Solution**: Create icon.png file (see ICON_GUIDE.md) or remove `"icon": "icon.png"` from package.json

### ❌ "Missing publisher"
**Solution**: Add `"publisher": "your-publisher-id"` to package.json

### ❌ "Package size too large"
**Solution**: Check .vscodeignore is properly configured to exclude node_modules, src, tests

### ❌ "Authentication failed"
**Solution**: Ensure PAT has "Marketplace (Manage)" scope and hasn't expired

### ❌ "Name already exists"
**Solution**: Choose a unique extension name or prepend publisher name

### ❌ "Version already exists"
**Solution**: Increment version number in package.json before publishing

## Unpublishing

If you need to unpublish (use cautiously as it affects users):

```bash
vsce unpublish YOUR-PUBLISHER.context-manager
```

**Note**: Unpublishing is permanent. Users who installed it can still use it, but can't reinstall.

## Best Practices

### Before First Release
- [ ] Test on Windows, macOS, and Linux
- [ ] Test with different VS Code themes
- [ ] Get feedback from beta testers
- [ ] Proofread all documentation
- [ ] Test with GitHub Copilot disabled (graceful degradation)
- [ ] Check extension size (should be < 5MB for fast downloads)

### Quality Badges

Add badges to README.md to show quality indicators:

```markdown
[![Version](https://img.shields.io/visual-studio-marketplace/v/YOUR-PUBLISHER.context-manager)](https://marketplace.visualstudio.com/items?itemName=YOUR-PUBLISHER.context-manager)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/YOUR-PUBLISHER.context-manager)](https://marketplace.visualstudio.com/items?itemName=YOUR-PUBLISHER.context-manager)
[![Rating](https://img.shields.io/visual-studio-marketplace/r/YOUR-PUBLISHER.context-manager)](https://marketplace.visualstudio.com/items?itemName=YOUR-PUBLISHER.context-manager)
```

### Screenshots & GIFs

Add visual content to README:
- Dashboard view
- Chat participant in action
- Context menu commands
- Project management sidebar
- Knowledge card management

Use tools like:
- **Windows**: ScreenToGif, ShareX
- **macOS**: Kap, Gifox
- **Linux**: Peek, SimpleScreenRecorder

Optimize GIF size with [ezgif](https://ezgif.com/optimize)

## Continuous Deployment (Optional)

Set up GitHub Actions for automatic publishing:

```yaml
# .github/workflows/publish.yml
name: Publish Extension

on:
  release:
    types: [published]

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: 18
      - run: npm install
      - run: npm run compile
      - run: npx @vscode/vsce publish -p ${{ secrets.VSCE_PAT }}
```

Store your PAT in GitHub Secrets as `VSCE_PAT`.

## Support & Maintenance

### Handling Issues
- Respond to issues within 48 hours
- Use issue templates for consistent bug reports
- Tag issues appropriately (bug, enhancement, question)
- Close fixed issues with reference to commit/PR

### Regular Updates
- Security patches monthly
- Feature updates quarterly
- Keep dependencies updated
- Monitor VS Code API changes

## Resources

- [VS Code Extension Publishing](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
- [Extension Manifest Reference](https://code.visualstudio.com/api/references/extension-manifest)
- [Extension Guidelines](https://code.visualstudio.com/api/references/extension-guidelines)
- [Marketplace Statistics](https://marketplace.visualstudio.com/manage)

---

**Ready to publish?** Follow the checklist above, create your icon, and run `vsce publish`!

Good luck! 🚀
