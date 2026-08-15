/**
 * PostCSS exists in this repo for exactly one plugin: Tailwind v4, which
 * processes app/design/ledger.css (the LEDGER design system — see
 * docs/design/LEDGER.md). The old INSTRUMENT stylesheets (tokens.css,
 * system.generated.css) pass through untouched; Tailwind only transforms
 * files that import it.
 */
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
