# Use AppData and an installer

App preferences, recent files, and view state will live in the Tauri app data directory, such as `%APPDATA%/<app-name>/config.json`, instead of creating sidecar files near Markdown Documents. The Windows v1 should ship with an installer that registers `.md` file association so opening Markdown from Explorer works as a first-class workflow.
