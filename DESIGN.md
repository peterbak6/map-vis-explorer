# Map Vis Explorer

## Purpose
A classroom exploration tool, the spatial sibling of Time Vis Explorer. Students pick a dataset, pick a map type, change aggregation and visual encodings, and watch the same data tell different stories. The interface teaches nothing explicitly: no lessons, challenges, "lies", or explanatory panels. Discussion happens in class. The interface's job is to make every choice visible, reversible, and honest about what is and is not a valid encoding.

## Principles (inherited from Time Vis Explorer)
- One page. A large map dominates. A narrow left panel holds schematic cards and compact controls.
- Every choice redraws the same data. Settings persist across dataset and map-type changes whenever they still make sense.
- Options that do not apply are **visibly disabled with a reason and a way to enable them**, never silently changed or hidden.
- One transformation pipeline; renderers only draw. Aggregation, normalization, classification and scale choices are stated in the map title, subtitle, legend and tooltip.
- Data semantics are enforced: counts are summed, ratios are recomputed from numerator and denominator, medians are never summed. Missing is never zero.
- Visual language: white, charcoal `#373335`, warm orange `#d94722` for active controls, muted context.

## Datasets
Every dataset is standard GeoJSON (see DATA.md): **features** (points or polygons with numeric properties), optional **flows** (LineStrings with origin, destination, volume), and a description with a hierarchy of **levels**, **measures** with explicit semantics, and attribution.

| Dataset | Geometry | Levels (fine → coarse) | Flows | Measures (kind) |
| --- | --- | --- | --- | --- |
| **US counties · ACS 2022 5-year** | areas (county polygons) | County → State | — | Population (count); White alone, Black alone, Asian alone, Hispanic/Latino (count); the same four as shares of population (ratio); Median household income (median) |
| **Bergen Bysykkel · trips** | points (stations) | Station → 300 m cluster → 1 km cluster | station → station trips | Trip starts, Trip ends (count); Net departures (signed); Mean trip duration, Weekday 07–09 share, Round-trip share (ratio) |
| **26th Knesset election · 27 Oct 2026** | points (localities) | Locality → Natural region → Sub-district → District | — | Eligible voters, Votes cast, Valid votes, Votes per party (count); Turnout, Invalid share, Party share (ratio); Leading party (category) |

Measure kinds and their aggregation rules:

| Kind | Example | Aggregating units | Allowed encodings |
| --- | --- | --- | --- |
| `count` (extensive, non-negative) | population, trip starts, votes | sum | symbol size, cartogram size, heatmap weight, flow width, color (optionally per km²) |
| `signed` (extensive, may be negative) | net departures | sum | color only (diverging); never size |
| `ratio` (numerator ÷ denominator) | Hispanic share, turnout | recompute Σnum ÷ Σden (**pooled**); alternatives: mean / median / min / max of units | color; heatmap bins (pooled) |
| `median` (non-additive) | median household income | cannot be recomputed: weighted mean of medians (approximation), median / min / max of units | color only; not in heatmap bins |
| `category` | leading party | recompute argmax from summed part counts | color (categorical palette) only |

## Map types and variants
Five map type cards. Each has variant cards that appear only for that type.

| Map type | Variants | Needs | Geometry it draws |
| --- | --- | --- | --- |
| **Symbol** | Circle · Square | any level | one mark per unit at its centroid / point. Size ← count measure (or fixed), color ← any measure |
| **Choropleth** | Native areas · Voronoi areas | areas, or points (Voronoi cells clipped to the base map / hull) | filled polygons. Color ← any measure; counts can be normalized per km² |
| **Cartogram** | Dorling · Demers · Non-contiguous · Contiguous | a count measure for size | Dorling: non-overlapping circles. Demers: non-overlapping squares. Non-contiguous: each polygon scaled about its centroid. Contiguous: rubber-sheet distortion (Dougenik), limited to ≤ 300 units |
| **Heatmap** | Hex · Grid · Pixel (KDE) | unit points with a count weight or a pooled ratio | hex bins, square bins, or a kernel-density raster. Cell size / bandwidth slider |
| **Flow** | Straight · Arc · Arrow | a flow table | OD lines at the chosen level, width ← trips, color ← volume. Top-N filter and self-flow exclusion |

Availability rules (each with a visible reason):
- Datasets can switch controls off in their description (`unavailable`), with a reason.
- Time is disabled for datasets without weekday-hour slots.
- From/To selected need a selected node; Net needs Direction All.
- Flow is disabled for datasets without origin–destination data.
- Choropleth on a point dataset offers only Voronoi areas; on an area dataset both.
- Contiguous cartograms need ≤ 300 units ("Choose State to enable").
- Non-contiguous and contiguous cartograms need polygons (Voronoi for point data).
- Size encodings accept only non-negative counts; signed, ratio, median and category measures are disabled for size.
- Heatmap bins accept counts and pooled ratios; medians and categories are disabled.
- Category measures disable classing, scale and sequential/diverging palettes.
- Bins are disabled for continuous classing; scale (linear/log/√) is disabled for quantile classing (ranks only).
- Log scale is disabled when the displayed values include zero or negatives.

## Pipeline
`dataset → aggregate to level (summary) → derive geometry for map type (native / Voronoi / bins / cartogram) → display value (normalization) → classify (breaks) → color & size scales → render`

Implemented as pure functions in `src/pipeline/` and covered by tests. Renderers in `src/render/` receive ready-made marks.

## Controls (left panel, top → bottom)
1. **Map type** — five cards with schematic thumbnails.
2. **Variant** — cards for the selected map type.
3. **Time** — Days (Mon–Sun toggles; All · Weekdays · Weekend) and From/To hour, for datasets whose flows carry weekday-hour slots. Flows and flow-derived measures (starts, ends, duration…) follow the filter in every map type.
3. **Aggregation** — Level (segments), Summary (segments; options depend on the measure kind).
4. **Color** — Measure (select), Classing (Continuous · Equal interval · Quantile · Natural breaks), Bins (3 · 5 · 7 · 9), Scale (Linear · Log · √), Palette (sequential / diverging / categorical swatches), Midpoint for diverging palettes (Median · Mean · Zero), Normalize (None · per km²) for counts on area-based maps.
5. **Size** — Measure (count measures or Fixed), Max size slider. Symbol and cartogram area is always proportional to value; flow width is proportional to trips. Shown for symbol, cartogram and flow.
6. **Map-type parameters** — Heatmap cell size / bandwidth.
7. **Flow** — Direction (All · From selected · To selected; click a station node to select), Mode (Gross · Net: only the dominant direction of each pair), Top flows.
7. **Appearance** — Opacity, Outline (None · Thin · Bold), Projection (per region), Basemap (None · OSM · Light · Dark · Voyager; Mercator only, CARTO styles need a key).

Above the map: dataset picker (header) and a measurement bar (the most common measures as chips, mirroring Time Vis Explorer).

## Map card
- Title generated from the pipeline: `Hispanic / Latino share · State · pooled`.
- Subtitle: classing, bins, scale, projection, geometry derivation (`Voronoi cells of 652 stations`).
- Legend: for continuous color, a histogram of displayed values with the class breaks drawn on it; for categories, swatches with counts; for size, three reference circles or widths.
- Hover: unit name, displayed value with units, numerator / denominator or member count, number of aggregated units. Click highlights a unit; click empty space clears. Scroll/pinch zoom, drag to pan, double-click resets.

## Deliberately absent
No tasks, quizzes, "lie" presets, bias explanations, saved views, comparison panels, export or sharing. (The old Spatial Bias Lab's pin gallery is not carried over; reconsider only if class discussion needs it.)

## Data requirements
- Datasets are fixed bundled subsets. The only external requests are optional basemap tiles (OSM, or CARTO with a key), available with the Mercator projection, with attribution on the map.
- Datasets are static GeoJSON snapshots with provenance documented in DATA.md.
- Attribution, vintage, and caveats are shown in the footer for each dataset.
