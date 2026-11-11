// 把 mapshaper 的 TopoJSON 压成 /life/geo.js：国界（中国视角）+ 中国省级行政区
const fs = require('fs');
const out = process.argv[2];
function pack(file, name) {
  const t = JSON.parse(fs.readFileSync(file, 'utf8'));
  // 简化后没剩下形状的（太小的岛国）跳过，它们在 dots 里画成一个点
  const shapes = t.objects[name].geometries.filter(g => g.arcs).map(g => {
    const arcs = g.type === 'Polygon' ? [g.arcs] : g.arcs;
    return [g.properties.code, arcs];
  });
  return { k: [...t.transform.scale, ...t.transform.translate], a: t.arcs, s: shapes };
}
const countries = pack('countries.json', 'countries');
const provinces = pack('provinces.json', 'provinces');
const labels = JSON.parse(fs.readFileSync('labels.json', 'utf8'));
const have = new Set(countries.s.map(s => s[0]));
// 小到画不出形状的国家和地区，只留一个点
const dots = Object.entries(labels).filter(([code]) => !have.has(code)).map(([code, [x, y]]) => [code, x, y]);
const names = Object.fromEntries(Object.entries(labels).map(([code, l]) => [code, l[2]]));
const provNames = Object.fromEntries(JSON.parse(fs.readFileSync('provinces.json', 'utf8')).objects.provinces.geometries.map(g => [g.properties.code, g.properties.name]));
const text = `// 地图数据：Natural Earth（公共领域）10m 国界（中国视角版）和 50m 中国省级行政区，用 mapshaper 简化。
// 由 xiangqi 仓库的 tools/geo/build.sh 生成，不要手改。坐标是量化后的增量整数（TopoJSON 的 arcs）。
const GEO = ${JSON.stringify({ countries, provinces, dots, names, provNames })};
`;
fs.writeFileSync(out, text);
console.log(out, text.length, 'shapes', countries.s.length, 'dots', dots.length);
