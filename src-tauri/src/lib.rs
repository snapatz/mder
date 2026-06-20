mod markdown;

use std::{fs, path::Path};

use serde::Serialize;
use tauri::{Emitter, Manager};

#[derive(Debug, Serialize)]
pub struct OpenedDocument {
    pub path: String,
    pub html: String,
}

pub fn open_markdown_document(path: String) -> Result<OpenedDocument, String> {
    if !is_markdown_document(&path) {
        return Err("Only .md Markdown Documents can be opened".to_string());
    }

    let source = fs::read_to_string(&path)
        .map_err(|error| format!("Could not open Markdown Document: {error}"))?;
    let html = markdown::render_markdown_document(&source, Path::new(&path).parent());

    Ok(OpenedDocument { path, html })
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

mod commands {
    use super::OpenedDocument;

    #[tauri::command]
    pub fn initial_markdown_paths() -> Vec<String> {
        super::initial_markdown_paths()
    }

    #[tauri::command]
    pub fn open_markdown_document(path: String) -> Result<OpenedDocument, String> {
        super::open_markdown_document(path)
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            let paths = markdown_paths(args);
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
            commands::open_markdown_document
        ])
        .run(tauri::generate_context!())
        .expect("failed to run mder");
}

#[cfg(test)]
mod tests {
    use super::markdown_paths;

    #[test]
    fn markdown_paths_filters_args() {
        assert_eq!(
            markdown_paths(["mder.exe", "one.md", "two.txt", "THREE.MD"].map(String::from)),
            ["one.md", "THREE.MD"]
        );
    }
}
