#!/bin/sh
# 重新生成网站的 /life/geo.js（国界用 Natural Earth 中国视角版，加中国省级行政区）。
# 需要 node。数据和 mapshaper 都下到临时目录，不进仓库。用法：sh tools/geo/build.sh
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
OUT=${1:-$HERE/../../../yuanEnS.github.io/life/geo.js}
WORK=$(mktemp -d)
cd "$WORK"
B=https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson
curl -sSfLO $B/ne_10m_admin_0_countries_chn.geojson
curl -sSfLO $B/ne_50m_admin_1_states_provinces.geojson
npm init -y >/dev/null && npm i -s mapshaper@0.6.102
MS="npx mapshaper"
$MS ne_10m_admin_0_countries_chn.geojson -filter 'ADM0_A3 != "ATA"' -each 'code = ISO_A2_EH != "-99" ? ISO_A2_EH : ADM0_A3, name = NAME_ZH' -filter-fields code,name -simplify 3% keep-shapes -filter-islands min-area=300km2 -clean -rename-layers countries -o countries.json format=topojson quantization=9000
$MS ne_10m_admin_0_countries_chn.geojson -filter 'ADM0_A3 == "CHN"' -filter-fields ADM0_A3 -o china.json
$MS ne_50m_admin_1_states_provinces.geojson -filter 'adm0_a3 == "CHN"' -each 'code = iso_3166_2, name = name_zh' -filter-fields code,name -o prov50.json
# 50m 省界之外、中国视角国界之内的部分：台湾单独成省，藏南和西段边境并入西藏，海岸的小缝丢掉
$MS china.json -erase prov50.json -explode -each 'a = this.area/1e6, cx = this.centroidX, cy = this.centroidY' -filter 'a > 300' \
  -each 'code = cx > 119.5 && cy > 21 && cy < 26 ? "CN-TW" : cx < 96 ? "CN-XZ" : "", name = code == "CN-TW" ? "台湾省" : "西藏自治区"' -filter 'code != ""' -filter-fields code,name -o gaps2.json
$MS -i prov50.json gaps2.json combine-files -merge-layers force -dissolve2 code copy-fields=name -simplify 8% keep-shapes -filter-islands min-area=150km2 -clean -rename-layers provinces -o provinces.json format=topojson quantization=9000
node -e "
const src = JSON.parse(require('fs').readFileSync('ne_10m_admin_0_countries_chn.geojson', 'utf8'));
const labels = {};
for (const f of src.features) {
  const p = f.properties;
  if (p.ADM0_A3 === 'ATA') continue;
  const code = p.ISO_A2_EH !== '-99' ? p.ISO_A2_EH : p.ADM0_A3;
  labels[code] = [+p.LABEL_X.toFixed(2), +p.LABEL_Y.toFixed(2), p.NAME_ZH];
}
require('fs').writeFileSync('labels.json', JSON.stringify(labels));
"
node "$HERE/bake.js" "$OUT"
rm -rf "$WORK"
