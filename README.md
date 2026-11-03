# 游戏园：中国象棋 + 五子棋 · 微信小游戏 + 网页版

同一套代码，两个版本：

- **微信小游戏**：首页先选「中国象棋」或「五子棋」，只有人机对战和本地双人（`minigame/js/config.js` 里 `SERVER_URL` 留空，不显示联网入口）。
- **网页版**：每个游戏一个网页，除了人机和本地双人，还有联网对战（快速匹配 + 好友房间）。
  - 中国象棋：<https://gamesyuan.com/xiangqi/>（本仓库推送后由 GitHub Actions 自动发布）
  - 五子棋：<https://gamesyuan.com/wuziqi/>（打包到 `yuanEnS.github.io` 仓库的 `wuziqi/` 目录里发布，见下文）

```
xiangqi/
├── minigame/            微信小游戏（用微信开发者工具打开这个目录）
│   ├── game.js          入口
│   ├── game.json / project.config.json
│   ├── fonts/kai.ttf    界面楷体（霞鹜文楷裁剪版，约 250 KB，OFL 协议）
│   ├── fonts/piece.ttf  棋子楷体（寒蝉正楷体裁剪版，约 16 KB，OFL 协议）
│   └── js/
│       ├── main.js        入口：游戏列表（只有一个游戏时直接进入）
│       ├── ui.js          共用界面：画布布局、按钮卡片、主题页、设置、点击分发
│       ├── xiangqi.js     象棋规则引擎（服务器也用这一份）
│       ├── xiangqi-app.js 象棋的首页、人机设置、联网流程、对局画面
│       ├── ai.js          象棋电脑（Alpha-Beta 搜索）
│       ├── gomoku.js      五子棋规则（15 路，无禁手，服务器也用这一份）
│       ├── gomoku-app.js  五子棋的首页、人机设置、联网流程、对局画面
│       ├── gomoku-ai.js   五子棋电脑（棋形打分 + Alpha-Beta 搜索）
│       ├── themes.js      主题配色（车、马、象、士、炮），象棋棋子和五子棋棋子的颜色
│       ├── draw.js        棋盘、棋子、主题缩略图的绘制
│       ├── net.js         WebSocket 封装
│       └── config.js      服务器地址（小游戏留空）和首页列出的游戏
├── server/              联网服务器（Node.js 版，小游戏开发时在本机运行）
│   └── lobby.js         房间和自动匹配逻辑（Node 版和 Worker 版共用）
├── worker/              联网服务器（Cloudflare Workers 版，给网页版用，免费）
├── web/                 网页版（复用 minigame/ 的代码）
│   ├── index.html       象棋页面；rules.html 象棋规则入门
│   ├── pages/wuziqi.html 五子棋页面
│   ├── wx-adapter.js    用浏览器 API 实现 wx 接口
│   ├── config.js        网页版的服务器地址
│   └── build.js         把 minigame/ 的代码打包成一个游戏的网站
├── preview/             浏览器调试页（直接加载源码、模拟微信胶囊按钮，开发小游戏时用）
├── tools/subset-font.py 重新裁剪界面楷体
├── tools/subset-piece-font.py 重新裁剪棋子楷体
└── .github/workflows/pages.yml  推送后自动部署网页版
```

## 中国象棋

功能：**快速匹配**（系统自动给正在找棋友的人配对）、创建或加入 4 位房间号、完整走子规则（蹩马腿、塞象眼、炮架、将帅照面、绝杀和困毙判定）、执黑时棋盘自动翻转、认输、再来一局（自动交换红黑）、对手断线通知、本地双人（带悔棋）。

**人机对战**：三档难度，入门（只算两步，常有失误）、业余（算三步）、大师（全力计算，每步限时 2.5 秒）。可以选执红、执黑或随机，支持悔棋（退回到自己走）和「提示」（按业余水平给出一步建议，在棋盘上标出来）。电脑在手机主线程上计算，大师档每步会有一两秒的「思考中」。

**字体**：界面文字用霞鹜文楷，棋子上的字用寒蝉正楷体。为了控制包体，只保留游戏里用到的字。**改了界面文字后**，要重新运行一次裁剪脚本，新加的字才会用楷体显示：

```bash
python3 tools/subset-font.py 你下载的/LXGWWenKai-Medium.ttf
```

字体从 [LxgwWenKai Releases](https://github.com/lxgw/LxgwWenKai/releases) 下载。没有被裁剪进来的字，会回退到系统字体显示。

棋子字体只含 `themes.js` 里 `GLYPHS` 用到的字，改了棋子用字后运行：

```bash
python3 tools/subset-piece-font.py 你下载的/ChillKai.ttf
```

字体从 [ChillKai Releases](https://github.com/Warren2060/ChillKai/releases) 下载（ChillKai.zip 里的 ChillKai.ttf）。

**主题**：首页「棋盘主题」或对局里的「主题」按钮可以切换，选择会自动保存。

- 内置 5 套主题：车 · 檀木、马 · 青瓷（米白底红字对墨绿底白字）、象 · 宣纸、士 · 墨夜、炮 · 黑白（适合墨水屏）。
- 棋子文字可选繁体或简体。
- **对黑白屏友好**：
  - 每套主题里，红黑两方棋子都一深一浅；
  - 繁体字下红黑双方用字全部不同（俥/車、傌/馬、炮/砲、帥/將……）；
  - 选中、可走位置、能吃的子、上一步分别用实线圈、圆点、虚线圈、角框标出，不只靠颜色区分。

在 `themes.js` 里照着已有的格式加一项，就能新增主题。

## 五子棋

15 路棋盘，黑先白后，横、竖、斜连成五子（或更多）获胜，不设禁手；棋盘下满算平局。

- **落子要点两下**：手机上格子小，第一下放一枚半透明的预览子，确认位置后再点同一处才落下。
- **人机对战**：入门（只顾自己，常漏看对方）、业余（会攻会守，看一步）、大师（在最好的几个点里往后搜索，每步限时 1.5 秒）。可以选执黑、执白或随机，支持悔棋和「提示」。
- **联网对战**（网页版）：和象棋共用一个服务器，分开排队，五子棋的房间号只能用五子棋加入。
- 五套主题都有对应的黑白子配色，黑白主题下白子带黑边。

自测：`node server/test-gomoku.js`（胜负判定、电脑会成五和挡五、各档难度互相对弈）。

## 网页版

网页版包含人机对战、本地双人和所有主题；部署了联网服务器后，还有快速匹配和好友房间。游戏逻辑都在 `minigame/js/` 里，只改那里就行，网页版打包时会自动带上。

### 本地运行

```bash
node web/build.js
```

（只打包象棋到 `web/dist/`，给 `web/index.html` 用。）

```bash
python3 -m http.server 8000
```

然后打开 <http://localhost:8000/web/>。

### 发布到 GitHub Pages（免费）

1. 在 GitHub 新建一个仓库（比如 `xiangqi`），把这个目录推上去：

   ```bash
   git add . && git commit -m "中国象棋" && git remote add origin https://github.com/你的用户名/xiangqi.git && git push -u origin main
   ```

2. 打开仓库的 **Settings → Pages**，把 **Source** 设为 **GitHub Actions**。
3. 以后每次推送到 `main`，都会自动运行规则测试、打包，并发布到 `https://你的用户名.github.io/xiangqi/`。进度可以在 Actions 页面看。

### 发布五子棋网页

五子棋发布在 `gamesyuan.com/wuziqi/`，由首页仓库 `yuanEnS.github.io` 托管。改了五子棋代码后，在本仓库运行：

```bash
node web/build.js gomoku ../yuanEnS.github.io/wuziqi
```

它会把页面、适配脚本、打包好的代码和字体写进首页仓库的 `wuziqi/` 目录，然后在首页仓库提交推送即可。

### 开启网页版联网对战（Cloudflare Workers，免费）

GitHub Pages 只能放静态网页，联网对战还需要一个 `wss://` 服务器。`worker/` 就是这个服务器，部署到 Cloudflare Workers 的免费套餐上：不会休眠，也不用自己买服务器。

1. 注册一个 [Cloudflare](https://dash.cloudflare.com/sign-up) 免费账号。
2. 部署（第一次会打开浏览器让你登录授权）：

   ```bash
   cd worker && npm install && npx wrangler login && npx wrangler deploy
   ```

   部署完成后会输出一个地址，形如 `https://xiangqi.你的子域名.workers.dev`。
3. 把这个地址的 `https://` 换成 `wss://`，填进 `web/config.js`：

   ```js
   SERVER_URL: 'wss://xiangqi.你的子域名.workers.dev',
   ```

4. 提交并推送。GitHub Pages 更新后，首页就会出现「快速匹配」「创建房间」「加入房间」。

在浏览器里打开 Worker 地址，看到「象棋联网服务器运行中」就说明部署成功了。象棋和五子棋共用这一个服务器，客户端连接时用 `game` 字段区分。

**本地调试**：

```bash
cd worker && npm run dev
```

```bash
SERVER_URL=ws://127.0.0.1:8787 node web/build.js
```

测试完记得再运行一次不带 `SERVER_URL` 的 `node web/build.js`。服务器自测也可以直接跑在 Worker 上：

```bash
cd server && SERVER_URL=ws://127.0.0.1:8787 node test-server.js
```

**说明**：
- 所有玩家连到同一个 Durable Object，房间和匹配队列都保存在内存里。Cloudflare 更新部署或重启这个对象时，正在进行的对局会断开。
- 国内访问 `workers.dev` 不稳定。想让国内玩家稳定连上，需要给 Worker 绑定一个自己的域名。

## 小游戏 · 一、准备（免费）

1. 安装 [Node.js](https://nodejs.org)（18 或更高版本）。
2. 下载 [微信开发者工具](https://developers.weixin.qq.com/minigame/dev/devtools/download.html)。
3. 在 [微信公众平台](https://mp.weixin.qq.com) 注册一个「小游戏」账号（个人主体免费），在「开发管理 → 开发设置」里拿到 **AppID**。
   还没注册也可以先用游客模式，在开发者工具的模拟器里跑；用手机真机预览需要正式的 AppID。

## 小游戏 · 二、启动服务器

```bash
cd server
npm install
npm start
```

看到 `象棋服务器已启动：ws://0.0.0.0:8080` 就说明启动成功了。运行 `npm test` 可以跑规则和联网的自动测试。

## 小游戏 · 三、在开发者工具里运行

1. 小游戏默认不显示联网入口。想在开发时测试联网：查电脑的局域网 IP（`ipconfig getifaddr en0`，macOS），临时填进 `minigame/js/config.js` 的 `SERVER_URL`，例如 `ws://192.168.1.23:8080`，测完改回 `''` 再上传。
2. 开发者工具 →「导入项目」→ 目录选 `minigame`，AppID 填你自己的（或者先选游客或测试号）。
3. 右上角「详情 → 本地设置」，确认已勾选 **「不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书」**（`project.config.json` 里已经默认打开）。
4. 模拟器里点「创建房间」，记下房间号。

## 小游戏 · 四、两个人联机测试

- **手机加入**：手机和电脑连同一个 Wi‑Fi。开发者工具点「预览」，用手机微信扫码打开；然后在小游戏右上角「…」里**打开「开发调试」**（不打开的话，手机会拦截 `ws://` 这种未配置的地址）。点「加入房间」，输入房间号就可以对战了。
- **只用电脑测试**：再打开一个浏览器调试页当第二个玩家：

  ```bash
  python3 -m http.server 5500
  ```

  然后访问 <http://localhost:5500/preview/>。

## 小游戏 · 五、正式上线还需要什么（这一步会花钱）

开发和测试全程免费。但想让陌生玩家在正式版里玩到，微信有几个硬性要求：

| 要求 | 说明 |
|---|---|
| `wss://` 加证书 | 正式版只能连 HTTPS / WSS |
| 域名完成 ICP 备案 | 要在小游戏后台「开发设置 → 服务器域名 → socket 合法域名」里配置 |
| 一台服务器 | 运行 `server/`。国内云服务器新用户或学生有优惠，大约几十元一年；域名大约几十元一年 |
| 小游戏备案和类目 | 在后台完成小程序备案。象棋属于棋牌类目，个人主体能不能选、需要哪些资质，以后台类目页面为准 |

如果不想自己管服务器，也可以改用微信「云开发 / 云托管」，按量付费，不需要备案域名，但不是免费的。

## 后续可以加的功能

- 分享卡片邀请好友（`wx.shareAppMessage` 带上房间号，好友点开直接进房间）
- 断线重连（手机切到后台再回来时恢复对局）
- 步时和局时
- 长将、长捉判负，以及求和
