# CSP Fix Report — `fix-csp-regression`

## What Was Wrong

A prior security-hardening commit changed the `script-src` directive in the dashboard's
Content-Security-Policy from `'unsafe-inline'` to `'nonce-${nonce}'`:

```html
<!-- BEFORE (broken) -->
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
```

Per the CSP Level 2+ specification, when a **nonce-source** is present in a directive,
the `'unsafe-inline'` keyword is **ignored**. Because the dashboard uses inline event
handlers (`onclick`, `oninput`, `onchange`) extensively throughout its HTML, the nonce-only
policy caused every single handler to be blocked with:

> *Refused to execute inline event handler because it violates the following
> Content Security Policy directive: "script-src 'nonce-...'"*

## What Was Changed

**File:** `codebase-navigator/src/dashboard/DashboardPanel.ts` (line 335)

```diff
- <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
+ <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
```

- **`script-src`**: Changed from `'nonce-${nonce}'` → `'unsafe-inline'`
- **`style-src`**: Already had `'unsafe-inline'` — no change needed
- **Nonce generation**: Left in place. The nonce is still passed to `getDashboardScript()`
  and applied to the `<script>` tag. This is harmless — when `'unsafe-inline'` is the
  policy, the nonce attribute is simply unused.

## Inline Handler Audit

| Handler Type | DashboardPanel.ts | webviewScript.ts | Total |
|-------------|------------------:|------------------:|------:|
| `onclick`   | 86                | 5                 | **91**  |
| `oninput`   | 4                 | 0                 | **4**   |
| `onchange`  | 73                | 1                 | **74**  |
| **Total**   | **163**           | **6**             | **169** |

All **169** inline event handlers are now unblocked by this fix.

No other inline handler types (`onkeyup`, `onkeydown`, `onmouseover`, `onfocus`,
`onblur`, `onsubmit`, `onload`, `onerror`) were found in these files.

## Recommendation for Future CSP Hardening

To re-enable nonce-based CSP (which is significantly more secure), the codebase must
first migrate **all** inline event handlers to the `addEventListener` pattern:

1. **Phase 1 — Inventory & prioritize:** Use this report's counts as a starting baseline.
   Focus on `DashboardPanel.ts` first (163 handlers).

2. **Phase 2 — Migrate handlers:** For each inline handler, move the logic into a
   function registered via `addEventListener()` inside the `<script nonce="...">` block.
   Example:
   ```html
   <!-- Before -->
   <button onclick="doThing()">Click</button>

   <!-- After -->
   <button id="thing-btn">Click</button>
   <script nonce="${nonce}">
     document.getElementById('thing-btn').addEventListener('click', doThing);
   </script>
   ```

3. **Phase 3 — Restore nonce CSP:** Once no inline handlers remain, switch `script-src`
   back to `'nonce-${nonce}'` for defense-in-depth against XSS injection.

4. **Phase 4 — Consider `style-src` hardening:** Inline `style="..."` attributes are also
   used extensively. These could be migrated to CSS classes to allow
   `style-src 'nonce-${nonce}'` as well.

---

*Generated as part of todo `fix-csp-regression`.*
