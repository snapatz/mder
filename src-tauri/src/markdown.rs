pub fn render_markdown_document(source: &str) -> String {
    let html = comrak::markdown_to_html(source, &comrak::Options::default());
    ammonia::clean(&html)
}

#[cfg(test)]
mod tests {
    use super::render_markdown_document;

    #[test]
    fn markdown_document_renders_visible_safe_html() {
        let html = render_markdown_document(
            "# Hello\n\n- one\n- two\n\n[site](https://example.com)\n\n<script>alert('x')</script>",
        );

        assert!(html.contains("<h1>Hello</h1>"));
        assert!(html.contains("<li>one</li>"));
        assert!(html.contains(r#"<a href="https://example.com""#));
        assert!(!html.contains("<script"));
        assert!(!html.contains("alert"));
    }
}
