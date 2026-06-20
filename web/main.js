const openButton = document.getElementById("open");
const pathLabel = document.getElementById("path");
const viewer = document.getElementById("viewer");

const tauri = window.__TAURI__;

function showError(message) {
  viewer.className = "viewer error";
  viewer.textContent = message;
}

async function openMarkdownDocument(path) {
  try {
    viewer.className = "viewer loading";
    viewer.textContent = "Loading...";
    const document = await tauri.core.invoke("open_markdown_document", { path });
    pathLabel.textContent = document.path;
    viewer.className = "viewer";
    viewer.innerHTML = document.html;
  } catch (error) {
    showError(String(error));
  }
}

openButton.addEventListener("click", async () => {
  const path = await tauri.dialog.open({
    multiple: false,
    filters: [{ name: "Markdown", extensions: ["md"] }]
  });

  if (path) {
    await openMarkdownDocument(path);
  }
});

window.addEventListener("DOMContentLoaded", async () => {
  const paths = await tauri.core.invoke("initial_markdown_paths");

  if (paths.length > 0) {
    await openMarkdownDocument(paths[0]);
  }
});
