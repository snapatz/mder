use std::{
    fs,
    path::{Path, PathBuf},
};

use base64::{Engine as _, engine::general_purpose};

const IMAGE_PLACEHOLDER: &str = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2NDAiIGhlaWdodD0iMzIwIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiByeD0iMTIiIGZpbGw9IiNmMWY1ZjkiLz48dGV4dCB4PSI1MCUiIHk9IjUwJSIgZHk9Ii4zNWVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmaWxsPSIjNjY3MDg1IiBmb250LWZhbWlseT0iU2Vnb2UgVUksIHNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTgiPkltYWdlPC90ZXh0Pjwvc3ZnPg==";
const MAX_INLINE_IMAGE_BYTES: u64 = 10 * 1024 * 1024;

pub fn render_markdown_document(source: &str, base_dir: Option<&Path>) -> String {
    let html = comrak::markdown_to_html(source, &markdown_options());
    let html = rewrite_images(&html, base_dir);
    sanitizer().clean(&html).to_string()
}

fn markdown_options() -> comrak::Options<'static> {
    let mut options = comrak::Options::default();
    options.extension.strikethrough = true;
    options.extension.table = true;
    options.extension.tagfilter = true;
    options.extension.tasklist = true;
    options.extension.autolink = true;
    options.render.github_pre_lang = true;
    options.render.r#unsafe = true;
    options
}

fn sanitizer() -> ammonia::Builder<'static> {
    let mut builder = ammonia::Builder::default();
    builder
        .add_tags(["input"])
        .add_tag_attributes("input", ["checked", "disabled", "type"])
        .add_tag_attributes("img", ["data-remote-src"])
        .add_allowed_classes("code", ["language-mermaid"])
        .add_allowed_classes("img", ["remote-image", "is-blocked", "broken-image"])
        .add_url_schemes(["data"]);
    builder
}

fn rewrite_images(html: &str, base_dir: Option<&Path>) -> String {
    let mut out = String::with_capacity(html.len());
    let mut rest = html;

    while let Some(start) = rest.find("<img ") {
        out.push_str(&rest[..start]);
        rest = &rest[start..];

        let Some(end) = rest.find('>') else {
            out.push_str(rest);
            return out;
        };

        let tag = &rest[..=end];
        out.push_str(&rewrite_image_tag(tag, base_dir));
        rest = &rest[end + 1..];
    }

    out.push_str(rest);
    out
}

fn rewrite_image_tag(tag: &str, base_dir: Option<&Path>) -> String {
    let Some((value_start, value_end, src)) = find_src(tag) else {
        return tag.to_string();
    };

    if is_remote_src(src) {
        return with_extra_attrs(
            &replace_attr_value(tag, value_start, value_end, IMAGE_PLACEHOLDER),
            &format!(
                r#" class="remote-image is-blocked" data-remote-src="{}""#,
                escape_attr(src)
            ),
        );
    }

    match local_image_data_url(src, base_dir) {
        Some(data_url) => replace_attr_value(tag, value_start, value_end, &data_url),
        None => with_extra_attrs(
            &replace_attr_value(tag, value_start, value_end, IMAGE_PLACEHOLDER),
            r#" class="broken-image""#,
        ),
    }
}

fn find_src(tag: &str) -> Option<(usize, usize, &str)> {
    let lower = tag.to_ascii_lowercase();
    let bytes = tag.as_bytes();
    let mut search_from = 0;

    while let Some(relative_start) = lower[search_from..].find("src") {
        let attr_start = search_from + relative_start;
        let before_src = attr_start.checked_sub(1).map(|index| bytes[index]);

        if before_src.is_some_and(|byte| !byte.is_ascii_whitespace()) {
            search_from = attr_start + 3;
            continue;
        }

        let mut cursor = attr_start + 3;
        while cursor < bytes.len() && bytes[cursor].is_ascii_whitespace() {
            cursor += 1;
        }

        if cursor >= bytes.len() || bytes[cursor] != b'=' {
            search_from = attr_start + 3;
            continue;
        }

        cursor += 1;
        while cursor < bytes.len() && bytes[cursor].is_ascii_whitespace() {
            cursor += 1;
        }

        if cursor >= bytes.len() {
            return None;
        }

        if bytes[cursor] == b'"' || bytes[cursor] == b'\'' {
            let quote = bytes[cursor];
            let value_start = cursor + 1;
            let value_end = bytes[value_start..]
                .iter()
                .position(|byte| *byte == quote)?
                + value_start;
            return Some((value_start, value_end, &tag[value_start..value_end]));
        }

        let value_start = cursor;
        let value_end = bytes[value_start..]
            .iter()
            .position(|byte| byte.is_ascii_whitespace() || *byte == b'>')
            .map_or(bytes.len(), |offset| value_start + offset);
        return Some((value_start, value_end, &tag[value_start..value_end]));
    }

    None
}

fn replace_attr_value(tag: &str, start: usize, end: usize, value: &str) -> String {
    let value = escape_attr(value);

    if start
        .checked_sub(1)
        .is_some_and(|index| matches!(tag.as_bytes()[index], b'"' | b'\''))
    {
        format!("{}{}{}", &tag[..start], value, &tag[end..])
    } else {
        format!("{}\"{}\"{}", &tag[..start], value, &tag[end..])
    }
}

fn with_extra_attrs(tag: &str, attrs: &str) -> String {
    if let Some(prefix) = tag.strip_suffix(" />") {
        format!("{prefix}{attrs} />")
    } else if let Some(prefix) = tag.strip_suffix('>') {
        format!("{prefix}{attrs}>")
    } else {
        tag.to_string()
    }
}

fn local_image_data_url(src: &str, base_dir: Option<&Path>) -> Option<String> {
    if src.starts_with("data:") {
        return is_image_data_url(src).then(|| src.to_string());
    }

    let path = local_image_path(src, base_dir)?;
    let mime = image_mime_type(&path)?;
    let metadata = fs::metadata(&path).ok()?;

    if metadata.len() > MAX_INLINE_IMAGE_BYTES {
        return None;
    }

    let bytes = fs::read(path).ok()?;
    Some(format!(
        "data:{mime};base64,{}",
        general_purpose::STANDARD.encode(bytes)
    ))
}

fn is_image_data_url(src: &str) -> bool {
    let src = src.to_ascii_lowercase();
    [
        "data:image/gif;",
        "data:image/jpeg;",
        "data:image/png;",
        "data:image/svg+xml;",
        "data:image/webp;",
    ]
    .iter()
    .any(|prefix| src.starts_with(prefix))
}

fn local_image_path(src: &str, base_dir: Option<&Path>) -> Option<PathBuf> {
    let path = Path::new(src);

    if path.is_absolute() {
        return Some(path.to_path_buf());
    }

    let base_dir = base_dir?;
    let joined = base_dir.join(path);
    let base = base_dir.canonicalize().ok()?;
    let image = joined.canonicalize().ok()?;

    image.starts_with(base).then_some(image)
}

fn image_mime_type(path: &Path) -> Option<&'static str> {
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "gif" => Some("image/gif"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "png" => Some("image/png"),
        "webp" => Some("image/webp"),
        _ => None,
    }
}

fn is_remote_src(src: &str) -> bool {
    src.starts_with("http://") || src.starts_with("https://")
}

fn escape_attr(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

#[cfg(test)]
mod tests {
    use super::render_markdown_document;

    #[test]
    fn markdown_document_renders_visible_safe_html() {
        let html = render_markdown_document(
            "# Hello\n\n- one\n- two\n\n[site](https://example.com)\n\n<script>alert('x')</script>\n\n<img src=x onerror=alert(1)>",
            None,
        );

        assert!(html.contains("<h1>Hello</h1>"));
        assert!(html.contains("<li>one</li>"));
        assert!(html.contains(r#"<a href="https://example.com""#));
        assert!(!html.contains("<script"));
        assert!(!html.contains("onerror"));
    }

    #[test]
    fn markdown_document_blocks_non_image_data_url() {
        let html = render_markdown_document(
            r#"<img src='data:text/html;base64,PHNjcmlwdD5hPC9zY3JpcHQ+'>"#,
            None,
        );

        assert!(!html.contains("data:text/html"));
        assert!(html.contains("broken-image"));
    }

    #[test]
    fn markdown_document_renders_gfm() {
        let html = render_markdown_document(
            "~done~\n\n- [x] ship\n\n| A | B |\n|---|---|\n| C | D |\n\n<xmp>blocked</xmp>",
            None,
        );

        assert!(html.contains("<del>done</del>"));
        assert!(html.contains(r#"<input type="checkbox" checked="" disabled=""> ship"#));
        assert!(html.contains("<table>"));
        assert!(html.contains("<td>C</td>"));
        assert!(!html.contains("<xmp>"));
    }

    #[test]
    fn markdown_document_preserves_mermaid_fence_marker() {
        let html = render_markdown_document(
            "```mermaid\ngraph TD\n  A --> B\n```\n\n<code class=\"language-bad\">x</code>",
            None,
        );

        assert!(html.contains(r#"<pre lang="mermaid"><code"#));
        assert!(!html.contains("language-bad"));
    }

    #[test]
    fn markdown_document_preserves_code_fence_language() {
        let html = render_markdown_document("```rust\nfn main() {}\n```", None);

        assert!(html.contains(r#"<pre lang="rust"><code"#));
    }
}
