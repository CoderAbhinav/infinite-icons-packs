# infinite-icons-packs

Build pipeline that turns popular open-source icon sets into **packs** for the
[Infinite Icons](https://github.com/CoderAbhinav/infinite-icons) WordPress plugin, which
registers them with the WordPress 7.1 Icon API so they show up in the core Icon block,
a shortcode, ACF / SCF, Gravity Forms and Elementor.

Pack zips and `index.json` are published as GitHub Release assets; the index is also
committed to `main` at [`dist-index/index.json`](dist-index/index.json) and consumed by the
plugin through jsDelivr:

```
https://cdn.jsdelivr.net/gh/CoderAbhinav/infinite-icons-packs@main/dist-index/index.json
```

## Why a pipeline at all

WordPress core sanitizes every registered icon with `wp_kses()` against a fixed allowlist:
only `<svg>`, `<path>` and `<polygon>` survive, every `stroke*` attribute is removed and
`fill` is only kept on `<path>`/`<polygon>`. Stroke-based sets (Lucide, Tabler outline,
Heroicons outline) would render as nothing. The pipeline therefore converts every icon at
build time into the **canonical format**:

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="currentColor" d="…"/></svg>
```

* one or more `<path>` elements, `fill="currentColor"`, optional `fill-rule="evenodd"`
* the pack's native `viewBox` (Font Awesome stays 512×512 / 640×512), no `width`/`height`
* no comments, ids, classes, styles or transforms

`wp_kses()` still rewrites two cosmetic things (`viewBox` → `viewbox`, `/>` → ` />`); the
files keep the correct XML spelling because they are also used as standalone SVG (Elementor
mask data-URIs, previews). The validators account for that.

## How an icon is processed (`src/normalize.mjs`)

1. Parse with `svgson`; reject `<image>`, `<text>`, `<use>`, `<filter>`, gradients, `<style>`, …
2. Flatten groups and apply `transform`s into the coordinates (`svgpath`).
3. Convert `circle|ellipse|rect|line|polyline|polygon` to paths (`element-to-path`).
4. **Stroke packs**: flatten curves, expand each stroke with Clipper polygon offsetting using
   the effective `stroke-width` / `linecap` / `linejoin`, then boolean-**unite** everything
   (including filled dots) into one compound path and re-fit the polygon with cubic Béziers
   (`fit-curve`). Straight source edges stay straight lines.
5. **Fill packs**: strip `stroke*`, keep geometry and `fill-rule`.
6. `svgo` (`preset-default`, `floatPrecision: 2`), then re-serialize into the canonical format.

> **Deviation from the original plan:** the plan named paper.js for stroke → fill. paper.js has no
> stroke-expansion API; the only npm wrappers are a placeholder package or bitmap tracing. Clipper
> offsetting is exact for round caps/joins (the stroke of a polyline is its Minkowski sum with a
> disc) and its integer arithmetic is robust for the many coincident edges a union produces.

`packs.config.mjs` may list icons under `inkscapeFallback`; those are converted with the
Inkscape CLI (`object-stroke-to-path` + `path-union`) instead. Lucide needs none.

## Validation (the build fails on any violation)

| Check | What | Where |
|---|---|---|
| kses | Node port of `wp_kses()` with the core allowlist: output must equal the input modulo the two cosmetic rewrites, and be idempotent; strict canonical byte format | `src/validate-kses.mjs` |
| visual | resvg renders upstream and output at 96 px; `pixelmatch` (`threshold: 0.1`); fail above **1 %** of pixels; 50 worst diffs → `dist/report/<pack>.html` | `src/validate-visual.mjs` |
| schema | `manifest.json` against `schemas/manifest.schema.json` (ajv, strict) | `src/manifest.mjs` |
| names | `^[a-z0-9]([a-z0-9_-]*[a-z0-9])?$`, unique per pack, previews exist | `src/build.mjs` |

Ground truth against a real WordPress install (needs WP-CLI):

```sh
WP_PATH=/path/to/wordpress node scripts/validate-kses-wp.mjs dist/lucide
```

## Usage

```sh
npm ci
npm test                      # unit tests (geometry, kses port, normalizer)
npm run build                 # all packs → dist/*.zip, dist/index.json, dist/report/
npm run build lucide          # one pack
node src/build.mjs lucide --limit=50 --skip-visual   # quick iteration
npm run upstream:check        # bump upstream-versions.json to the latest npm versions
```

Upstream packages are installed into `.cache/upstream/` at the versions pinned in
`upstream-versions.json`. `RELEASE_TAG` (set by the release workflow) is used for the
download URLs written to `index.json`.

## Pack artifact

`dist/<slug>-<upstream>-ii.<n>.zip` (GitHub rewrites `+` in asset names, so the file name
uses `-` where the version string uses `+`):

```
<slug>/
├── manifest.json        schema 1, see schemas/manifest.schema.json
├── LICENSE              upstream license, copied verbatim
├── ATTRIBUTION.md
├── icons/<name>.svg     canonical SVGs; variants are suffixes (heart, heart-solid, …)
└── elementor/
    ├── elementor.css    .ii-<slug> base class + one mask-image class per icon
    └── icons.json       {"icons":[…]} for Elementor's icon picker (fetchJson)
```

Pack version = `<upstream semver>+ii.<PIPELINE_REVISION>`; bump `PIPELINE_REVISION` in
`packs.config.mjs` whenever the pipeline output changes for the same upstream version.

## Aliases

`lucide-static` ships alias files (old names with identical content, e.g. `scatter-chart` for
`chart-scatter`). Files whose base name is not in `icon-nodes.json` and whose content matches a
canonical icon are not shipped as separate icons; their names are added to the canonical icon's
keywords so search still finds them. The build log reports how many were folded.

## Adding a pack

1. Pin the npm package in `upstream-versions.json`.
2. Add an entry to `PACKS` in `packs.config.mjs`: slug, label, upstream, license, `geometry`
   (`stroke` or `fill`), stroke defaults, variants (`key` = name suffix, `dir` = folder in the
   package), keyword loader, 8 preview names.
3. `npm run build <slug>`, open `dist/report/<slug>.html`, fix or list fallbacks, commit.

## Workflows

* `build.yml` — on push/PR: tests, full build, uploads `validation-report` and `packs` artifacts.
* `upstream-check.yml` — weekly: bumps pins, builds, opens a PR with the report attached.
* `release.yml` — on tag `vX.Y.Z`: builds with `RELEASE_TAG`, attaches `dist/*.zip` +
  `index.json` to the GitHub Release, commits `dist-index/index.json` to `main`.

## License

Pipeline code: GPL-3.0-or-later. Each pack keeps its upstream license (see the `LICENSE`
and `ATTRIBUTION.md` inside every zip).
