mod markdown;

use std::collections::BTreeMap;
use std::{
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Debug, Serialize)]
pub struct OpenedDocument {
    pub path: String,
    pub html: String,
    pub source: String,
    pub version: String,
}

#[derive(Debug, Clone, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppState {
    pub theme: Option<String>,
    pub remote_images: bool,
    pub recent_paths: Vec<String>,
    pub open_paths: Vec<String>,
    pub active_path: Option<String>,
    pub window: Option<WindowState>,
    pub documents: BTreeMap<String, DocumentState>,
}

#[derive(Debug, Clone, Copy, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct WindowState {
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Copy, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DocumentState {
    pub mode: Option<DocumentMode>,
    pub scroll_top: f64,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DocumentMode {
    View,
    Edit,
    Dual,
}

pub fn open_markdown_document(path: String) -> Result<OpenedDocument, String> {
    if !is_markdown_document(&path) {
        return Err("Only .md Markdown Documents can be opened".to_string());
    }

    let source = fs::read_to_string(&path)
        .map_err(|error| format!("Could not open Markdown Document: {error}"))?;
    let document_path = Path::new(&path);
    let html = markdown::render_markdown_document(&source, document_path.parent());
    let version = document_version(document_path)
        .map_err(|error| format!("Could not inspect Markdown Document: {error}"))?;

    Ok(OpenedDocument {
        path,
        html,
        source,
        version,
    })
}

pub fn save_markdown_document(path: String, source: String) -> Result<OpenedDocument, String> {
    if !is_markdown_document(&path) {
        return Err("Only .md Markdown Documents can be saved".to_string());
    }

    let document_path = Path::new(&path);
    atomic_write(document_path, source.as_bytes())
        .map_err(|error| format!("Could not save Markdown Document: {error}"))?;
    let html = markdown::render_markdown_document(&source, document_path.parent());
    let version = document_version(document_path)
        .map_err(|error| format!("Could not inspect Markdown Document: {error}"))?;

    Ok(OpenedDocument {
        path,
        html,
        source,
        version,
    })
}

pub fn markdown_document_version(path: String) -> Result<String, String> {
    if !is_markdown_document(&path) {
        return Err("Only .md Markdown Documents can be watched".to_string());
    }

    document_version(Path::new(&path))
        .map_err(|error| format!("Could not inspect Markdown Document: {error}"))
}

pub fn render_markdown_preview(path: String, source: String) -> Result<String, String> {
    if !is_markdown_document(&path) {
        return Err("Only .md Markdown Documents can be previewed".to_string());
    }

    Ok(markdown::render_markdown_document(
        &source,
        Path::new(&path).parent(),
    ))
}

pub fn load_app_state(app: AppHandle) -> Result<AppState, String> {
    app_config_dir(&app).map(|dir| load_app_state_from_dir(&dir))
}

pub fn save_app_state(app: AppHandle, state: AppState) -> Result<(), String> {
    let dir = app_config_dir(&app)?;
    save_app_state_to_dir(&dir, &state)
        .map_err(|error| format!("Could not save app state: {error}"))
}

pub fn load_app_state_from_dir(dir: &Path) -> AppState {
    fs::read_to_string(app_state_path(dir))
        .ok()
        .and_then(|contents| serde_json::from_str(&contents).ok())
        .unwrap_or_default()
}

pub fn save_app_state_to_dir(dir: &Path, state: &AppState) -> io::Result<()> {
    fs::create_dir_all(dir)?;
    let contents = serde_json::to_vec_pretty(state)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    atomic_write(&app_state_path(dir), &contents)
}

fn app_config_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map_err(|error| format!("Could not find app config directory: {error}"))
}

fn app_state_path(dir: &Path) -> PathBuf {
    dir.join("config.json")
}

fn atomic_write(path: &Path, contents: &[u8]) -> io::Result<()> {
    let temp_path = write_temp_file(path, contents)?;
    if let Err(error) = replace_file(&temp_path, path) {
        let _ = fs::remove_file(&temp_path);
        return Err(error);
    }
    Ok(())
}

fn document_version(path: &Path) -> io::Result<String> {
    let metadata = fs::metadata(path)?;
    let modified = metadata
        .modified()?
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();

    Ok(format!("{}:{modified}", metadata.len()))
}

fn write_temp_file(path: &Path, contents: &[u8]) -> io::Result<PathBuf> {
    let dir = path.parent().unwrap_or_else(|| Path::new("."));
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("document");

    for attempt in 0..100 {
        let temp_path = dir.join(format!(
            ".{file_name}.mder-save-{}-{attempt}.tmp",
            std::process::id()
        ));
        let mut file = match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp_path)
        {
            Ok(file) => file,
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        };

        if let Err(error) = file.write_all(contents).and_then(|_| file.sync_all()) {
            drop(file);
            let _ = fs::remove_file(&temp_path);
            return Err(error);
        }
        return Ok(temp_path);
    }

    Err(io::Error::new(
        io::ErrorKind::AlreadyExists,
        "could not create a temp save file",
    ))
}

#[cfg(not(windows))]
fn replace_file(temp_path: &Path, path: &Path) -> io::Result<()> {
    fs::rename(temp_path, path)
}

#[cfg(windows)]
fn replace_file(temp_path: &Path, path: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;

    const MOVEFILE_REPLACE_EXISTING: u32 = 0x1;
    const MOVEFILE_WRITE_THROUGH: u32 = 0x8;

    #[link(name = "Kernel32")]
    unsafe extern "system" {
        fn MoveFileExW(existing: *const u16, new: *const u16, flags: u32) -> i32;
    }

    let existing: Vec<u16> = temp_path.as_os_str().encode_wide().chain([0]).collect();
    let new: Vec<u16> = path.as_os_str().encode_wide().chain([0]).collect();
    let ok = unsafe {
        MoveFileExW(
            existing.as_ptr(),
            new.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };

    if ok == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

fn is_markdown_document(path: &str) -> bool {
    Path::new(path)
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
}

pub fn initial_markdown_paths() -> Vec<String> {
    markdown_paths(std::env::args().skip(1))
}

fn markdown_paths<I>(paths: I) -> Vec<String>
where
    I: IntoIterator<Item = String>,
{
    paths
        .into_iter()
        .filter(|path| is_markdown_document(path))
        .collect()
}

fn markdown_paths_from_cwd<I>(paths: I, cwd: &str) -> Vec<String>
where
    I: IntoIterator<Item = String>,
{
    let cwd = Path::new(cwd);
    markdown_paths(paths)
        .into_iter()
        .map(|path| {
            if Path::new(&path).is_absolute() {
                path
            } else {
                cwd.join(path).to_string_lossy().into_owned()
            }
        })
        .collect()
}

mod commands {
    use super::{AppState, OpenedDocument};
    use tauri::AppHandle;

    #[tauri::command]
    pub fn initial_markdown_paths() -> Vec<String> {
        super::initial_markdown_paths()
    }

    #[tauri::command]
    pub fn open_markdown_document(path: String) -> Result<OpenedDocument, String> {
        super::open_markdown_document(path)
    }

    #[tauri::command]
    pub fn save_markdown_document(path: String, source: String) -> Result<OpenedDocument, String> {
        super::save_markdown_document(path, source)
    }

    #[tauri::command]
    pub fn markdown_document_version(path: String) -> Result<String, String> {
        super::markdown_document_version(path)
    }

    #[tauri::command]
    pub fn render_markdown_preview(path: String, source: String) -> Result<String, String> {
        super::render_markdown_preview(path, source)
    }

    #[tauri::command]
    pub fn load_app_state(app: AppHandle) -> Result<AppState, String> {
        super::load_app_state(app)
    }

    #[tauri::command]
    pub fn save_app_state(app: AppHandle, state: AppState) -> Result<(), String> {
        super::save_app_state(app, state)
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            let paths = markdown_paths_from_cwd(args, &cwd);
            if paths.is_empty() {
                return;
            }

            let _ = app.emit("mder-open-paths", paths);
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .invoke_handler(tauri::generate_handler![
            commands::initial_markdown_paths,
            commands::open_markdown_document,
            commands::save_markdown_document,
            commands::markdown_document_version,
            commands::render_markdown_preview,
            commands::load_app_state,
            commands::save_app_state
        ])
        .run(tauri::generate_context!())
        .expect("failed to run mder");
}

#[cfg(test)]
mod tests {
    use super::{markdown_paths, markdown_paths_from_cwd};

    #[test]
    fn markdown_paths_filters_args() {
        assert_eq!(
            markdown_paths(["mder.exe", "one.md", "two.txt", "THREE.MD"].map(String::from)),
            ["one.md", "THREE.MD"]
        );
    }

    #[test]
    fn markdown_paths_from_cwd_resolves_relative_paths() {
        assert_eq!(
            markdown_paths_from_cwd(
                ["docs\\one.md", "C:\\abs\\two.md"].map(String::from),
                "C:\\work"
            ),
            ["C:\\work\\docs\\one.md", "C:\\abs\\two.md"]
        );
    }
}
