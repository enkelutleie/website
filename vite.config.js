import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  appType: "mpa",
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        personvern: resolve(import.meta.dirname, "personvern/index.html"),
        notFound: resolve(import.meta.dirname, "404.html"),
      },
    },
  },
});
