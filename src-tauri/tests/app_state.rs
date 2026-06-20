use std::collections::BTreeMap;
use std::fs;

use mder::{
    AppState, DocumentMode, DocumentState, WindowState, load_app_state_from_dir,
    save_app_state_to_dir,
};

#[test]
fn app_state_defaults_when_config_is_missing_or_invalid() {
    let dir = tempfile::tempdir().expect("temp dir");

    assert_eq!(load_app_state_from_dir(dir.path()), AppState::default());

    fs::write(dir.path().join("config.json"), "{not json").expect("invalid config");

    assert_eq!(load_app_state_from_dir(dir.path()), AppState::default());
}

#[test]
fn app_state_is_written_under_app_dir_not_beside_markdown_documents() {
    let app_dir = tempfile::tempdir().expect("app dir");
    let document_dir = tempfile::tempdir().expect("document dir");
    let document_path = document_dir.path().join("readme.md");
    fs::write(&document_path, "# Readme\n").expect("markdown document");

    let mut documents = BTreeMap::new();
    documents.insert(
        document_path.to_string_lossy().into_owned(),
        DocumentState {
            mode: Some(DocumentMode::Dual),
            scroll_top: 120.0,
        },
    );

    let state = AppState {
        theme: Some("dark".to_string()),
        remote_images: true,
        recent_paths: vec![document_path.to_string_lossy().into_owned()],
        open_paths: vec![document_path.to_string_lossy().into_owned()],
        active_path: Some(document_path.to_string_lossy().into_owned()),
        window: Some(WindowState {
            width: 1200,
            height: 800,
        }),
        documents,
    };

    save_app_state_to_dir(app_dir.path(), &state).expect("save app state");

    assert!(app_dir.path().join("config.json").exists());
    assert!(!document_dir.path().join("config.json").exists());
    assert_eq!(load_app_state_from_dir(app_dir.path()), state);
}
