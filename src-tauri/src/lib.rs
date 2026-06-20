mod markdown;

use std::{fs, path::Path};

use serde::Serialize;

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
    std::env::args()
        .skip(1)
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
        .invoke_handler(tauri::generate_handler![
            commands::initial_markdown_paths,
            commands::open_markdown_document
        ])
        .run(tauri::generate_context!())
        .expect("failed to run mder");
}
