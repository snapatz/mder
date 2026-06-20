pub fn render_markdown_document(source: &str) -> String {
    let html = comrak::markdown_to_html(source, &markdown_options());
    sanitizer().clean(&html).to_string()
}

fn markdown_options() -> comrak::Options<'static> {
    let mut options = comrak::Options::default();
    options.extension.strikethrough = true;
    options.extension.table = true;
    options.extension.tagfilter = true;
    options.extension.tasklist = true;
    options.extension.autolink = true;
    options.render.r#unsafe = true;
    options
}

fn sanitizer() -> ammonia::Builder<'static> {
    let mut builder = ammonia::Builder::default();
    builder
        .add_tags(["input"])
        .add_tag_attributes("input", ["checked", "disabled", "type"]);
    builder
}

#[cfg(test)]
mod tests {
    use super::render_markdown_document;

    #[test]
    fn markdown_document_renders_visible_safe_html() {
        let html = render_markdown_document(
            "# Hello\n\n- one\n- two\n\n[site](https://example.com)\n\n<script>alert('x')</script>\n\n<img src=x onerror=alert(1)>",
        );

        assert!(html.contains("<h1>Hello</h1>"));
        assert!(html.contains("<li>one</li>"));
        assert!(html.contains(r#"<a href="https://example.com""#));
        assert!(!html.contains("<script"));
        assert!(!html.contains("onerror"));
    }

    #[test]
    fn markdown_document_renders_gfm() {
        let html = render_markdown_document(
            "~done~\n\n- [x] ship\n\n| A | B |\n|---|---|\n| C | D |\n\n<xmp>blocked</xmp>",
        );

        assert!(html.contains("<del>done</del>"));
        assert!(html.contains(r#"<input type="checkbox" checked="" disabled=""> ship"#));
        assert!(html.contains("<table>"));
        assert!(html.contains("<td>C</td>"));
        assert!(!html.contains("<xmp>"));
    }
}
