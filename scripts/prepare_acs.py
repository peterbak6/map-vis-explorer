"""Prepare the US counties ACS dataset.

Usage: python3 scripts/prepare_acs.py data-raw/acs/census.json

Input: the Census API response used by the earlier Spatial Bias Lab (2022 ACS 5-year,
one row per county; header row first). Variables:
  B01003_001E total population, B19013_001E median household income,
  B02001_002E White alone, B02001_003E Black alone, B02001_005E Asian alone,
  B03003_003E Hispanic or Latino (any race).
Boundaries come from the us-atlas npm package (counties-10m.json), copied to public/data.
"""
import json, pathlib, shutil, sys

root = pathlib.Path(__file__).resolve().parent.parent
rows = json.loads(pathlib.Path(sys.argv[1]).read_text())
head, rows = rows[0], rows[1:]
idx = {h: i for i, h in enumerate(head)}
EXCLUDED = {'72'}  # Puerto Rico: not in the conterminous/AK/HI base map

def num(v, allow_negative=False):
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    # ACS uses large negative sentinels (e.g. -666666666) for unavailable estimates.
    if x < 0 and not allow_negative:
        return None
    return int(x) if x == int(x) else x

features, states = [], {}
for r in rows:
    st, co = r[idx['state']], r[idx['county']]
    if st in EXCLUDED:
        continue
    name = r[idx['NAME']]
    county_name, _, state_name = name.rpartition(', ')
    states[st] = state_name
    features.append({
        'id': st + co,
        'name': name,
        'parents': {'state': st},
        'v': [num(r[idx[k]]) for k in ['B01003_001E', 'B02001_002E', 'B02001_003E', 'B02001_005E', 'B03003_003E', 'B19013_001E']],
    })

dataset = {
    'id': 'acs',
    'title': 'US counties · ACS',
    'subtitle': '2022 American Community Survey 5-year estimates',
    'region': 'us',
    'geometry': 'areas',
    'base': {'file': 'us-counties-10m.json', 'object': 'counties', 'outline': 'states'},
    'fields': ['pop', 'white', 'black', 'asian', 'hispanic', 'income'],
    'levels': [
        {'id': 'county', 'label': 'County'},
        {'id': 'state', 'label': 'State', 'parent': 'state', 'object': 'states'},
    ],
    'parentNames': {'state': states},
    'measures': [
        {'id': 'pop', 'label': 'Population', 'kind': 'count', 'field': 'pop', 'unit': 'people'},
        {'id': 'hispanicShare', 'label': 'Hispanic / Latino share', 'kind': 'ratio', 'num': 'hispanic', 'den': 'pop', 'format': 'percent'},
        {'id': 'whiteShare', 'label': 'White alone share', 'kind': 'ratio', 'num': 'white', 'den': 'pop', 'format': 'percent'},
        {'id': 'blackShare', 'label': 'Black alone share', 'kind': 'ratio', 'num': 'black', 'den': 'pop', 'format': 'percent'},
        {'id': 'asianShare', 'label': 'Asian alone share', 'kind': 'ratio', 'num': 'asian', 'den': 'pop', 'format': 'percent'},
        {'id': 'income', 'label': 'Median household income', 'kind': 'median', 'field': 'income', 'weight': 'pop', 'format': 'currency'},
        {'id': 'hispanic', 'label': 'Hispanic / Latino people', 'kind': 'count', 'field': 'hispanic', 'unit': 'people'},
        {'id': 'black', 'label': 'Black alone people', 'kind': 'count', 'field': 'black', 'unit': 'people'},
    ],
    'defaults': {'measure': 'hispanicShare', 'sizeMeasure': 'pop'},
    'source': 'https://www.census.gov/programs-surveys/acs',
    'attribution': 'U.S. Census Bureau, 2022 ACS 5-year (B01003, B19013, B02001, B03003) · Boundaries: us-atlas (Census cartographic boundaries)',
    'note': 'Race categories are “alone”; Hispanic/Latino is an ethnicity of any race, so shares overlap and do not sum to 100%. Area uses the polygon area, including inland water. Median income cannot be re-aggregated exactly; coarser levels show an explicit approximation. Boundary vintage mismatch: 2022 ACS uses Connecticut planning regions and the split Chugach/Copper River census areas, which the us-atlas county boundaries predate, so those areas show no data.',
}
out = root / 'public' / 'data'
out.mkdir(parents=True, exist_ok=True)
dataset['features'] = features
shutil.copy(root / 'node_modules' / 'us-atlas' / 'counties-10m.json', out / 'us-counties-10m.json')
(out / 'acs.json').write_text(json.dumps(dataset, ensure_ascii=False, separators=(',', ':')))
print(len(features), 'counties,', (out / 'acs.json').stat().st_size, 'bytes')
