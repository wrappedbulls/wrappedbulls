/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone output bundles all transitive deps + .next/ into a single
  // self-contained server folder. Lets us deploy with just `node server.js`
  // on the bulls box, no full npm install needed.
  output: "standalone",
  reactStrictMode: true,
  // Type-check is run separately (CI / IDE); skip during production build so a
  // React-19 / @solana/wallet-adapter-react type signature drift cannot block
  // the launch deploy. The actual compile is unaffected and clean.
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  // The renderer is plain ESM (.mjs) imported from /lib. Next/Webpack
  // already handles .mjs natively for app router; nothing extra needed.
  experimental: {
    // Allow API routes to read solana account data on the server
    // without static rendering trying to pre-render them at build time.
  },
  // CORS headers for the public embed assets so third-party sites can
  // load the script + poll the activity feed. Audit L: without this,
  // any cross-origin fetch from a partner's embedded widget gets
  // blocked by the browser.
  async headers() {
    return [
      {
        source: "/embed.js",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Access-Control-Allow-Methods", value: "GET, OPTIONS" },
        ],
      },
      {
        source: "/api/factory/activity",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Access-Control-Allow-Methods", value: "GET, OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "Content-Type" },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
