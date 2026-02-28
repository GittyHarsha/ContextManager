# ContextManager Extension - Specification

## Problem Statement

- **clangd handles navigation**: definitions, references, call hierarchy, type hierarchy
- **Missing**: Understanding the **purpose** and **why** of code
- Asking Copilot the same questions repeatedly is tedious
- Responses are inconsistent (too verbose, too brief, hallucinations)

## Solution

A **chat participant** (`@ctx`) triggered via **context menu**:
1. Right-click on symbol → "Explain Symbol"
2. Opens Copilot Chat with pre-filled query
3. Chat participant handles the request
4. **Caches** explanations (no re-asking)

**What clangd already does (NOT in scope):**
- Find definitions
- Find references
- Call hierarchy (incoming/outgoing)
- Type hierarchy (inheritance)

---

## Core Features

### 1. Explain Symbol
**Trigger**: Right-click → "Explain Symbol"  
**Flow**:
1. Get symbol under cursor
2. Get definition via clangd
3. Open chat: `@ctx /explain SymbolName` with definition attached

### 2. Explain Usage
**Trigger**: Right-click on reference → "Explain This Usage"  
**Flow**:
1. Get usage context (surrounding code)
2. Get definition via clangd
3. Open chat: `@ctx /usage SymbolName` with both attached

### 3. Explain Relationships
**Trigger**: Right-click on class → "Explain Relationships"  
**Flow**:
1. Get class definition
2. Get type hierarchy from clangd (parents/children)
3. Open chat: `@ctx /relationships ClassName` with context

### 4. Caching
- Check cache before calling LLM
- Cache key: `{filePath}:{line}:{symbolName}:{command}`
- Storage: VS Code workspace state
- Return cached response instantly if available
- "Refresh" command to bypass cache

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    VS Code Extension                         │
│                                                              │
│  Context Menu ──► Command ──► workbench.action.chat.open    │
│       │               │              │                       │
│       │               ▼              ▼                       │
│       │         Get Definition    Open Chat with             │
│       │         (via clangd)      @ctx /explain              │
│       │                           + attached file context    │
│       │                                                      │
└───────┼──────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│                    Chat Participant                          │
│                    @ctx                                      │
│                                                              │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────┐  │
│  │   Cache     │ ◄──│  Handler    │───►│  vscode.lm API  │  │
│  │  (hit?)     │    │             │    │  (LLM request)  │  │
│  └─────────────┘    └─────────────┘    └─────────────────┘  │
│                            │                                 │
│                            ▼                                 │
│                    stream.markdown()                         │
│                    (response to user)                        │
└─────────────────────────────────────────────────────────────┘
```

### Folder Structure
```
context-manager/
├── src/
│   ├── extension.ts           # Activation, register commands & participant
│   ├── commands.ts            # Context menu command handlers
│   ├── chatParticipant.ts     # @ctx chat participant
│   ├── cache.ts               # Workspace state cache
│   ├── prompts.ts             # System prompts for each command
│   └── utils/
│       └── symbolUtils.ts     # Get symbol, definition via clangd
├── package.json
└── tsconfig.json
```

---

## Context Menu Registration

```json
// package.json
{
  "contributes": {
    "menus": {
      "editor/context": [
        {
          "command": "contextManager.explainSymbol",
          "when": "editorHasSelection || editorTextFocus",
          "group": "navigation@100"
        },
        {
          "command": "contextManager.explainUsage",
          "when": "editorTextFocus",
          "group": "navigation@101"
        },
        {
          "command": "contextManager.explainRelationships",
          "when": "editorTextFocus",
          "group": "navigation@102"
        }
      ]
    },
    "commands": [
      {
        "command": "contextManager.explainSymbol",
        "title": "Explain Symbol"
      },
      {
        "command": "contextManager.explainUsage",
        "title": "Explain This Usage"
      },
      {
        "command": "contextManager.explainRelationships",
        "title": "Explain Relationships"
      },
      {
        "command": "contextManager.clearCache",
        "title": "Clear Explanation Cache"
      }
    ]
  }
}
```

---

## Command Implementation

```typescript
// src/commands.ts
import * as vscode from 'vscode';
import { getSymbolAtCursor, getDefinitionLocation } from './utils/symbolUtils';

export function registerCommands(context: vscode.ExtensionContext) {
  
  context.subscriptions.push(
    vscode.commands.registerCommand('contextManager.explainSymbol', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      const symbol = getSymbolAtCursor(editor);
      const definition = await getDefinitionLocation(
        editor.document.uri, 
        editor.selection.active
      );

      // Open chat with pre-filled query and attached context
      await vscode.commands.executeCommand('workbench.action.chat.open', {
        query: `@ctx /explain ${symbol}`,
        isPartialQuery: false,  // Auto-submit
        attachFiles: definition ? [{ 
          uri: definition.uri, 
          range: definition.range 
        }] : []
      });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('contextManager.explainUsage', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      const symbol = getSymbolAtCursor(editor);
      const usageRange = editor.selection;
      const definition = await getDefinitionLocation(
        editor.document.uri, 
        editor.selection.active
      );

      await vscode.commands.executeCommand('workbench.action.chat.open', {
        query: `@ctx /usage ${symbol}`,
        isPartialQuery: false,
        attachFiles: [
          // Attach current usage site
          { uri: editor.document.uri, range: usageRange },
          // Attach definition for context
          ...(definition ? [{ uri: definition.uri, range: definition.range }] : [])
        ]
      });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('contextManager.explainRelationships', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      const symbol = getSymbolAtCursor(editor);
      const definition = await getDefinitionLocation(
        editor.document.uri, 
        editor.selection.active
      );

      await vscode.commands.executeCommand('workbench.action.chat.open', {
        query: `@ctx /relationships ${symbol}`,
        isPartialQuery: false,
        attachFiles: definition ? [{ 
          uri: definition.uri, 
          range: definition.range 
        }] : []
      });
    })
  );
}
```

---

## Chat Participant Implementation

```typescript
// src/chatParticipant.ts
import * as vscode from 'vscode';
import { ExplanationCache } from './cache';
import { EXPLAIN_PROMPT, USAGE_PROMPT, RELATIONSHIPS_PROMPT } from './prompts';

export function registerChatParticipant(
  context: vscode.ExtensionContext,
  cache: ExplanationCache
) {
  const handler: vscode.ChatRequestHandler = async (
    request: vscode.ChatRequest,
    chatContext: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
  ) => {
    
    // Extract symbol from prompt (e.g., "/explain TabStripModel" → "TabStripModel")
    const symbol = request.prompt.trim();
    
    // Generate cache key from command + symbol + references
    const cacheKey = generateCacheKey(request.command, symbol, request.references);
    
    // Check cache first
    const cached = cache.get(cacheKey);
    if (cached) {
      stream.markdown(`*[Cached]*\n\n${cached}`);
      return { metadata: { cached: true } };
    }

    // Get attached file context
    const fileContext = await getFileContextFromReferences(request.references);

    // Select prompt based on command
    let systemPrompt: string;
    switch (request.command) {
      case 'usage':
        systemPrompt = USAGE_PROMPT;
        break;
      case 'relationships':
        systemPrompt = RELATIONSHIPS_PROMPT;
        break;
      case 'explain':
      default:
        systemPrompt = EXPLAIN_PROMPT;
        break;
    }

    // Build messages
    const messages = [
      vscode.LanguageModelChatMessage.User(systemPrompt),
      vscode.LanguageModelChatMessage.User(
        `Symbol: ${symbol}\n\nCode Context:\n${fileContext}`
      )
    ];

    // Send to LLM
    try {
      const response = await request.model.sendRequest(messages, {}, token);
      
      let fullResponse = '';
      for await (const fragment of response.text) {
        stream.markdown(fragment);
        fullResponse += fragment;
      }

      // Cache the result
      cache.set(cacheKey, fullResponse);
      
    } catch (err) {
      if (err instanceof vscode.LanguageModelError) {
        stream.markdown(`Error: ${err.message}`);
      }
      throw err;
    }

    return { metadata: { cached: false } };
  };

  // Register the participant
  const participant = vscode.chat.createChatParticipant(
    'context-manager.ctx',
    handler
  );
  
  participant.iconPath = new vscode.ThemeIcon('book');
  
  context.subscriptions.push(participant);
}

async function getFileContextFromReferences(
  references: readonly vscode.ChatPromptReference[]
): Promise<string> {
  const contexts: string[] = [];
  
  for (const ref of references) {
    if (ref.value instanceof vscode.Uri) {
      const doc = await vscode.workspace.openTextDocument(ref.value);
      contexts.push(doc.getText());
    } else if (ref.value instanceof vscode.Location) {
      const doc = await vscode.workspace.openTextDocument(ref.value.uri);
      contexts.push(doc.getText(ref.value.range));
    }
  }
  
  return contexts.join('\n\n---\n\n');
}

function generateCacheKey(
  command: string | undefined, 
  symbol: string,
  references: readonly vscode.ChatPromptReference[]
): string {
  const refKeys = references.map(r => {
    if (r.value instanceof vscode.Uri) return r.value.toString();
    if (r.value instanceof vscode.Location) return `${r.value.uri}:${r.value.range.start.line}`;
    return '';
  }).join('|');
  
  return `${command || 'explain'}:${symbol}:${refKeys}`;
}
```

---

## Prompts

```typescript
// src/prompts.ts

export const EXPLAIN_PROMPT = `You are a code documentation assistant.

Given the symbol and code context, provide a concise explanation:
1. **Purpose** (1-2 sentences - what problem does it solve?)
2. **Key behavior** (what does it do?)
3. For classes: **Key methods** (3-5 most important, one line each)

Be concise. No fluff. Technical accuracy matters.`;

export const USAGE_PROMPT = `You are a code analysis assistant.

Given the usage site and definition, explain:
1. **Why** is this symbol used here? (1-2 sentences)
2. **What role** does it play in this specific context?
3. **Any notable patterns** in how it's being used?

Be concise and specific to this usage site.`;

export const RELATIONSHIPS_PROMPT = `You are a code architecture assistant.

Given the class definition and context, explain:
1. **Role** in the architecture (1-2 sentences)
2. **Why** does it inherit from its parent class(es)?
3. **Key collaborators** (classes it works with closely)
4. **Design pattern** it might be implementing (if any)

Focus on architectural understanding, not implementation details.`;
```

---

## package.json

```json
{
  "name": "context-manager",
  "displayName": "ContextManager",
  "description": "AI-powered code explanations via context menu",
  "version": "0.1.0",
  "publisher": "your-publisher",
  "engines": {
    "vscode": "^1.100.0"
  },
  "categories": ["AI", "Other"],
  "activationEvents": [],
  "main": "./out/extension.js",
  "contributes": {
    "chatParticipants": [
      {
        "id": "context-manager.ctx",
        "name": "ctx",
        "fullName": "ContextManager",
        "description": "Explains code purpose, usage, and relationships",
        "isSticky": false,
        "commands": [
          {
            "name": "explain",
            "description": "Explain the purpose of a symbol"
          },
          {
            "name": "usage",
            "description": "Explain why a symbol is used at this location"
          },
          {
            "name": "relationships",
            "description": "Explain class relationships and architecture"
          }
        ]
      }
    ],
    "commands": [
      {
        "command": "contextManager.explainSymbol",
        "title": "Explain Symbol",
        "category": "ContextManager"
      },
      {
        "command": "contextManager.explainUsage",
        "title": "Explain This Usage",
        "category": "ContextManager"
      },
      {
        "command": "contextManager.explainRelationships",
        "title": "Explain Relationships",
        "category": "ContextManager"
      },
      {
        "command": "contextManager.clearCache",
        "title": "Clear Explanation Cache",
        "category": "ContextManager"
      }
    ],
    "menus": {
      "editor/context": [
        {
          "command": "contextManager.explainSymbol",
          "when": "editorTextFocus",
          "group": "1_contextManager@1"
        },
        {
          "command": "contextManager.explainUsage",
          "when": "editorTextFocus",
          "group": "1_contextManager@2"
        },
        {
          "command": "contextManager.explainRelationships",
          "when": "editorTextFocus",
          "group": "1_contextManager@3"
        }
      ]
    }
  },
  "scripts": {
    "vscode:prepublish": "npm run compile",
    "compile": "tsc -p ./",
    "watch": "tsc -watch -p ./"
  },
  "devDependencies": {
    "@types/vscode": "^1.100.0",
    "@types/node": "^22",
    "typescript": "^5.9.2"
  }
}
```

---

## TODO List

### Phase 1: Foundation
- [ ] Create package.json
- [ ] Set up TypeScript config
- [ ] Implement cache.ts
- [ ] Implement symbolUtils.ts (get word at cursor, get definition)

### Phase 2: Chat Participant
- [ ] Implement chatParticipant.ts
- [ ] Define prompts.ts
- [ ] Test with manual @ctx query

### Phase 3: Context Menu Integration
- [ ] Implement commands.ts
- [ ] Register context menu items
- [ ] Test end-to-end flow

### Phase 4: Polish
- [ ] Add cache hit indicator in response
- [ ] Add "Refresh" follow-up to bypass cache
- [ ] Error handling
- [ ] Test on Chromium codebase

---

## Example User Flow

1. User right-clicks on `TabStripModel` class name
2. Context menu shows "Explain Symbol"
3. User clicks it
4. Copilot Chat opens with: `@ctx /explain TabStripModel`
5. Definition file is attached as context
6. Chat participant checks cache → miss
7. Sends request to LLM with system prompt
8. Streams response: "**Purpose:** TabStripModel manages the tabs in a browser window..."
9. Caches the result
10. Next time: instant cached response
