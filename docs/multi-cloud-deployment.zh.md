# 多云部署推进说明

目标：让 Jeff 订单工具未来可以部署到 Google Cloud、Microsoft Azure、AWS、国内云、普通 VPS 等环境，同时保留当前 SQLite 数据结构和迁移路径。

## 1. 当前版本适合的云端形态

当前版本继续使用 SQLite，因此最适合这两类环境：

1. 云服务器、轻量服务器或云桌面：有稳定磁盘目录，可以直接挂载 `cloud-data`。
2. 容器平台：必须提供稳定持久卷，且该持久卷适合 SQLite 读写。

不推荐把当前 SQLite 数据库直接放在对象存储、网盘同步目录、Cloud Storage bucket、S3 bucket、iCloud Drive 这类位置上实时运行。对象存储适合备份文件，不适合做 SQLite 主数据库。

## 2. 推荐优先级

### 2.1 最稳妥：云服务器或轻量服务器 + Docker

适合：

- 天翼云 ECS
- Google Compute Engine
- Azure Virtual Machine
- AWS EC2 / Lightsail
- 阿里云 / 腾讯云 / 华为云轻量服务器
- 普通 VPS

优点：

- `./cloud-data` 是真实磁盘目录。
- SQLite 行为最可控。
- Docker Compose、Caddy、备份脚本都能统一使用。
- 以后迁移到 PostgreSQL 前不需要大改部署方式。

启动方式：

```bash
cp .env.cloud.example .env.cloud
docker compose -f docker-compose.ghcr.yml up -d
```

### 2.2 可用：Azure Container Apps + Azure Files

Azure Container Apps 支持挂载 Azure Files 类型的存储卷。对 Jeff 这种小规模订单工具，可以作为容器化过渡方案。

注意：

- 必须配置持久卷，不要使用容器临时文件系统保存 `orders.db`。
- 不建议横向扩容多个实例同时写同一个 SQLite 文件。
- 实例数量保持 1。

### 2.3 谨慎：Google Cloud Run

Google Cloud Run 很适合无状态容器，但当前 SQLite 版本不是无状态应用。

Cloud Run 可以配合 Cloud Storage FUSE 挂载 bucket，也可以配合 Cloud SQL。但 Cloud Storage bucket/对象存储不适合作为 SQLite 主数据库写入目录。因此：

- 当前 SQLite 版本不建议直接部署到 Cloud Run 并把数据库放到 Cloud Storage bucket。
- 如果未来要优先用 Cloud Run，更推荐先完成 PostgreSQL/Cloud SQL 版本。
- 在完成 PostgreSQL 前，Google Cloud 更推荐 Compute Engine + Docker + persistent disk。

### 2.4 Apple/iCloud 的定位

Apple iCloud 和 CloudKit 不是通用 Node.js Web 服务托管平台，不能像 Google/Azure/AWS 那样直接跑 Docker 或 Next.js 服务。

可以考虑的用途：

- 把每日备份文件同步到 iCloud Drive。
- 未来如果做原生 iOS App，可再评估 CloudKit 数据同步。

不建议：

- 把 `orders.db` 放在 iCloud Drive 中实时运行。
- 期待 iCloud 承载当前 Web 服务。

## 3. 多云统一部署变量

无论放到哪家云，尽量保持这些变量一致：

```text
JEFF_ADMIN_PASSWORD=replace-with-a-strong-password
JEFF_PUBLIC_URL=https://orders.example.com
NEXT_PUBLIC_SITE_URL=https://orders.example.com
JEFF_COOKIE_SECURE=true
JEFF_DEPLOYMENT_MODE=cloud
JEFF_DISABLE_IN_APP_UPDATES=true
JEFF_ORDER_DB_PATH=/app/data/orders.db
JEFF_BACKUP_DIR=/app/data/backups
JEFF_BACKUP_RETENTION_DAYS=30
PORT=3000
```

Windows 云桌面或 Windows VM 可以使用：

```text
JEFF_ORDER_DB_PATH=D:\JeffOrderToolCloud\data\orders.db
JEFF_BACKUP_DIR=D:\JeffOrderToolCloud\data\backups
```

## 4. 使用 GHCR 镜像部署

后续 GitHub Actions 会把镜像推送到 GitHub Container Registry：

```text
ghcr.io/melodyjayai/jeff-order-tool:latest
ghcr.io/melodyjayai/jeff-order-tool:0.1.19
```

服务器上不需要构建源码时，可以使用：

```bash
docker compose -f docker-compose.ghcr.yml pull
docker compose -f docker-compose.ghcr.yml up -d
```

升级：

```bash
docker compose -f docker-compose.ghcr.yml pull
docker compose -f docker-compose.ghcr.yml up -d
```

升级前建议先备份：

```bash
docker compose -f docker-compose.ghcr.yml exec jeff-order-tool node scripts/backup-sqlite.cjs
```

## 5. HTTPS 入口

云服务器上推荐 Caddy：

```bash
docker compose -f docker-compose.ghcr.yml up -d
```

然后参考：

```text
cloud/caddy/Caddyfile.example
```

Caddy 负责：

- 监听 80/443。
- 自动申请和续期 HTTPS 证书。
- 反向代理到 `127.0.0.1:3000`。

## 6. 多云部署验收

任何平台上线前都按同一组标准验收：

1. `/api/health` 返回 `ok: true`。
2. 登录页不能绕过。
3. `JEFF_PUBLIC_URL` 显示为 Jeff 实际访问地址。
4. 新增订单后刷新仍在。
5. 手机核销后电脑能看到已核销。
6. 重启容器或服务器后订单仍在。
7. `cloud-data/backups` 有备份文件。
8. 只有一个实例写 SQLite。
9. HTTPS 正常，Cookie 使用 Secure。

## 7. 官方文档入口

- Google Cloud Run volumes and Cloud Storage FUSE: https://cloud.google.com/run/docs/configuring/services/cloud-storage-volume-mounts
- Google Cloud SQL: https://cloud.google.com/sql/docs
- Azure Container Apps storage mounts: https://learn.microsoft.com/azure/container-apps/storage-mounts
- Azure Files: https://learn.microsoft.com/azure/storage/files/storage-files-introduction
- Apple CloudKit: https://developer.apple.com/documentation/cloudkit

## 8. 未来 PostgreSQL 版本

当出现下面任一情况时，再推进 PostgreSQL：

- 需要 Cloud Run / Azure App Service 这类更偏无状态的平台。
- 需要多个实例同时运行。
- 需要多人角色和更强审计。
- 订单量和并发明显增长。

当前已经保留 `npm run export:postgres`，导出内容包括订单、操作日志和逐笔先交记录；后续 PostgreSQL 版本会以它为迁移基础继续扩展。
