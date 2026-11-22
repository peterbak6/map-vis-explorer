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
  data.ts               load manifest, dataset JSON and base TopoJSON
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
public/data/            bundled datasets + manifest.json
scripts/                reproducible data preparation
```

Pipeline: `dataset → aggregate to level → derive geometry for the map type → normalize → classify → color/size scales → render`.

## Datasets

| Dataset | Status |
| --- | --- |
| US counties · ACS 2022 5-year | ready (`scripts/prepare_acs.py`) |
| Citi Bike · origin–destination trips | planned: source to be chosen |
| 26th Knesset election (27 Oct 2026) | planned: source to be chosen |

To add a dataset, write a JSON file following `DatasetFile` in `src/types.ts` (features with raw fields, levels, measures with a `kind`, optional `flows`) and list it in `public/data/manifest.json` with `"status": "ready"`.

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

Deployment follows Time Vis Explorer: Cloudflare Pages via Git integration, build command `npm run build`, output `dist`.
