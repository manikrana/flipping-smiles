import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#FFF9F0",
          100: "#FFF0D6",
          500: "#F59E0B",
          600: "#D97706",
          900: "#78350F",
        },
      },
    },
  },
  plugins: [],
};

export default config;
