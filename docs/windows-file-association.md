# Windows file association verification

Issue #9 is verified through the normal Tauri Windows installer.

## Build

```powershell
npm exec tauri -- build --bundles nsis
```

The installer is written under:

```text
src-tauri\target\release\bundle\nsis\
```

## Manual check

1. Run the generated `mder_*_x64-setup.exe` installer.
2. Open Windows Settings > Apps > Default apps.
3. Search for `.md` and choose `mder` as the default app.
4. Double-click a `.md` file in Explorer.
5. With `mder` still running, double-click another `.md` file.

Expected result: the first Markdown Document opens in the Viewer, and the second Markdown Document opens as another tab in the existing window.
