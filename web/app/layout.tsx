import type { Metadata } from "next";
import "./globals.css";
import Header from "./components/Header";
import Footer from "./components/Footer";
import WalletProviders from "./components/WalletProviders";
import { getBrand } from "@/lib/brand";

const brand = getBrand();
const siteUrl = `https://${brand.domain}`;
const twitterHandle = brand.social.twitter;
const githubUrl = brand.social.github;
const ogImage = brand.art.og_image_path;
const otherMeta: Record<string, string> = {
  // Solana ecosystem signals — what wallet/marketplace crawlers look for
  // when deciding whether a dApp is trustworthy enough to allow connect.
  "solana:network": "mainnet-beta",
  "solana:program-id": brand.programId,
};
if (githubUrl) otherMeta["dapp:source"] = githubUrl;
if (twitterHandle) otherMeta["dapp:twitter"] = brand.social.twitter_url ?? "";

export const metadata: Metadata = {
  title: `${brand.name} — ${brand.copy.tagline}`,
  description: brand.copy.description,
  metadataBase: new URL(siteUrl),
  applicationName: brand.name,
  authors: githubUrl ? [{ name: brand.name, url: githubUrl }] : [{ name: brand.name }],
  creator: brand.name,
  publisher: brand.name,
  keywords: [
    "solana", "pump.fun", "memecoin", "nft", "metaplex",
    `$${brand.ticker}`, brand.name,
  ],
  category: "decentralized-application",
  alternates: { canonical: siteUrl },
  openGraph: {
    title: brand.name,
    description: brand.copy.tagline,
    url: siteUrl,
    siteName: brand.name,
    type: "website",
    images: [ogImage],
  },
  twitter: {
    card: "summary_large_image",
    site: twitterHandle ?? undefined,
    creator: twitterHandle ?? undefined,
    images: [ogImage],
  },
  icons: { icon: brand.art.mascot_path },
  other: otherMeta,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <WalletProviders>
          <Header />
          {children}
          <Footer />
        </WalletProviders>
      </body>
    </html>
  );
}
