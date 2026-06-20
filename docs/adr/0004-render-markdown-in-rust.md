# Render Markdown in Rust

Markdown will be rendered in Rust using a CommonMark/GFM-capable pipeline such as `comrak`, then sanitized before being displayed in the WebView. Mermaid fenced code blocks are preserved for the WebView to render as diagrams, without adding a diagram editor in v1. Keeping Markdown rendering and sanitization on the Rust side centralizes file and security behavior, while the WebView focuses on presentation, Mermaid rendering, and editor interaction.
