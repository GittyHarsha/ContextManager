# Contributing to ContextManager

Thank you for your interest in contributing to ContextManager! This document provides guidelines and instructions for contributing.

## Table of Contents
- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Making Changes](#making-changes)
- [Submitting Changes](#submitting-changes)
- [Coding Guidelines](#coding-guidelines)

## Code of Conduct

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/).
For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or
contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.

## Getting Started

1. Fork the repository on GitHub
2. Clone your fork locally
3. Create a new branch for your changes
4. Make your changes
5. Test your changes
6. Submit a pull request

## Development Setup

### Prerequisites
- Node.js (v18 or later)
- VS Code (v1.100.0 or later)
- GitHub Copilot extension (for testing AI features)

### Setup Instructions

```bash
# Clone your fork
git clone https://github.com/YOUR-USERNAME/vscode-extension-samples.git
cd vscode-extension-samples/codebase-navigator

# Install dependencies
npm install

# Compile the extension
npm run compile

# Watch for changes (recommended during development)
npm run watch
```

### Running the Extension

1. Open the `codebase-navigator` folder in VS Code
2. Press `F5` to launch the Extension Development Host
3. Test your changes in the new VS Code window

## Making Changes

### Branch Naming

Use descriptive branch names:
- `feature/add-export-import` - For new features
- `fix/cache-invalidation` - For bug fixes
- `docs/update-readme` - For documentation changes
- `refactor/improve-performance` - For code refactoring

### Commit Messages

Follow conventional commit format:
```
type(scope): subject

body (optional)

footer (optional)
```

Types:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Maintenance tasks

Examples:
```
feat(chat): add export project configuration command

fix(cache): prevent duplicate cache entries for same symbol

docs(readme): add screenshots and usage examples
```

## Submitting Changes

### Before Submitting

1. **Test your changes thoroughly**
   - Run the extension in Development Host
   - Test edge cases and error scenarios
   - Verify existing functionality still works

2. **Update documentation**
   - Update README.md if adding features
   - Update CHANGELOG.md with your changes
   - Add JSDoc comments to new functions

3. **Check code quality**
   - Run `npm run lint` and fix any issues
   - Ensure TypeScript compiles without errors
   - Follow the coding guidelines below

### Pull Request Process

1. Push your changes to your fork
2. Create a Pull Request against the `main` branch
3. Fill out the PR template completely
4. Link any related issues
5. Wait for review and address feedback

### PR Title Format

Use the same format as commit messages:
```
feat(chat): add project export functionality
```

## Coding Guidelines

### TypeScript

- Use TypeScript strict mode
- Prefer `const` over `let`
- Use async/await instead of callbacks
- Add type annotations for public APIs
- Use interfaces for object shapes

### Code Style

- Use tabs for indentation (VS Code default)
- Maximum line length: 120 characters
- Use single quotes for strings
- Add trailing commas in multi-line objects/arrays
- Use template literals for string interpolation

### Naming Conventions

- **Files**: camelCase (e.g., `cacheManager.ts`, `projectTypes.ts`)
- **Classes**: PascalCase (e.g., `ProjectManager`, `ExplanationCache`)
- **Interfaces**: PascalCase (e.g., `Project`, `KnowledgeCard`)
- **Functions**: camelCase (e.g., `getActiveProject`, `createKnowledgeCard`)
- **Constants**: UPPER_SNAKE_CASE (e.g., `MAX_CACHE_SIZE`, `DEFAULT_TIMEOUT`)
- **Private members**: prefix with `_` (e.g., `_cache`, `_onDidChange`)

### Error Handling

- Always handle errors gracefully
- Show user-friendly error messages
- Log errors to the console for debugging
- Use try-catch for async operations

```typescript
try {
	const result = await someAsyncOperation();
	return result;
} catch (error) {
	vscode.window.showErrorMessage('Failed to complete operation');
	console.error('Operation failed:', error);
	return undefined;
}
```

### VS Code API Usage

- Dispose resources properly (add to `context.subscriptions`)
- Use VS Code's built-in UI components
- Follow VS Code's UX guidelines
- Handle cancellation tokens appropriately

### Documentation

- Add JSDoc comments for public APIs
- Include parameter descriptions
- Document return types
- Add usage examples for complex functions

```typescript
/**
 * Creates a new knowledge card and adds it to the project.
 * @param projectId The ID of the project to add the card to
 * @param title The title of the knowledge card
 * @param content The content of the knowledge card
 * @returns The created knowledge card, or undefined if creation failed
 * @example
 * const card = await createKnowledgeCard('proj-1', 'Auth Pattern', 'We use JWT tokens...');
 */
async function createKnowledgeCard(
	projectId: string,
	title: string,
	content: string
): Promise<KnowledgeCard | undefined> {
	// Implementation
}
```

## Feature Requests

Have an idea for a new feature? Great! Here's how to propose it:

1. Check if a similar feature request exists
2. Open a new issue with the `feature-request` label
3. Describe the feature and its use case
4. Explain why it would benefit users
5. Include mockups or examples if applicable

## Bug Reports

Found a bug? Help us fix it:

1. Check if the bug is already reported
2. Open a new issue with the `bug` label
3. Include steps to reproduce
4. Provide expected vs actual behavior
5. Include VS Code version, extension version, and OS
6. Add console logs or screenshots if relevant

## Questions?

- Check the [README](README.md) first
- Search existing [issues](https://github.com/Microsoft/vscode-extension-samples/issues)
- Start a [discussion](https://github.com/Microsoft/vscode-extension-samples/discussions)
- Ask in the PR comments

## License

By contributing to ContextManager, you agree that your contributions will be licensed under the MIT License.

---

Thank you for contributing to ContextManager! 🎉
