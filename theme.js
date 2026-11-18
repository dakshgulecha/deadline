// Runs before the stylesheet so the page never flashes the wrong theme.
// (External file instead of inline so the Content-Security-Policy can block inline scripts.)
try {
  const stored = localStorage.getItem("deadline-theme");
  document.documentElement.dataset.theme = stored || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
} catch {
  document.documentElement.dataset.theme = "light";
}
