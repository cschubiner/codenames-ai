// Set this to your Cloudflare Worker base URL (no trailing slash).
// Example: window.CODENAMES_API_BASE = "https://codenames-ai-online.YOURNAME.workers.dev";
//
// Local dev convenience:
// - You can pass ?api=http://localhost:PORT to override.
// - If unset/placeholder on localhost, defaults to http://localhost:8787.
(function () {
  const qs = new URLSearchParams(location.search);
  const apiOverride = qs.get("api");
  if (apiOverride) {
    window.CODENAMES_API_BASE = apiOverride.replace(/\/$/, "");
    try { localStorage.setItem("CODENAMES_API_BASE", window.CODENAMES_API_BASE); } catch {}
    return;
  }

  try {
    const stored = localStorage.getItem("CODENAMES_API_BASE");
    if (stored) {
      window.CODENAMES_API_BASE = stored.replace(/\/$/, "");
      return;
    }
  } catch {}

  if (!window.CODENAMES_API_BASE || String(window.CODENAMES_API_BASE).includes("YOUR_WORKER_URL")) {
    if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
      window.CODENAMES_API_BASE = "http://localhost:8787";
    } else {
      window.CODENAMES_API_BASE = "https://YOUR_WORKER_URL";
    }
  }
})();
