use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use serde::Serialize;
use tauri::{Emitter, Manager};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};

// ── Shared quit-confirmation state ────────────────────────────────────────────
// Set to `true` by `confirm_quit` once the user has made a choice in the
// QuitDialogue.  The ExitRequested fallback (Windows / Linux) checks this flag
// so it doesn't intercept the app's own `app_handle.exit(0)` call.

struct QuitConfirmed(AtomicBool);

// ── Vault tree ────────────────────────────────────────────────────────────────

/// A single node in the vault file-system tree returned by `scan_vault_tree`.
/// `#[serde(rename_all = "camelCase")]` maps snake_case Rust fields to the
/// camelCase the TypeScript side expects — no manual conversion needed.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct FileNode {
    name:     String,
    /// Absolute path with forward-slash separators (normalised on all platforms).
    path:     String,
    is_dir:   bool,
    children: Vec<FileNode>,
}

/// Recursively walks `dir`, skipping hidden entries (name starts with `.`)
/// and `.tmp` temp-files left by atomic writes.  Directories come before
/// files within each level; both groups are sorted case-insensitively.
fn scan_recursive(dir: &Path) -> FileNode {
    let name = dir
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let path = dir.to_string_lossy().replace('\\', "/");

    let mut dirs:  Vec<FileNode> = Vec::new();
    let mut files: Vec<FileNode> = Vec::new();

    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            let n = p.file_name().unwrap_or_default().to_string_lossy().to_string();

            // Skip hidden items (.phing, .obsidian, .git, etc.) and temp files
            if n.starts_with('.') || n.ends_with(".tmp") {
                continue;
            }

            if p.is_dir() {
                dirs.push(scan_recursive(&p));
            } else if n.to_lowercase().ends_with(".md") {
                files.push(FileNode {
                    name:     n,
                    path:     p.to_string_lossy().replace('\\', "/"),
                    is_dir:   false,
                    children: Vec::new(),
                });
            }
        }
    }

    dirs.sort_by( |a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    files.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    dirs.extend(files);

    FileNode { name, path, is_dir: true, children: dirs }
}

// ── Commands ──────────────────────────────────────────────────────────────────

/// Move a file or directory to the system Trash / Recycle Bin.
#[tauri::command]
fn trash_file(path: String) -> Result<(), String> {
    trash::delete(&path).map_err(|e| format!("trash_file failed for {path}: {e}"))
}

/// Return the full recursive `FileNode` tree rooted at `vault_path`.
/// The root node represents the vault folder itself; callers render its
/// `children` to display the tree without an extra top-level wrapper.
#[tauri::command]
fn scan_vault_tree(vault_path: String) -> Result<FileNode, String> {
    let path = Path::new(&vault_path);
    if !path.exists() {
        return Err(format!("vault path does not exist: {vault_path}"));
    }
    Ok(scan_recursive(path))
}

/// Rename (or move) a file or directory — wraps `std::fs::rename` so it works
/// on directories as well as files.  The Tauri `fs` plugin's `rename` only
/// covers files; this command handles the folder-rename case.
#[tauri::command]
fn rename_path(from: String, to: String) -> Result<(), String> {
    std::fs::rename(&from, &to)
        .map_err(|e| format!("rename_path failed ({from} → {to}): {e}"))
}

/// Called by the frontend after the user confirms quit ("Save & Quit" or
/// "Discard").  Sets the confirmed flag then exits the process immediately.
#[tauri::command]
fn confirm_quit(app: tauri::AppHandle) {
    app.state::<QuitConfirmed>().0.store(true, Ordering::SeqCst);
    app.exit(0);
}

// ── macOS application menu ────────────────────────────────────────────────────
// On macOS, Cmd+Q is bound to the "Quit" item in the first application
// submenu.  The default PredefinedMenuItem::quit calls [NSApp terminate:]
// directly, which starts the Cocoa termination sequence and tears down the
// WKWebView *before* any Rust or JS code can react.
//
// The fix: omit PredefinedMenuItem::quit entirely and replace it with a plain
// MenuItem that carries the same Cmd+Q accelerator.  Clicking the item (or
// pressing Cmd+Q) fires on_menu_event instead of [NSApp terminate:], so the
// webview is still fully alive when the frontend receives phing://close-requested
// and can paint the QuitDialogue.
//
// This function also includes an Edit submenu so WKWebView can forward
// Undo / Redo / Cut / Copy / Paste / Select All through the macOS
// first-responder chain — without it those keyboard shortcuts break in the
// text editor.

fn build_app_menu(app: &tauri::App) -> tauri::Result<()> {
    // Custom "Quit Phing" item — does NOT call [NSApp terminate:]
    let quit_item = MenuItem::with_id(app, "phing-quit", "Quit Phing", true, Some("Cmd+Q"))?;

    let app_menu = Submenu::with_items(
        app,
        "Phing",
        true,
        &[
            &PredefinedMenuItem::about(app, None, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &quit_item,
        ],
    )?;

    // Edit submenu — required for macOS first-responder text-editing actions
    let edit_menu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;

    // Window submenu — standard macOS window management
    let window_menu = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::bring_all_to_front(app, None)?,
        ],
    )?;

    let menu = Menu::with_items(app, &[&app_menu, &edit_menu, &window_menu])?;
    app.set_menu(menu)?;

    // Wire up the custom quit item.  This fires BEFORE any Cocoa termination
    // sequence, so the webview is guaranteed to be alive and interactive.
    app.on_menu_event(|app, event| {
        if event.id() == "phing-quit" {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.emit("phing://close-requested", ());
            }
        }
    });

    Ok(())
}

// ── Entry point ───────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(QuitConfirmed(AtomicBool::new(false)))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            trash_file,
            confirm_quit,
            scan_vault_tree,
            rename_path,
        ])
        .setup(|app| {
            build_app_menu(app)?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // ExitRequested fires reliably on Windows and Linux and serves as
            // the primary quit-intercept there.  On macOS it fires *after* the
            // Cocoa termination sequence has already started (tao's app delegate
            // has no applicationShouldTerminate: implementation), so it cannot
            // keep the webview alive — the custom menu above handles macOS.
            // We still call prevent_exit() here so Windows / Linux users also
            // see the QuitDialogue when they close the app via the taskbar etc.
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                if !app.state::<QuitConfirmed>().0.load(Ordering::SeqCst) {
                    api.prevent_exit();
                    if let Some(win) = app.get_webview_window("main") {
                        let _ = win.emit("phing://close-requested", ());
                    }
                }
            }
        });
}
