use std::fs;

#[test]
fn opens_markdown_document_from_path() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("hello.md");
    fs::write(&path, "# Hello\n\nOpened from disk.").unwrap();

    let document = mder::open_markdown_document(path.to_string_lossy().into_owned()).unwrap();

    assert_eq!(document.path, path.to_string_lossy());
    assert!(document.html.contains("<h1>Hello</h1>"));
    assert!(document.html.contains("Opened from disk."));
}

#[test]
fn missing_markdown_document_returns_recoverable_error() {
    let error = mder::open_markdown_document("missing.md".to_string()).unwrap_err();

    assert!(error.contains("Could not open Markdown Document"));
}
