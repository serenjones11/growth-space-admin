import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    // The one chunk over Vite's default 500 kB is ExcelJS (~940 kB), which
    // only loads when an admin clicks "Full backup".
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        // Libraries change far less often than the app, so splitting them out
        // lets browsers keep them cached across deploys.
        manualChunks: {
          react: ["react", "react-dom"],
          supabase: ["@supabase/supabase-js"],
        },
      },
    },
  },
  test: {
    environment: "node",
  },
});
