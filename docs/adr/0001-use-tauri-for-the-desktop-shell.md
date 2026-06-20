# Use Tauri for the desktop shell

This app will be a native desktop Markdown opener built with Tauri: Rust handles file association, file I/O, and window integration, while the WebView UI handles editing and preview rendering. This avoids writing a native Markdown renderer from scratch and keeps the app smaller than an Electron-style shell while still supporting a polished dual-pane editor.
