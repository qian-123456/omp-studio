Standalone omp-workspace user guide website, generated from `docs/guide/{zh,en}/*.md`.
Build with `pnpm guide:build` (or `node site/guide/build.mjs`); it writes `site/guide/index.html` and copies `docs/guide/images` to `site/guide/images`.
Deploy by serving the `site/guide/` output (`index.html` + `images/`) as static files; it also opens offline from disk.
