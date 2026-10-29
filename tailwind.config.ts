import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["'Playfair Display'", "Georgia", "serif"],
        serif: ["'Playfair Display'", "Georgia", "serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      colors: {
        midnight: { DEFAULT: "hsl(var(--midnight))", deep: "hsl(var(--midnight-deep))" },
        limestone: "hsl(var(--limestone))",
        paper: "hsl(var(--paper))",
        spruce: "hsl(var(--spruce))",
        bronze: { DEFAULT: "hsl(var(--bronze))", ink: "hsl(var(--bronze-ink))", light: "hsl(var(--bronze-light))" },
        sand: { DEFAULT: "hsl(var(--sand))", hover: "hsl(var(--sand-hover))" },
        brick: "hsl(var(--brick))",
        pw: {
          navy: "hsl(var(--pw-navy))",
          amber: "hsl(var(--pw-amber))",
          sand: "hsl(var(--pw-sand))",
          paper: "hsl(var(--pw-paper))",
          slate: "hsl(var(--pw-slate))",
          ash: "hsl(var(--pw-ash))",
          mist: "hsl(var(--pw-mist))",
          cloud: "hsl(var(--pw-cloud))",
        },

        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
          dark: "hsl(var(--ink-muted-dark))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        sanctuary: {
          green: "hsl(var(--sanctuary-green))",
          bronze: "hsl(var(--sanctuary-bronze))",
          stone: "hsl(var(--sanctuary-stone))",
          charcoal: "hsl(var(--sanctuary-charcoal))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "var(--radius-sm)",
      },

      keyframes: {
        "accordion-down": {
          from: {
            height: "0",
          },
          to: {
            height: "var(--radix-accordion-content-height)",
          },
        },
        "accordion-up": {
          from: {
            height: "var(--radix-accordion-content-height)",
          },
          to: {
            height: "0",
          },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate"), require("@tailwindcss/typography")],
} satisfies Config;
