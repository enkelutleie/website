import { resolve } from "node:path";
import { defineConfig } from "vite";

function prettyPersonvern() {
  const rewrite = (req, _res, next) => {
    if (req.url === "/personvern") {
      req.url = "/personvern/";
    }
    next();
  };

  return {
    name: "pretty-personvern",
    configureServer(server) {
      server.middlewares.use(rewrite);
    },
    configurePreviewServer(server) {
      server.middlewares.use(rewrite);
    },
  };
}

export default defineConfig({
  appType: "mpa",
  plugins: [prettyPersonvern()],
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

