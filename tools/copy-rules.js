// 把网页新棋的规则（server/rules/）和农历换算（server/lunar.js）复制到网站仓库，服务器和网页用同一份。
// 用法：node tools/copy-rules.js [网站仓库目录，默认 ../yuanEnS.github.io]
const fs = require('fs');
const path = require('path');

const from = path.join(__dirname, '..', 'server', 'rules');
const site = path.resolve(process.argv[2] || path.join(__dirname, '..', '..', 'yuanEnS.github.io'));
const to = path.join(site, 'games', 'rules');
fs.mkdirSync(to, { recursive: true });
for (const name of fs.readdirSync(from).filter(n => n.endsWith('.js'))) {
  fs.copyFileSync(path.join(from, name), path.join(to, name));
  console.log(`已复制 ${name} → ${path.relative(process.cwd(), path.join(to, name))}`);
}
// 农历换算（纪念日、生日）：网页 life/lunar.js 和 Worker 的提醒共用
fs.copyFileSync(path.join(__dirname, '..', 'server', 'lunar.js'), path.join(site, 'life', 'lunar.js'));
console.log(`已复制 lunar.js → ${path.relative(process.cwd(), path.join(site, 'life', 'lunar.js'))}`);
