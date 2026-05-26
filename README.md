<div align="center">
  <img src="assets/Main.png" alt="Phing Hero Image" width="100%" />
  <h1>✨ phing</h1>
  <p><em>A writing-first markdown sanctuary designed to make thinking feel soft, calm, and uninterrupted.</em></p>
</div>

---

## 🌸 The Vision

Most productivity tools feel like databases. **Phing** is different. It is a local-first, deeply aesthetic knowledge manager built for researchers, writers, and students who want their digital workspace to feel as calming as a quiet desk with a cup of tea.

Instead of overwhelming you with features, Phing focuses on **emotional UX**, robust typography, and an interface that respects your focus. Every architectural decision — from the debounce pipeline to the atomic write strategy — exists to give you one guarantee: **your thoughts are never lost.**

## 🖼️ Preview

<div align="center">
  <table style="border: none;">
    <tr>
      <td><img src="assets/Main_dark.png" alt="Dark Mode" width="100%"/></td>
      <td><img src="assets/Onboarding.png" alt="Onboarding" width="100%"/></td>
    </tr>
    <tr>
      <td><img src="assets/zen.gif" alt="Zen Mode Animation" width="100%"/></td>
      <td><img src="assets/Board.gif" alt="Mind Map Animation" width="100%"/></td>
    </tr>
  </table>
</div>

## 📥 Download

Ready to create your peaceful workspace? You can download the latest version of Phing directly from our releases page:

* **[✨ Download Phing (Latest Release)](https://github.com/Umijun/phing/releases)**

**Supported Platforms:**
* 🍏 **macOS (Apple Silicon / M1, M2, M3):** Download the `.dmg` or `.app.tar.gz` file (e.g., `phing_x.x.x_aarch64.dmg`).
* 🍏 **macOS (Intel / x86):** Download the specific Intel build (e.g., `phing_x.x.x_x64.dmg`).

*Note for macOS Users: If you encounter a 'damaged and cannot be opened' error, please see the note below regarding Apple's Gatekeeper.*

## ✨ Core Philosophy

* **☁️ Calm by Design:** Soft typography (Lora & LINE Seed Sans), frosted-glass surfaces (`backdrop-filter`), and zero-latency Zen modes. The interface steps back so your thinking can step forward.
* **🔒 Bulletproof Trust:** Every note and mind map flows through a hardened persistence pipeline — debounce coalescing, a per-document `WriteQueue`, pre-write snapshot archiving, and atomic `.tmp → rename` commits. A crash at any point leaves your vault intact. A destructive action in-session is reversible with `⌘Z`. A destructive action across sessions is recoverable from `.phing/snapshots/`. Trust is not a feature, it is the foundation.
* **🧠 Visual Thinking:** A deeply integrated Mind Map Board where every document has its own independently tracked, undo-capable history. Scoped per-document undo stacks — not global middleware — mean switching between maps never bleeds history, and `⌘Z` on the board never accidentally touches your note editor state.
* **⌨️ Keyboard First:** A seamless Command Palette workflow, comprehensive board navigation with spatial arrow-key awareness, and formatting shortcuts that keep your hands exactly where they should be.

## 🛡️ Data & Reliability

Phing's persistence layer is engineered to the same standard as professional document editors. Here is exactly what protects your data:

### The Write Pipeline

Every mutation — whether a keystroke, a label rename, or a board reset — travels through the same hardened pipeline:

```text
store mutation (synchronous, in-memory)
  ↓
100 ms debounce  — coalesces rapid bursts into a single write
  ↓
WriteQueue  — per-document serialisation; concurrent writes for the same ID are impossible
  ↓
captureSnapshot  — archives current disk content to .phing/snapshots/ before overwriting
  ↓
atomic write  — content lands in a .tmp sibling first, then renamed over the target
  ↓
vault on disk
```

No write ever reaches disk synchronously. No two writes for the same document ever run concurrently. A crash between the `.tmp` write and the `rename` leaves a recoverable orphan, not a corrupted file.

### WriteQueue Serialisation

The `WriteQueue` serialises writes strictly per document ID. If a move operation (`moveNote`) arrives while a debounced title-rename write is already inflight for the same note, the move is queued behind it — never run concurrently. The move's `run()` closure re-reads `filePath` at execution time so it always operates on the file's actual current on-disk location, regardless of what preceding queue entries may have done.

### Deletion Safety

Before any folder or pocket is sent to the OS Trash, Phing pre-emptively disarms every pending write for notes inside it: debounce timers are cancelled via `clearTimeout`, and queued-but-not-yet-inflight write entries are dropped via `WriteQueue.cancel()`. Without this, a timer firing after `trash_file` would call `mkdir()` on the trashed parent and silently recreate it on disk.

### Dual-Layer Recovery for Destructive Actions

A board reset — or any other operation that irrevocably destroys document state — triggers two independent safety mechanisms simultaneously:

1. **In-session undo stack** — `pushUndo` snapshots the complete `MindMapNode` tree and node-selection state *synchronously before* the mutation runs. `⌘Z` restores it instantly, with selection restored to the exact node that was active at the time.
2. **Durable snapshot archive** — `saveMindMapDoc` calls `captureSnapshot` before every overwrite, writing the previous disk content to `.phing/snapshots/` as a timestamped `.bak` file. Up to 10 snapshots are retained per document; the oldest are pruned automatically. This archive survives application restarts, meaning a reset committed in a session that has since ended is still recoverable manually.

### Conflict Detection

Phing watches the vault for external modifications (other editors, iCloud Drive, Google Drive). When a filesystem change event arrives, the on-disk content is hashed using **FNV-1a 32-bit** and compared against a hash of the current in-memory state. A difference surfaces the `ConflictDialogue`, offering three resolution paths: reload from disk, keep local, or dismiss. Phing's own atomic writes are excluded from triggering false positives via a per-write suppression window registered on `vaultWatcher` immediately before each write.

### Crash Recovery

On every vault open, `findOrphanedTmpFiles` walks the vault recursively and collects any `.md.tmp` (note) or `.json.tmp` (mind-map document) files left by a crash mid-write. For each orphan: if the final path is missing, the `.tmp` is renamed to complete the interrupted write; if the final path already exists, the stale `.tmp` is removed. This runs silently before the vault loads.

### Scoped Mind Map Undo

The undo/redo system uses two module-level `Map<string, UndoEntry[]>` structures keyed by `MindMapDoc.id`, giving every document a fully independent, isolated history of up to **50 steps**. Global Zustand middleware (such as `zundo`) was explicitly rejected: middleware snapshots the entire store slice — including UI state like `editingId` and `notePopupId` — causing incorrect selections to be restored on undo. The manual stack approach gives precise control over exactly what is undoable: tree structure and node selection only.

## 🛠️ Tech Stack

Crafted with obsessive attention to detail using:

* **[Tauri v2](https://tauri.app/)** for a lightweight, native-feeling desktop shell with a Rust backend.
* **React 19 & TypeScript** for the interactive surface.
* **Zustand 5** for fast, fine-grained, independently scoped state management.
* **Tiptap** for the rich Markdown editing experience, extended with custom keyboard shortcuts, wiki-links, and footnotes.
* **React Flow** for the node-based Mind Map canvas with automatic radial layout.
* **Framer Motion** for spring-animated UI transitions.

## 🚀 Current State (v0.1.0-alpha)

* **Phase 1 (Reliability & Trust Layer): 🟢 Completed.** Atomic writes, WriteQueue serialisation, per-document Mind Map undo/redo, dual-layer snapshot recovery, deletion safety guards, FNV-1a conflict detection, and crash-orphan recovery are all in production.
* **Phase 2 (Performance & Invisible Speed): 🟡 In Progress.** Currently optimising large mind map virtualisation and heavy UI dynamics.

---

<div align="center">
  <sub>Built with care by a Thai law student trying to survive late-night EU law research.</sub>
</div>

---

<details>
<summary><h2>⌨️ Features & Hotkeys (Click to expand)</h2></summary>

### 🌐 Global

These shortcuts work from any view.

| Shortcut | Action |
|---|---|
| `⌘K` | Open / close Command Palette |
| `⌘⇧M` | Toggle between Notes view ↔ Mind Map Board |
| `⌘⇧S` | Collapse / expand the main sidebar |

### 🗒️ Notes View

These shortcuts are active when the Notes view is open (not the Mind Map Board).

| Shortcut | Action |
|---|---|
| `⌘N` | Create a new note |
| `⌘⇧Z` | Toggle Zen mode (distraction-free full screen) |
| `⌘⇧A` | Toggle Academic mode (A4 paper layout) |
| `⌘⇧B` | Toggle Backlinks panel |
| `⌘⌫` | Delete selected note — press **twice within 3 seconds** to confirm |

### 📝 Editor

Standard Tiptap / browser shortcuts are included for completeness.

| Shortcut | Action |
|---|---|
| `⌘F` | Open / close the in-note Find bar |
| `Esc` | Close the Find bar |
| `⌘B` | Toggle **bold** |
| `⌘I` | Toggle *italic* |
| `⌘U` | Toggle underline |
| `⌘⇧X` | Toggle ~~strikethrough~~ |
| `⌘E` | Toggle `inline code` |
| `⌘1` – `⌘5` | Toggle Heading 1 through 5 |
| `⌘-` | Insert a horizontal rule |
| `⌘Z` / `⌘⇧Z` | Undo / Redo (native editor history) |
| `[[` | Open wiki-link suggestion popup |

*The floating formatting toolbar is draggable via the `⠿` grip handle. Double-click the handle to snap it back to its default position.*

### 🧠 Mind Map Board

Open the board with `⌘⇧M`. The board manages its own shortcut scope — global note shortcuts are suspended while it is active.

#### Node Editing

| Shortcut | Action |
|---|---|
| `Tab` | Add a child node to the selected node |
| `↵ Enter` | Add a sibling node after the selected node |
| `Space` | Begin editing the selected node's label inline |
| `Del` / `⌫` | Delete the selected node and its entire subtree |
| `⌘⇧N` | Open / close the rich-text note pane attached to the selected node |

#### History

| Shortcut | Action |
|---|---|
| `⌘Z` | Undo last tree mutation (scoped to the active map document) |
| `⌘⇧Z` | Redo |

> **Note:** Undo history is isolated per map document and survives map switching. Up to 50 steps are retained. `⌘Z` and `⌘⇧Z` remain active even while the note pane is open — the pane manages its own independent text-editing undo.

#### Spatial Navigation

Arrow-key navigation is context-aware and respects the radial branch layout.

| Shortcut | Action |
|---|---|
| `→` | Move to the nearest child (or parent if current branch faces left) |
| `←` | Move to the parent (or nearest child if current branch faces right) |
| `↑` | Move to the visual sibling above |
| `↓` | Move to the visual sibling below |

### 🖥️ UI & Navigation

| Feature | How to access |
|---|---|
| Command Palette | `⌘K` — search notes, switch views, run actions |
| Zen Mode | `⌘⇧Z` — hides all chrome; press again to exit |
| Academic Mode | `⌘⇧A` — constrains the editor to an A4-width card |
| Backlinks Panel | `⌘⇧B` — shows all notes that link to the current one via `[[wiki links]]` |
| Mind Map PDF Export | Toolbar button on the Board — fits the canvas to A4 landscape and exports via native save dialogue |
| Note PDF Export | Toolbar button in the Editor — paginates the note surface to multi-page A4 portrait |

</details>

---

## ☕ Support the Project

Phing is a passion project built during late nights after law lectures. If this app helps you find your focus or brings a little peace to your digital workspace, consider supporting its development!

<div align="center">
  <a href="https://www.buymeacoffee.com/Umijun" target="_blank">
    <img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" style="height: 50px !important;width: 217px !important;" >
  </a>
</div>

<br>

**🇹🇭 สำหรับผู้ใช้งานชาวไทย (PromptPay):**<br>

หากน้องผิงช่วยให้การจดโน้ตหรือการค้นคว้าของคุณราบรื่นและสงบขึ้น สามารถสนับสนุนค่ากาแฟเล็กๆ น้อยๆ ผ่านการสแกนคิวอาร์โค้ดด้านล่างได้เลยนะคะ ขอบคุณที่เอ็นดูโปรเจกต์นี้ค่ะ 💖

<div align="center">
  <img src="./assets/promptpay.png" alt="PromptPay QR Code" width="200" />
</div>

---

## 🍎 Note for macOS Users

If you encounter a 'damaged and cannot be opened' error when launching the app, this is due to macOS Gatekeeper blocking applications not signed with an Apple Developer Certificate. You can safely bypass this by running the following command in your Terminal:

```bash
xattr -cr /Applications/phing.app
```

*(Please ensure the app is moved to your /Applications folder before running this command.)*

---

## 🌸 License

Phing is open-sourced software generously licensed under the [MIT license](LICENSE). Feel free to use, modify, and build upon it to create your own peaceful workspace!
