import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        // "Honey Glow" — Flipping Smiles' signature color.
        brand: {
          50: "#FFFBF2",
          100: "#FEF3DC",
          200: "#FCE4B0",
          300: "#F8D080",
          400: "#E0A84A",
          500: "#C98A2E",
          600: "#A96F20",
          700: "#855619",
          800: "#603E12",
          900: "#3A2A14",
        },
        // Dusty rose — secondary accent (badges, secondary actions), not the primary signature.
        accent: {
          50: "#FDEDF0",
          100: "#FBE0E4",
          200: "#F3B8C8",
          400: "#DE7D9B",
          500: "#C65B7C",
          600: "#A8455F",
        },
        cream: "#FAFAF7",
        ink: "#1A1A1A",
      },
      fontFamily: {
        sans: ["var(--font-dm-sans)", "system-ui", "sans-serif"],
        display: ["var(--font-fraunces)", "Georgia", "serif"],
        script: ["var(--font-grand-hotel)", "cursive"],
      },
      boxShadow: {
        warm: "0 4px 24px -4px rgba(201, 138, 46, 0.18)",
        card: "0 2px 16px -2px rgba(26, 26, 26, 0.08)",
        "card-hover": "0 8px 32px -4px rgba(26, 26, 26, 0.14)",
      },
    },
  },
  plugins: [],
};

export default config;
