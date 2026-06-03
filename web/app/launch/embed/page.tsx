// /launch/embed — embeddable widget demo + docs.
//
// Two purposes:
//   1. Live preview of the widget so deployers can see it before adding
//      to their own site.
//   2. Copy-paste snippet they can drop into their HTML.
//
// We render the widget by injecting the same <script src="/embed.js">
// the docs document. It runs the same code third-party sites would run,
// so what you see here is exactly what they'll see.

"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

export default function EmbedDemoPage() {
  const [ticker, setTicker] = useState("");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [copied, setCopied] = useState(false);
  const mountRef = useRef<HTMLDivElement>(null);

  // Mount the widget script. Re-runs whenever ticker/theme change so the
  // preview reflects the snippet a deployer would actually paste.
  useEffect(() => {
    if (!mountRef.current) return;
    mountRef.current.innerHTML = ""; // tear down previous widget
    const s = document.createElement("script");
    s.src = "/embed.js";
    if (ticker) s.setAttribute("data-ticker", ticker);
    s.setAttribute("data-theme", theme);
    s.setAttribute("data-limit", "10");
    mountRef.current.appendChild(s);
  }, [ticker, theme]);

  // Compute the embed origin from the actual page origin so the snippet
  // works correctly on staging / preview / localhost without hardcoding
  // wrappedbulls.com. Falls back to wrappedbulls.com during SSR (where
  // window is undefined) since the snippet is mostly copy/pasted in the
  // browser anyway.
  const embedOrigin =
    typeof window !== "undefined" ? window.location.origin : "https://wrappedbulls.com";
  const snippet =
    `<script\n  src="${embedOrigin}/embed.js"` +
    (ticker ? `\n  data-ticker="${ticker}"` : "") +
    (theme === "dark" ? `\n  data-theme="dark"` : "") +
    `\n  data-limit="10"\n></script>`;

  return (
    <main className="max-w-4xl mx-auto px-4 sm:px-6 py-12">
      <div className="mb-8">
        <div style={{ color: "var(--bull-dim)", fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>
          factory / embed
        </div>
        <h1 className="h1">EMBEDDABLE ACTIVITY WIDGET</h1>
        <p className="text-[var(--bull-dim)] mt-3 text-sm" style={{ maxWidth: 720 }}>
          drop a live wrap+deploy feed into any third-party site with one
          script tag. polls every 30 seconds. vanilla JS, no dependencies,
          self-contained styles. show your community what is happening in
          your wrap layer, hosted by wrappedbulls.com.
        </p>
      </div>

      <section style={{ marginBottom: 32 }}>
        <SectionHead marker="01" title="CONFIGURE" />
        <div className="card" style={{ padding: 24 }}>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--bull-dim)" }}>
              filter to a ticker (empty = all Factory activity)
            </div>
            <input
              value={ticker}
              onChange={(e) => setTicker(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
              maxLength={10}
              placeholder="WDOGE"
              style={{
                width: "100%",
                padding: "10px 12px",
                marginTop: 6,
                border: "2px solid var(--bull-ink)",
                background: "var(--bull-paper)",
                fontFamily: "inherit",
                fontSize: 14,
              }}
            />
          </div>
          <div>
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--bull-dim)", marginBottom: 6 }}>
              theme
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                onClick={() => setTheme("light")}
                className={theme === "light" ? "btn btn-primary" : "btn btn-secondary"}
              >
                [ LIGHT ]
              </button>
              <button
                type="button"
                onClick={() => setTheme("dark")}
                className={theme === "dark" ? "btn btn-primary" : "btn btn-secondary"}
              >
                [ DARK ]
              </button>
            </div>
          </div>
        </div>
      </section>

      <section style={{ marginBottom: 32 }}>
        <SectionHead marker="02" title="LIVE PREVIEW" />
        <div className="card" style={{ padding: 24, background: theme === "dark" ? "#1a1a1a" : "var(--bull-very-soft)" }}>
          <div ref={mountRef} />
        </div>
      </section>

      <section>
        <SectionHead marker="03" title="COPY THIS SNIPPET" />
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <pre
            style={{
              margin: 0,
              padding: 20,
              fontSize: 13,
              background: "#0a0a0a",
              color: "#d4d4cf",
              fontFamily: "inherit",
              whiteSpace: "pre",
              overflowX: "auto",
            }}
          >
            {snippet}
          </pre>
          <div style={{ padding: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 11, color: "var(--bull-dim)" }}>
              paste anywhere in your HTML. the widget renders where the script tag lives.
            </span>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard?.writeText(snippet).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                });
              }}
              className="btn"
              style={{ fontSize: 11, padding: "6px 12px" }}
            >
              [ {copied ? "COPIED ✓" : "COPY"} ]
            </button>
          </div>
        </div>
      </section>

      <div style={{ textAlign: "center", marginTop: 48 }}>
        <Link href="/launch" className="btn btn-secondary">[ ← FACTORY HOME ]</Link>
      </div>
    </main>
  );
}

function SectionHead({ marker, title }: { marker: string; title: string }) {
  return (
    <div className="flex items-baseline gap-4 mb-4">
      <div style={{ fontWeight: 800 }}>{marker}</div>
      <div className="h2">{title}</div>
      <div style={{ flex: 1, borderTop: "2px solid var(--bull-ink)", height: 0, transform: "translateY(-6px)" }} />
    </div>
  );
}
