/// Move a file or directory to the system Trash / Recycle Bin.
///
/// Using the platform trash rather than a hard `fs::remove` means the user can
/// recover accidentally-deleted notes from Finder (macOS), Explorer (Windows),
/// or the desktop file-manager (Linux) until they empty the Trash themselves.
#[tauri::command]
fn trash_file(path: String) -> Result<(), String> {
    trash::delete(&path).map_err(|e| format!("trash_file failed for {path}: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![trash_file])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
