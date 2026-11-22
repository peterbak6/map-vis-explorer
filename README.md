# Map Vis Explorer

An interactive classroom tool for exploring how mapping choices change what we see in spatial data: the spatial sibling of [Time Vis Explorer](https://github.com/peterbak6/time-vis-explorer). Students pick a dataset and a map type, change aggregation and visual encodings, and compare the stories the same data tells. Discussion stays in the classroom; the interface only makes every choice visible.

Built with **Vite, React, TypeScript and D3**. React owns controls and state; D3 draws the SVG. Everything runs in the browser on bundled data. See [DESIGN.md](DESIGN.md) for the full design.

## Explore

- **Map type**: Symbol · Choropleth · Cartogram · Heatmap · Flow, each with variants:
  - Symbol: circle, square
  - Choropleth: native areas, Voronoi areas (derived from points)
  - Cartogram: Dorling, Demers, non-contiguous (Olson), contiguous (Dougenik rubber-sheet, ≤ 300 units)
  - Heatmap: hex bins, square grid, pixel (kernel density)
  - Flow: straight, arc, tapered arrow
- **Aggregation**: level (e.g. county → state) and summary. Counts are summed, shares are pooled from numerator/denominator (or summarized as mean/median/min/max of units), and medians are combined only by explicit approximations.
- **Color**: measure, per-km² normalization, classing (continuous, equal interval, quantile, natural breaks), bins, scale (linear, √, log), palette, and a diverging midpoint.
- **Size**: measure and max size. Mark area is always proportional to value.
- **Appearance**: opacity, outline, projection.

Options that don't apply are disabled and say why and how to enable them. Hover for values, click to highlight, scroll to zoom, drag to pan, double-click to reset.

## Architecture

```
src/
  types.ts              dataset contract, settings, units
  data.ts               load manifest, description and GeoJSON; rewind RFC 7946 polygons for d3
  pipeline/             pure functions, tested
    aggregate.ts        aggregate features to a level; measure semantics (count/signed/ratio/median/category)
    options.ts          map types, variants, defaults, availability rules with reasons
    classify.ts         breaks: equal, quantile, Fisher–Jenks; scale transforms
    color.ts            palettes, colour scales, legend model
    geometry.ts         projections, hex/grid bins, KDE raster, Voronoi, Dorling/Demers, Olson, Dougenik, flow paths
    scene.ts            settings + units → marks, legends, title/subtitle
  ui/
    Controls.tsx        choice cards with schematics, segments, sliders, palettes
    MapView.tsx         D3 renderer: base map, marks, raster, zoom, tooltip, selection
    Legend.tsx          histogram colour legend, categorical swatches, size legend
  App.tsx               layout and state
public/data/            bundled GeoJSON datasets + manifest.json
```

Pipeline: `dataset → aggregate to level → derive geometry for the map type → normalize → classify → color/size scales → render`.

## Datasets

| Dataset | Status |
| --- | --- |
| US counties · ACS 2022 5-year | ready |
| Bergen Bysykkel · trips, July 2026 (NLOD 2.0) | ready |
| 26th Knesset election (27 Oct 2026) | planned: source to be chosen |

All data is standard GeoJSON plus a small description file; see [DATA.md](DATA.md) to add a dataset.

## Run locally

Use **Node 24.12.0** (see `.node-version`).

```sh
npm install
npm run dev
```

| Command | Purpose |
| --- | --- |
| `npm run dev` | Local development server |
| `npm test` | Aggregation semantics, classing, availability rules, geometry |
| `npm run build` | Type-check and build the static site in `dist/` |
| `npm run preview` | Serve the production build |

### Basemap tiles

With the **Mercator** projection, a web basemap can be shown under the data (Appearance → Basemap). Tiles are the only external requests the app makes.

- **OSM** works without setup: OpenStreetMap standard tiles, muted to grey; attribution is shown on the map. Fine for classroom use under the [OSM tile usage policy](https://operations.osmfoundation.org/policies/tiles/); not for heavy traffic.
- **Light / Dark / Voyager** are CARTO basemaps and need a free API key from <https://carto.com/basemaps/apikey> (free for non-commercial use within CARTO's monthly limit). Put it in `.env.local` (git-ignored) and, for deployment, as a Cloudflare Pages environment variable:

```sh
VITE_CARTO_KEY=your-key
```

Without a key those options are disabled with an explanation.

## CI

[GitHub Actions](.github/workflows/ci.yml) runs on pushes to `main`, pull requests targeting `main`, and manual runs. It uses `.node-version`, installs with `npm ci`, runs all tests, and checks types and the production build. No secrets are required.

Cloudflare Pages deploys separately through its Git integration. The CI workflow reports checks; it does not gate Cloudflare's automatic deployments. To check changes before merging, require **Test and build** in the repository's branch protection or ruleset.

## Cloudflare Pages

Connect `peterbak6/map-vis-explorer` using **Workers & Pages → Pages → Git integration** with these settings:

| Setting | Value |
| --- | --- |
| Production branch | `main` |
| Framework preset | None |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | Repository root (leave blank) |
| Environment variables | `VITE_CARTO_KEY` (optional, enables the CARTO basemaps) |

[wrangler.jsonc](wrangler.jsonc) specifies the Pages output directory, and `.node-version` selects the tested Node version. All datasets are copied from `public/` into the build; no backend or runtime bindings are needed. Pushes to `main` trigger the production deployment; Cloudflare supplies the `pages.dev` URL.

If installation fails with a lockfile mismatch, repair the lockfile with the npm version reported in the build log, verify `npm ci`, and commit the corrected `package-lock.json`.
