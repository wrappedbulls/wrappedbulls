import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        bull: {
          bg: "#0a0a0c",
          card: "#15151a",
          accent: "#f0d028", // mog yellow — the accent color of the brand
          ink: "#e8e4dc",
          dim: "#888",
        },
      },
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
