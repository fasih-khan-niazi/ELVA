/** @type {import('tailwindcss').Config} */
export default {
    darkMode: ['class'],
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            fontFamily: {
                sans: ["DM Sans", "system-ui", "sans-serif"],
            },
            borderRadius: {
                lg: "var(--radius)",
                md: "calc(var(--radius) - 2px)",
                sm: "calc(var(--radius) - 4px)",
                xl: "calc(var(--radius) + 4px)",
            },
            colors: {
                background: "var(--background)",
                foreground: "var(--foreground)",
                card: {
                    DEFAULT: "var(--card)",
                    foreground: "var(--card-foreground)",
                },
                popover: {
                    DEFAULT: "var(--popover)",
                    foreground: "var(--popover-foreground)",
                },
                primary: {
                    DEFAULT: "var(--primary)",
                    foreground: "var(--primary-foreground)",
                },
                secondary: {
                    DEFAULT: "var(--secondary)",
                    foreground: "var(--secondary-foreground)",
                },
                muted: {
                    DEFAULT: "var(--muted)",
                    foreground: "var(--muted-foreground)",
                },
                accent: {
                    DEFAULT: "var(--accent)",
                    foreground: "var(--accent-foreground)",
                },
                destructive: {
                    DEFAULT: "var(--destructive)",
                    foreground: "var(--destructive-foreground)",
                },
                border: "var(--border)",
                input: "var(--input)",
                ring: "var(--ring)",
                chart: {
                    1: "var(--chart-1)",
                    2: "var(--chart-2)",
                    3: "var(--chart-3)",
                    4: "var(--chart-4)",
                    5: "var(--chart-5)",
                },
                sidebar: {
                    DEFAULT: "var(--sidebar)",
                    foreground: "var(--sidebar-foreground)",
                    primary: "var(--sidebar-primary)",
                    "primary-foreground": "var(--sidebar-primary-foreground)",
                    accent: "var(--sidebar-accent)",
                    "accent-foreground": "var(--sidebar-accent-foreground)",
                    border: "var(--sidebar-border)",
                    ring: "var(--sidebar-ring)",
                },
                ocean: {
                    navy: "#03045E",
                    deep: "#023E8A",
                    rich: "#0077B6",
                    bright: "#0096C7",
                    sky: "#00B4D8",
                    aqua: "#48CAE4",
                    mist: "#90E0EF",
                    ice: "#ADE8F4",
                    powder: "#CAF0F8",
                },
            },
            boxShadow: {
                ocean:
                    "0 16px 48px -12px rgba(3, 4, 94, 0.18)",
                "ocean-sm": "0 2px 16px rgba(3, 4, 94, 0.08)",
                "ocean-card":
                    "0 4px 28px -6px rgba(2, 62, 138, 0.12), 0 0 0 1px rgba(173, 232, 244, 0.65)",
                "ocean-inner": "inset 0 1px 0 rgba(255, 255, 255, 0.72)",
            },
            keyframes: {
                shrink: {
                    "0%": { transform: "scaleX(1)" },
                    "100%": { transform: "scaleX(0)" },
                },
                "fade-up": {
                    "0%": { opacity: "0", transform: "translateY(16px)" },
                    "100%": { opacity: "1", transform: "translateY(0)" },
                },
                float: {
                    "0%, 100%": { transform: "translateY(0px)" },
                    "50%": { transform: "translateY(-10px)" },
                },
                shimmer: {
                    "0%": { backgroundPosition: "200% 0" },
                    "100%": { backgroundPosition: "-200% 0" },
                },
                "pulse-soft": {
                    "0%, 100%": { opacity: "1" },
                    "50%": { opacity: "0.7" },
                },
                blob: {
                    "0%, 100%": {
                        transform: "translate(0px, 0px) scale(1)",
                    },
                    "33%": {
                        transform: "translate(24px, -36px) scale(1.05)",
                    },
                    "66%": {
                        transform: "translate(-16px, 16px) scale(0.97)",
                    },
                },
            },
            animation: {
                shrink: "shrink 5s linear forwards",
                "fade-up":
                    "fade-up 0.65s cubic-bezier(0.22, 1, 0.36, 1) forwards",
                "fade-up-delayed":
                    "fade-up 0.7s 0.1s cubic-bezier(0.22, 1, 0.36, 1) both",
                float: "float 6s ease-in-out infinite",
                shimmer: "shimmer 9s linear infinite",
                "pulse-soft": "pulse-soft 3.5s ease-in-out infinite",
                "blob-slow": "blob 14s ease-in-out infinite",
            },
            transitionTimingFunction: {
                smooth: "cubic-bezier(0.22, 1, 0.36, 1)",
                spring: "cubic-bezier(0.34, 1.56, 0.64, 1)",
            },
        },
    },
    plugins: [],
};
