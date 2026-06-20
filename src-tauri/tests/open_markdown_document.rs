use std::fs;

#[test]
fn opens_markdown_document_from_path() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("hello.md");
    fs::write(&path, "# Hello\n\nOpened from disk.").unwrap();

    let document = mder::open_markdown_document(path.to_string_lossy().into_owned()).unwrap();

    assert_eq!(document.path, path.to_string_lossy());
    assert!(document.source.contains("Opened from disk."));
    assert!(document.html.contains("<h1>Hello</h1>"));
    assert!(document.html.contains("Opened from disk."));
}

#[test]
fn saves_markdown_document_to_original_path() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("save.md");
    fs::write(&path, "# Before").unwrap();

    let document = mder::save_markdown_document(
        path.to_string_lossy().into_owned(),
        "# After\n\nSaved.".to_string(),
    )
    .unwrap();

    assert_eq!(fs::read_to_string(&path).unwrap(), "# After\n\nSaved.");
    assert!(document.html.contains("<h1>After</h1>"));
    assert_eq!(document.source, "# After\n\nSaved.");
    assert_eq!(
        fs::read_dir(dir.path())
            .unwrap()
            .filter(|entry| entry
                .as_ref()
                .unwrap()
                .file_name()
                .to_string_lossy()
                .contains(".mder-save-"))
            .count(),
        0
    );
}

#[test]
fn renders_dirty_preview_without_saving() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("preview.md");
    fs::write(&path, "# Saved").unwrap();

    let html =
        mder::render_markdown_preview(path.to_string_lossy().into_owned(), "# Dirty".to_string())
            .unwrap();

    assert!(html.contains("<h1>Dirty</h1>"));
    assert_eq!(fs::read_to_string(&path).unwrap(), "# Saved");
}

#[test]
fn missing_markdown_document_returns_recoverable_error() {
    let error = mder::open_markdown_document("missing.md".to_string()).unwrap_err();

    assert!(error.contains("Could not open Markdown Document"));
}

#[test]
fn non_markdown_document_returns_recoverable_error() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("hello.txt");
    fs::write(&path, "# Hello").unwrap();

    let error = mder::open_markdown_document(path.to_string_lossy().into_owned()).unwrap_err();

    assert!(error.contains("Only .md Markdown Documents"));
}

#[test]
fn relative_local_image_is_embedded() {
    let dir = tempfile::tempdir().unwrap();
    let markdown = dir.path().join("with-image.md");
    let image = dir.path().join("image.png");
    fs::write(&image, [0x89, b'P', b'N', b'G']).unwrap();
    fs::write(&markdown, "![local](./image.png)").unwrap();

    let document = mder::open_markdown_document(markdown.to_string_lossy().into_owned()).unwrap();

    assert!(
        document
            .html
            .contains("data-local-src=\"data:image/png;base64,")
    );
}

#[test]
fn absolute_local_image_is_embedded() {
    let dir = tempfile::tempdir().unwrap();
    let markdown = dir.path().join("with-absolute-image.md");
    let image = dir.path().join("absolute.png");
    let image_path = image.to_string_lossy().replace('\\', "/");
    fs::write(&image, [0x89, b'P', b'N', b'G']).unwrap();
    fs::write(&markdown, format!("![local]({image_path})")).unwrap();

    let document = mder::open_markdown_document(markdown.to_string_lossy().into_owned()).unwrap();

    assert!(
        document
            .html
            .contains("data-local-src=\"data:image/png;base64,")
    );
}

#[test]
fn remote_image_is_blocked_until_enabled() {
    let dir = tempfile::tempdir().unwrap();
    let markdown = dir.path().join("remote.md");
    fs::write(&markdown, "![remote](https://example.com/image.png)").unwrap();

    let document = mder::open_markdown_document(markdown.to_string_lossy().into_owned()).unwrap();

    assert!(
        document
            .html
            .contains("data-remote-src=\"https://example.com/image.png\"")
    );
    assert!(document.html.contains("remote-image is-blocked"));
    assert!(
        !document
            .html
            .contains(" src=\"https://example.com/image.png\"")
    );
}

#[test]
fn relative_image_cannot_escape_document_directory() {
    let root = tempfile::tempdir().unwrap();
    let dir = root.path().join("docs");
    let sibling = root.path().join("outside");
    fs::create_dir_all(&dir).unwrap();
    fs::create_dir_all(&sibling).unwrap();
    let markdown = dir.join("escape.md");
    let image = sibling.join("secret.png");
    fs::write(&image, [0x89, b'P', b'N', b'G']).unwrap();
    fs::write(&markdown, "![secret](../outside/secret.png)").unwrap();

    let document = mder::open_markdown_document(markdown.to_string_lossy().into_owned()).unwrap();

    assert!(document.html.contains("broken-image"));
    assert!(!document.html.contains("data:image/png;base64,"));
}
