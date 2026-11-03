# 中国象棋 · 微信小游戏 + 网页版

同一套代码，两个版本：**微信小游戏**和**网页版**（打开网址就能玩，用 GitHub Pages 免费托管）。两个版本都支持人机对战、本地双人，以及联网对战（快速匹配 + 好友房间）。

在线试玩：<https://yuanens.github.io/xiangqi/>

```
xiangqi/
├── minigame/            微信小游戏（用微信开发者工具打开这个目录）
│   ├── game.js          入口
│   ├── game.json / project.config.json
│   ├── fonts/kai.ttf    楷体（霞鹜文楷裁剪版，约 250 KB，OFL 协议）
│   └── js/
│       ├── xiangqi.js   规则引擎（服务器也用这一份）
│       ├── main.js      界面、点击、联网流程
│       ├── themes.js    主题配色（车、马、象、士、炮）
│       ├── draw.js      棋盘、棋子、主题缩略图的绘制
│       ├── ai.js        人机对战引擎（Alpha-Beta 搜索）
│       ├── net.js       WebSocket 封装
│       └── config.js    服务器地址 ← 需要改成你电脑的 IP
├── server/              联网服务器（Node.js 版，小游戏开发时在本机运行）
│   └── lobby.js         房间和自动匹配逻辑（Node 版和 Worker 版共用）
├── worker/              联网服务器（Cloudflare Workers 版，给网页版用，免费）
├── web/                 网页版（复用 minigame/ 的代码）
│   ├── index.html       页面
│   ├── wx-adapter.js    用浏览器 API 实现 wx 接口
│   ├── config.js        网页版的服务器地址（默认留空 = 不显示联网）
│   └── build.js         把 minigame/ 的代码打包成 web/dist/game.js
├── preview/             浏览器调试页（直接加载源码、模拟微信胶囊按钮，开发小游戏时用）
├── tools/subset-font.py 重新裁剪楷体字体
└── .github/workflows/pages.yml  推送后自动部署网页版
```

功能：**快速匹配**（系统自动给正在找棋友的人配对）、创建或加入 4 位房间号、完整走子规则（蹩马腿、塞象眼、炮架、将帅照面、绝杀和困毙判定）、执黑时棋盘自动翻转、认输、再来一局（自动交换红黑）、对手断线通知、本地双人（带悔棋）。

**人机对战**：三档难度，入门（只算两步，常有失误）、业余（算三步）、大师（全力计算，每步限时 2.5 秒）。可以选执红、执黑或随机，支持悔棋（退回到自己走）和「提示」（按业余水平给出一步建议，在棋盘上标出来）。电脑在手机主线程上计算，大师档每步会有一两秒的「思考中」。

**字体**：全部文字用楷体（霞鹜文楷）。为了控制包体，只保留游戏里用到的字。**改了界面文字后**，要重新运行一次裁剪脚本，新加的字才会用楷体显示：

```bash
python3 tools/subset-font.py 你下载的/LXGWWenKai-Medium.ttf
```

字体从 [LxgwWenKai Releases](https://github.com/lxgw/LxgwWenKai/releases) 下载。没有被裁剪进来的字，会回退到系统字体显示。

**主题**：首页「棋盘主题」或对局里的「主题」按钮可以切换，选择会自动保存。

- 内置 5 套主题：车 · 檀木、马 · 青瓷（米白底红字对墨绿底白字）、象 · 宣纸、士 · 墨夜、炮 · 黑白（适合墨水屏）。
- 棋子文字可选繁体或简体。
- **对黑白屏友好**：
  - 每套主题里，红黑两方棋子都一深一浅；
  - 繁体字下红黑双方用字全部不同（俥/車、傌/馬、炮/砲、帥/將……）；
  - 选中、可走位置、能吃的子、上一步分别用实线圈、圆点、虚线圈、角框标出，不只靠颜色区分。

在 `themes.js` 里照着已有的格式加一项，就能新增主题。

## 网页版

网页版包含人机对战、本地双人和所有主题；部署了联网服务器后，还有快速匹配和好友房间。游戏逻辑都在 `minigame/js/` 里，只改那里就行，网页版打包时会自动带上。

### 本地运行

```bash
node web/build.js
```

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

在浏览器里打开 Worker 地址，看到「象棋联网服务器运行中」就说明部署成功了。

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

1. 查电脑的局域网 IP：`ipconfig getifaddr en0`（macOS）。把结果填进 `minigame/js/config.js` 的 `SERVER_URL`，例如 `ws://192.168.1.23:8080`。
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
