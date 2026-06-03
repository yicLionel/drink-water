# 咕噜喝水 PWA

一个可安装、可离线使用的喝水提醒网页版 PWA。当前版本包含：

- 今日喝水目标、进度和饮水记录
- 150ml / 250ml / 350ml 快捷添加和自定义饮水量
- 提醒间隔设置和系统通知授权
- Service Worker 离线缓存、通知点击回到应用、Web Push 事件入口
- PWA manifest、桌面安装入口、移动端安全区适配

## 本地运行

```bash
npm install
npm run dev
```

## 生产构建

```bash
npm run build
npm run preview
```

构建产物在 `dist/`，可部署到 Vercel、Netlify、Cloudflare Pages 或任意静态站点服务。

## 通知能力说明

浏览器本地定时器会在应用打开、最小化或保持运行时按间隔触发系统通知。若需要应用完全关闭后仍长期后台提醒，需要接入 Web Push 服务端并发送 push 消息；本项目的 `public/sw.js` 已保留 `push` 事件入口，后续只需增加订阅与服务端发送逻辑。
