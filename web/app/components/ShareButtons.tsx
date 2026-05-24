"use client";

import { useState } from "react";

interface ShareButtonsProps {
  tier: number;
  bodyName: string;
}

export default function ShareButtons({ tier, bodyName }: ShareButtonsProps) {
  const [copied, setCopied] = useState(false);

  const url = typeof window !== "undefined" ? `${window.location.origin}/bull/${tier}` : `https://wrappedbulls.com/bull/${tier}`;
  const tweetText = `WrappedBulls #${tier} - a ${bodyName} bull holding 1,000,000 $WBULL. The vault follows the NFT. 🐂`;
  const tweetIntent = `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetText)}&url=${encodeURIComponent(url)}`;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // fallback: select-and-copy not implemented; ignore on rare browsers
    }
  }

  return (
    <>
      <a
        href={tweetIntent}
        target="_blank"
        rel="noopener noreferrer"
        className="btn btn-secondary text-sm"
        aria-label="Share on X"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={{ marginRight: 6 }}>
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.66l-5.214-6.819L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
        Share on X
      </a>
      <button
        onClick={copyLink}
        className="btn btn-secondary text-sm"
        aria-label="Copy link"
        type="button"
      >
        {copied ? "✓ Copied" : "Copy link"}
      </button>
    </>
  );
}
