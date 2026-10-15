# 双主机异地同时使用预览版

预览版用于验证 Windows 和 Mac 在不同地点同时登录、登记订单、修改订单和核销订单的体验。它与当前生产环境隔离，不能替代正式切换。

## 隔离边界

从项目根目录执行 `npm run start:preview` 时，实例默认监听 `127.0.0.1:3211`，数据库写入 `.preview-data/orders.db`，备份写入 `.preview-data/backups`。生产桌面版通常使用另一端口和数据目录，因此可以并行运行。

预览实例使用 `JEFF_SESSION_COOKIE_NAME=jeff_order_preview_session`，不会覆盖同一台电脑上生产实例的登录会话。脚本拒绝把 `data`、`cloud-data` 或当前生产目录 `D:\JeffOrderToolCloudTrial\data` 作为预览数据目录；如需指定目录，使用 `JEFF_PREVIEW_DATA_DIR`，并先确认该目录是专用空目录。

预览库是全新的 SQLite 库。不要把生产 `orders.db` 直接复制到预览目录，也不要把预览库回写生产目录。需要测试真实订单时，先使用 SQLite 一致性备份，再将副本导入预览环境，并在验收记录中标注“预览数据”。

## 本地启动

先生成当前代码的构建产物：

```powershell
npm ci
npm run build:preview
npm run start:preview
```

浏览器打开 `http://127.0.0.1:3211`。如果出现 `/setup`，请为预览实例设置单独的管理员密码。变更端口或数据目录时：

```powershell
$env:JEFF_PREVIEW_PORT = "3212"
$env:JEFF_PREVIEW_DATA_DIR = "D:\JeffOrderToolPreview\data"
npm run start:preview
```

部署到独立试用主机并通过反向代理提供 HTTPS 时，额外设置 `JEFF_PREVIEW_PUBLIC_URL=https://预览专用域名`，让二维码和站内链接使用预览地址。

自动化冒烟测试可以临时设置 `JEFF_PREVIEW_ADMIN_PASSWORD`；脚本不会继承外部的 `JEFF_ADMIN_PASSWORD`，避免误用生产密码。

预览脚本不会读取 `.env.cloud`，也不会启动 Cloudflare 隧道或计划任务；需要异地验证时，应将这个预览实例部署到单独的试用主机，再用独立的 HTTPS 隧道或固定域名发布，不能把生产隧道改指向预览端口。

## 双主机验收

预览版会在每条订单页面携带最近一次 `updated_at` 快照。两台电脑同时打开同一订单时，先提交的一方会成功；另一方提交旧页面内容会收到“这条订单已被另一台电脑更新，请刷新后再保存”，系统不会覆盖先提交的数据。重复提交实际交货或核销表单同样会被旧快照拦截。

1. Windows 和 Mac 浏览器同时打开预览地址，并分别登录。
2. 在两端创建不同订单，确认两端都能看到各自订单。
3. 在两端编辑同一订单，记录最后保存者、页面提示和数据结果。
4. 重复点击保存、刷新页面和重新登录，确认不会产生重复订单或错误会话。
5. 暂时断开其中一端网络后恢复，确认另一端数据不受影响，恢复后可继续登录。
6. 检查 `.preview-data/orders.db` 和 `.preview-data/backups`，确认只出现预览数据。

验收前先执行：

```powershell
npm run lint
npm run test:cloud-sync
npm run test:cloud-migration
```

预览完成后停止进程即可。预览目录可以整体归档或删除；删除前先保留测试记录，不要操作生产 `data`、`cloud-data` 或正式云端备份目录。
