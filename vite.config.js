import { resolve } from "node:path";
import { defineConfig } from "vite";

function prettyPersonvern() {
  const rewrite = (req, _res, next) => {
    if (req.url === "/personvern") {
      req.url = "/personvern/";
    }
    if (req.url === "/logg-inn") {
      req.url = "/logg-inn/";
    }
    if (req.url === "/portal") {
      req.url = "/portal/";
    }
    next();
  };

  const previewNotFound = (req, _res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      next();
      return;
    }

    const path = (req.url ?? "").split("?")[0];
    const known =
      path === "/" ||
      path.startsWith("/personvern") ||
      path.startsWith("/logg-inn") ||
      path.startsWith("/portal") ||
      path.startsWith("/assets/") ||
      path.startsWith("/brand/") ||
      path.startsWith("/src/") ||
      /\.[a-zA-Z0-9]+$/.test(path);

    if (!known) {
      req.url = "/404.html";
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
      return () => {
        server.middlewares.use(previewNotFound);
      };
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
        loggInn: resolve(import.meta.dirname, "logg-inn/index.html"),
        portal: resolve(import.meta.dirname, "portal/index.html"),
        notFound: resolve(import.meta.dirname, "404.html"),
      },
    },
  },
});

