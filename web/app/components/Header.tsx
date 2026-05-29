"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import ConnectButton from "./ConnectButton";

const NAV = [
  { href: "/", label: "HOME" },
  { href: "/wrap", label: "WRAP" },
  { href: "/unwrap", label: "UNWRAP" },
  { href: "/gallery", label: "GALLERY" },
  { href: "/deflation", label: "DEFLATION" },
  { href: "/art", label: "ART" },
  { href: "/thesis", label: "THESIS" },
  { href: "/tech", label: "TECH" },
  { href: "/security", label: "SECURITY" },
  { href: "/status", label: "STATUS" },
];

export default function Header() {
  const pathname = usePathname();
  return (
    <nav className="topnav">
      <div className="brand">
        <span className="dot" />WRAPPEDBULLS &nbsp;//&nbsp;
        <a href="/" style={{ textDecoration: "none", fontWeight: 400 }}>wrappedbulls.com</a>
      </div>
      <div className="links">
        {NAV.map((n) => {
          const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
          return (
            <Link key={n.href} href={n.href} className={active ? "current" : ""}>
              {n.label}
            </Link>
          );
        })}
      </div>
      <div className="meta">
        <ConnectButton />
      </div>
    </nav>
  );
}
