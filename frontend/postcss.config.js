// Tailwind v4 is wired in through the official `@tailwindcss/vite` plugin
// (see vite.config.ts), which runs its own transform pipeline. PostCSS is kept
// only for autoprefixer parity with any non-Tailwind CSS that is imported.
export default {
  plugins: {},
};
