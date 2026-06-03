/* WrappedBulls Factory activity widget.
 *
 * Drop-in script for any third-party site to render a live feed of
 * recent wraps + deployments for a specific WrappedX (or the whole
 * Factory). Vanilla JS, no dependencies. Styles are self-contained
 * via a single <style> tag injected into the host page.
 *
 * Usage:
 *   <script
 *     src="https://wrappedbulls.com/embed.js"
 *     data-ticker="WDOGE"    // optional, filter to a single deployment
 *     data-mint="..."        // optional, filter by token mint
 *     data-limit="10"        // optional, max items (default 10, max 50)
 *     data-theme="dark"      // optional, "light" (default) or "dark"
 *   ></script>
 *
 * Polls /api/factory/activity every 30 seconds. The script tag itself
 * is replaced in the DOM by the widget root, so authors can position
 * the widget by where they place the <script>.
 */
(function () {
  "use strict";

  // Discover our own script tag so we can read data-attrs + locate the
  // mount point. document.currentScript is reliable during execution.
  var self = document.currentScript;
  if (!self) return;

  var ticker = self.getAttribute("data-ticker") || null;
  var mint = self.getAttribute("data-mint") || null;
  var limit = parseInt(self.getAttribute("data-limit") || "10", 10);
  if (isNaN(limit) || limit < 1) limit = 10;
  if (limit > 50) limit = 50;
  var theme = self.getAttribute("data-theme") === "dark" ? "dark" : "light";

  // Determine the origin to fetch from. If the script src is absolute we
  // use that origin; otherwise default to wrappedbulls.com. This lets
  // dev iteration work against localhost too.
  var origin;
  try {
    var srcUrl = new URL(self.src, location.href);
    origin = srcUrl.origin;
  } catch (e) {
    origin = "https://wrappedbulls.com";
  }

  // Inject self-contained styles once. Scoped to the .wbf-widget class
  // so they don't bleed into the host page.
  if (!document.getElementById("wbf-embed-styles")) {
    var s = document.createElement("style");
    s.id = "wbf-embed-styles";
    s.textContent =
      ".wbf-widget{font-family:'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;line-height:1.5;border:2px solid #0a0a0a;background:#f8f7f2;color:#0a0a0a;max-width:520px;margin:0 auto}" +
      ".wbf-widget.wbf-dark{background:#0a0a0a;color:#f8f7f2;border-color:#d4a017}" +
      ".wbf-widget .wbf-head{padding:10px 14px;border-bottom:2px solid #0a0a0a;display:flex;justify-content:space-between;align-items:center;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;font-weight:800}" +
      ".wbf-widget.wbf-dark .wbf-head{border-color:#333}" +
      ".wbf-widget .wbf-pulse{display:inline-block;width:8px;height:8px;background:#d4a017;margin-right:8px;vertical-align:middle;animation:wbf-pulse 2s ease-in-out infinite}" +
      "@keyframes wbf-pulse{0%,100%{opacity:1}50%{opacity:.4}}" +
      ".wbf-widget .wbf-body{max-height:320px;overflow-y:auto}" +
      ".wbf-widget .wbf-row{display:grid;grid-template-columns:70px 90px 1fr;gap:8px;padding:8px 14px;border-bottom:1px dashed #cfcec7;align-items:center;font-size:12px}" +
      ".wbf-widget.wbf-dark .wbf-row{border-color:#333}" +
      ".wbf-widget .wbf-row:last-child{border-bottom:0}" +
      ".wbf-widget .wbf-ts{color:#6a6a6a;font-size:11px}" +
      ".wbf-widget.wbf-dark .wbf-ts{color:#888}" +
      ".wbf-widget .wbf-verb{font-size:10px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;padding:2px 6px;display:inline-block;text-align:center}" +
      ".wbf-widget .wbf-verb-deploy{background:#d4a017;color:#0a0a0a}" +
      ".wbf-widget .wbf-verb-wrap{background:#0a6b2c;color:#f8f7f2}" +
      ".wbf-widget .wbf-foot{padding:8px 14px;font-size:10px;color:#6a6a6a;text-align:right;border-top:1px dashed #cfcec7;text-transform:uppercase;letter-spacing:0.06em}" +
      ".wbf-widget.wbf-dark .wbf-foot{border-color:#333;color:#888}" +
      ".wbf-widget .wbf-foot a{color:inherit;text-decoration:underline}" +
      ".wbf-widget .wbf-empty{padding:24px 14px;text-align:center;color:#6a6a6a;font-size:12px}";
    document.head.appendChild(s);
  }

  // Build the widget root and put it where the <script> tag lives. This
  // lets the host page position the widget naturally.
  var root = document.createElement("div");
  root.className = "wbf-widget" + (theme === "dark" ? " wbf-dark" : "");

  var headLabel = ticker
    ? "$" + ticker.toUpperCase() + " activity"
    : "wrappedbulls factory activity";
  root.innerHTML =
    '<div class="wbf-head"><span><span class="wbf-pulse"></span>' +
    escapeHtml(headLabel) +
    "</span><span>LIVE</span></div>" +
    '<div class="wbf-body" data-wbf-body><div class="wbf-empty">loading…</div></div>' +
    '<div class="wbf-foot">powered by <a href="' +
    origin +
    '/launch" target="_blank" rel="noopener">wrappedbulls factory</a></div>';

  self.parentNode.insertBefore(root, self);

  var body = root.querySelector("[data-wbf-body]");

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function timeAgo(unixSec) {
    var delta = Math.floor(Date.now() / 1000) - unixSec;
    if (delta < 60) return delta + "s ago";
    if (delta < 3600) return Math.floor(delta / 60) + "m ago";
    if (delta < 86400) return Math.floor(delta / 3600) + "h ago";
    return Math.floor(delta / 86400) + "d ago";
  }

  function renderRow(e) {
    if (e.kind === "deploy") {
      return (
        '<div class="wbf-row">' +
        '<div class="wbf-ts">' + escapeHtml(timeAgo(e.createdAt)) + "</div>" +
        '<div><span class="wbf-verb wbf-verb-deploy">DEPLOY</span></div>' +
        "<div>" + escapeHtml(e.name) + " <span style=\"color:#6a6a6a\">($" + escapeHtml(e.ticker) + ")</span></div>" +
        "</div>"
      );
    }
    // wrap
    return (
      '<div class="wbf-row">' +
      '<div class="wbf-ts">' + escapeHtml(timeAgo(e.wrappedAt)) + "</div>" +
      '<div><span class="wbf-verb wbf-verb-wrap">WRAP</span></div>' +
      "<div>" +
        escapeHtml(e.collectionName) + " #" + e.tierIndex +
      "</div>" +
      "</div>"
    );
  }

  function refresh() {
    var url = origin + "/api/factory/activity?limit=" + limit;
    if (ticker) url += "&ticker=" + encodeURIComponent(ticker);
    if (mint) url += "&mint=" + encodeURIComponent(mint);
    fetch(url, { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (json) {
        if (!json || !json.ok) {
          body.innerHTML = '<div class="wbf-empty">' + escapeHtml(json && json.error ? json.error : "load failed") + "</div>";
          return;
        }
        var events = json.events || [];
        if (events.length === 0) {
          body.innerHTML = '<div class="wbf-empty">' + (ticker ? "no activity yet for $" + escapeHtml(ticker) : "no factory activity yet") + ". be the first.</div>";
          return;
        }
        body.innerHTML = events.map(renderRow).join("");
      })
      .catch(function (e) {
        body.innerHTML = '<div class="wbf-empty">' + escapeHtml(e.message || "network error") + "</div>";
      });
  }

  refresh();
  setInterval(refresh, 30000);
})();
