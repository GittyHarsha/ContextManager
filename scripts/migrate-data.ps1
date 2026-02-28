# migrate-data.ps1
# Migrates project data from old extension (code-explainer) to new (context-manager).
# Also migrates workspace-level cache data if a workspace path is provided.
#
# IMPORTANT: Close VS Code completely before running this script!
# Run from any terminal: powershell -File .\scripts\migrate-data.ps1
# With workspace cache: powershell -File .\scripts\migrate-data.ps1 -WorkspacePath "C:\my\project"

param(
    [switch]$Force,
    [string]$WorkspacePath
)

$dbPath = "$env:APPDATA\Code\User\globalStorage\state.vscdb"

if (-not (Test-Path $dbPath)) {
    Write-Error "VS Code state database not found at: $dbPath"
    exit 1
}

# Check if VS Code is running
$vsCodeProcs = Get-Process -Name "Code" -ErrorAction SilentlyContinue
if ($vsCodeProcs -and -not $Force) {
    Write-Warning "VS Code appears to be running. Close it first, then re-run this script."
    Write-Warning "Or use -Force to proceed anyway (risky - data may be overwritten on next VS Code launch)."
    exit 1
}

Write-Host "=== ContextManager Data Migration ===" -ForegroundColor Cyan
Write-Host ""

# Use Python to do the SQLite migration
$pythonScript = @"
import sqlite3, json, sys, os, hashlib

db_path = r'$dbPath'
workspace_path = r'$WorkspacePath'
db = sqlite3.connect(db_path)
cur = db.cursor()

migrated_anything = False

# ============================================================
# 1. GLOBAL STATE: Projects + Active Project ID
# ============================================================
print("--- Global State Migration ---")

# Read old extension data
cur.execute("SELECT value FROM ItemTable WHERE key = 'local-dev.code-explainer'")
old_row = cur.fetchone()
if not old_row:
    print("No data found under old extension (local-dev.code-explainer).")
    print("Checking if data already exists in new extension...")
    cur.execute("SELECT value FROM ItemTable WHERE key = 'local-dev.context-manager'")
    new_row = cur.fetchone()
    if new_row:
        new_data = json.loads(new_row[0])
        projects = new_data.get('codeExplainer.projects', [])
        if projects:
            print(f"Found {len(projects)} projects already in new extension storage.")
            for p in projects:
                name = p.get('name', '?')
                todos = len(p.get('todos', []))
                cards = len(p.get('knowledgeCards', []))
                linked = sum(1 for t in p.get('todos', []) if t.get('linkedKnowledgeCardId'))
                print(f"  - {name}: {todos} TODOs ({linked} linked), {cards} knowledge cards")
        else:
            print("No projects in either old or new storage.")
    else:
        print("No data in new storage either. Nothing to migrate.")
else:
    old_data = json.loads(old_row[0])
    projects = old_data.get('codeExplainer.projects', [])
    active_id = old_data.get('codeExplainer.activeProjectId', None)

    if not projects:
        print("Old extension has no projects. Nothing to migrate.")
    else:
        print(f"Found {len(projects)} projects in old extension storage:")
        for p in projects:
            name = p.get('name', '?')
            todos = len(p.get('todos', []))
            cards = len(p.get('knowledgeCards', []))
            print(f"  - {name}: {todos} TODOs, {cards} knowledge cards")

        # Ensure new fields exist on migrated data (forward-compat)
        for p in projects:
            # Ensure project has all required fields
            p.setdefault('selectedCardIds', [])
            p.setdefault('contextEnabled', True)
            p.setdefault('description', '')
            p.setdefault('knowledgeCards', [])
            p.setdefault('todos', [])
            
            # Ensure each todo has new optional fields
            for t in p.get('todos', []):
                t.setdefault('agentRuns', [])
                t.setdefault('notes', None)
                # linkedKnowledgeCardId is optional, no need to set
            
            # Ensure each knowledge card has all fields  
            for c in p.get('knowledgeCards', []):
                c.setdefault('updated', c.get('created', 0))
                c.setdefault('tags', [])
                c.setdefault('referenceFiles', None)
                c.setdefault('source', None)

        # Read or create new extension data
        cur.execute("SELECT value FROM ItemTable WHERE key = 'local-dev.context-manager'")
        new_row = cur.fetchone()
        if new_row:
            new_data = json.loads(new_row[0])
        else:
            new_data = {}

        # Copy data
        new_data['codeExplainer.projects'] = projects
        new_data['codeExplainer.activeProjectId'] = active_id

        new_json = json.dumps(new_data)

        if new_row:
            cur.execute("UPDATE ItemTable SET value = ? WHERE key = 'local-dev.context-manager'", (new_json,))
        else:
            cur.execute("INSERT INTO ItemTable (key, value) VALUES ('local-dev.context-manager', ?)", (new_json,))

        db.commit()
        migrated_anything = True

        # Verify
        cur.execute("SELECT value FROM ItemTable WHERE key = 'local-dev.context-manager'")
        verify = json.loads(cur.fetchone()[0])
        verify_projects = verify.get('codeExplainer.projects', [])
        print(f"\nGlobal migration complete! {len(verify_projects)} projects in new extension storage.")

# ============================================================
# 2. WORKSPACE STATE: Cache data (per-workspace)
# ============================================================
if workspace_path and os.path.isdir(workspace_path):
    print(f"\n--- Workspace Cache Migration ---")
    print(f"Workspace: {workspace_path}")
    
    # VS Code stores workspace state in a hash-based folder
    # The workspace ID is derived from the folder URI
    folder_uri = 'file:///' + workspace_path.replace('\\\\', '/').replace(':', '%3A')
    
    # Try to find workspace storage - check common patterns
    workspace_storage_base = os.path.join(os.environ.get('APPDATA', ''), 'Code', 'User', 'workspaceStorage')
    
    if os.path.isdir(workspace_storage_base):
        found_workspace = False
        for ws_dir in os.listdir(workspace_storage_base):
            ws_json = os.path.join(workspace_storage_base, ws_dir, 'workspace.json')
            if os.path.isfile(ws_json):
                try:
                    with open(ws_json) as f:
                        ws_data = json.load(f)
                    ws_folder = ws_data.get('folder', '')
                    # Normalize for comparison
                    if ws_folder.lower().replace('/', '\\\\').rstrip('\\\\') == workspace_path.lower().replace('/', '\\\\').rstrip('\\\\') or \
                       ws_folder.lower() == folder_uri.lower():
                        ws_state_db = os.path.join(workspace_storage_base, ws_dir, 'state.vscdb')
                        if os.path.isfile(ws_state_db):
                            print(f"Found workspace state DB: {ws_state_db}")
                            ws_db = sqlite3.connect(ws_state_db)
                            ws_cur = ws_db.cursor()
                            
                            # Check for old cache data
                            old_cache_key = f'local-dev.code-explainer//codeExplainer.explanationCache'
                            old_cache_key_v2 = f'local-dev.code-explainer//codeExplainer.cache.v2'
                            new_cache_key = f'local-dev.context-manager//codeExplainer.cache.v2'
                            
                            # Try v2 first, then v1
                            cache_data = None
                            for key in [old_cache_key_v2, old_cache_key]:
                                ws_cur.execute("SELECT value FROM ItemTable WHERE key = ?", (key,))
                                row = ws_cur.fetchone()
                                if row:
                                    cache_data = json.loads(row[0])
                                    print(f"Found {len(cache_data)} cache entries under key: {key}")
                                    break
                            
                            if cache_data:
                                # Write to new key
                                new_json = json.dumps(cache_data)
                                ws_cur.execute("SELECT value FROM ItemTable WHERE key = ?", (new_cache_key,))
                                existing = ws_cur.fetchone()
                                if existing:
                                    ws_cur.execute("UPDATE ItemTable SET value = ? WHERE key = ?", (new_json, new_cache_key))
                                else:
                                    ws_cur.execute("INSERT INTO ItemTable (key, value) VALUES (?, ?)", (new_cache_key, new_json))
                                ws_db.commit()
                                print(f"Workspace cache migration complete! {len(cache_data)} entries migrated.")
                                migrated_anything = True
                            else:
                                print("No cache data found in old extension workspace storage.")
                            
                            ws_db.close()
                            found_workspace = True
                            break
                except Exception as e:
                    continue
        
        if not found_workspace:
            print(f"Could not find workspace storage for: {workspace_path}")
            print("This is normal if you never used the old extension in this workspace.")
    else:
        print(f"Workspace storage directory not found: {workspace_storage_base}")
else:
    if workspace_path:
        print(f"\nWorkspace path not found: {workspace_path}")
    else:
        print("\nNo workspace path provided. Skipping workspace cache migration.")
        print("To migrate cache too, re-run with: -WorkspacePath 'C:\\path\\to\\workspace'")

# ============================================================
# Summary
# ============================================================
if migrated_anything:
    print("\n=== Migration successful! ===")
else:
    print("\n=== No migration needed. ===")

db.close()
"@

$pythonScript | python

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "Done! Now open VS Code and your data should be there." -ForegroundColor Green
    Write-Host "Reload VS Code: Ctrl+Shift+P -> 'Developer: Reload Window'" -ForegroundColor Yellow
} else {
    Write-Error "Migration failed."
}
