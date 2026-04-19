# Notes PWA

Production-oriented progressive web app for notes: **HTML/CSS/JS only**, **IndexedDB** persistence, **service worker** for offline use, **Web App Manifest** for installability. Deploys to **GitHub Pages** with no build step.

## Layout

- **Left:** list of notes (newest first by `updatedAt`)
- **Right:** editor (title + body)
- **Auto-save:** debounced ~400 ms; pending edits are flushed when you switch notes, create a note, or delete

## Local development

Serve the folder over HTTP (required for service workers; `file://` will not register a worker).

```bash
cd notes-pwa
python3 -m http.server 8080
```

Open `http://127.0.0.1:8080/` (root). To approximate GitHub Pages under a subpath, use a nested URL or deploy to a test repo; the service worker derives `BASE_PATH` from its own URL.

## GitHub Pages deploy

1. Create a repository (e.g. `notes-pwa`).
2. Push this tree to the `main` branch (root of the repo).

   ```bash
   git init
   git add .
   git commit -m "Initial commit: Notes PWA"
   git branch -M main
   git remote add origin https://github.com/USERNAME/notes-pwa.git
   git push -u origin main
   ```

3. Repository **Settings → Pages**: source **Deploy from a branch**, branch **main**, folder **/** (root).
4. App URL: `https://USERNAME.github.io/notes-pwa/`

**Paths:** All asset references use relative URLs (`./js/...`, `./manifest.json`) so the app works under `/repo-name/` without changes.

## Install on iPhone (Safari)

1. Open the GitHub Pages URL.
2. **Share** → **Add to Home Screen**.

## Testing checklist

| Test | Steps | Expected |
|------|--------|----------|
| **Offline** | Load app online once, turn off Wi‑Fi/cellular, reload | Shell and UI load; lists/notes from cache where applicable; IndexedDB data still available |
| **Persistence** | Create or edit a note, reload | Data still there |
| **Install** | Add to Home Screen, launch from icon | Opens in standalone display (minimal browser UI) |

Also verify in DevTools → Application: **IndexedDB** (`notes-pwa-store`), **Service Workers** (active), **Manifest** (no errors). Data is stored **in plain form** on the device (no app password or encryption).

## Phase 2 ideas

- Cloud sync (Firebase / Supabase) with **last-write-wins** on `updatedAt`, or **CRDT**-based merge later.

## License

Use and modify freely for your own projects.
