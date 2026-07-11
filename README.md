# Jeff 制衣订单核销工具

[English README](./README.en.md)

V1 聚焦 Jeff 从 2026-06-02 到 2026-07-11 的实际使用反馈：订单号登记、自动登记日期、输入订单号查询、出货核销自动日期、按细分类登记数量、可多次先交、剩余未交数量、紧凑订单详情、返厂修改、急单提示、电脑和手机浏览器访问。

数据长期保存在同一张订单总表里，不按月份拆分。

## 开源说明

这个项目面向小型制衣厂、加工厂、档口和类似场景：用一个轻量工具替代纸本翻找订单号、手工划线核销和临时 Excel。

仓库只包含程序源码，不包含真实订单数据。实际使用时生成的 `data/orders.db`、绿色版 `release` 目录和日志文件都不会提交到 Git。

## 登录和首次设置

第一次打开工具时，如果没有配置管理员密码，页面会先进入 `/setup`，按提示设置一个至少 8 位的管理员密码。

之后电脑和手机访问都需要登录。电脑端顶部有“退出”按钮。

云端部署时也可以用环境变量提前设置管理员密码：

```text
JEFF_ADMIN_PASSWORD=换成自己的强密码
```

如果设置了 `JEFF_ADMIN_PASSWORD`，工具会优先使用这个密码，不再显示首次设置页。

## 登记和订单总表

电脑端登记时输入一个订单号，选择公司和工厂，填写细分类数量和可选备注，然后点“保存到订单总表”。如果登记当天已经先交一部分，也可以同时填写“首批先交”的五类数量。

界面不再显示单独的“客户”项，公司即作为客户归属；旧数据库里的客户字段仍保留，升级和导入时不会丢失。

保存后订单会一直留在订单总表里，后续直接输入订单号查找和核销。

## 紧凑订单详情

电脑端订单详情把公司、工厂、日期和急度在宽屏排成一行；五类订单数量集中为一条可编辑数量带，不再显示为五个独立大输入框。备注和保存按钮也放在同一行。

累计先交和剩余未交各用一条横排显示。“记录本次先交”默认收起，点击后再填写，因此常见笔记本屏幕滚到订单详情顶部后可以在一屏内查看保存、先交记录和核销操作。

## 返厂修改

已核销订单如果客户返厂修改，可以按细分类登记返厂数量，例如只返厂 1 条单裤，或同时返厂 1 件单衫和 1 件马甲。

返厂数量不能超过原订单对应细分类数量。返厂中的订单会回到未完成列表；处理完成后点“完成返厂”，订单恢复为已核销，并保留返厂历史和操作日志。

## 公司和工厂下拉框

登记和修改订单时可以选择“公司”和“工厂”。订单总表顶部也可以按公司、工厂、状态和急度筛选。

公司名单集中维护在：

```text
src/lib/companies.ts
```

目前已根据 Jeff 发来的聊天记录和 `companylist` 单据照片补入首批公司名单；工厂名单已设置为“新奇洋服”和“度邦洋服”。后续 Jeff 再补充公司或工厂时，继续在同一个文件里追加即可。

## 细分类数量

登记时填写这些细分类数量：

- 套装
- 单衫
- 单裤
- 马甲
- 大衣

工具只记录数量和出货核销，不计算价格。

## 待核销明细

首页顶部会显示“待核销明细”，把未核销订单当前剩余未交的套装、单衫、单裤、马甲和大衣分别汇总，并显示数量小计。返厂中的订单按本次返厂数量计入。

如果旧数据只有总数量、没有细分类数量，会额外显示“未分细类”，避免总数和细分类数量对不上。

数量汇总会把品类和数字紧贴显示，例如“套装 128”“单衫 98”，避免把前一个数字误看成后一个品类的数量。

## 多次先交和剩余数量

先交按套装、单衫、单裤、马甲和大衣分别填写实际数量。登记订单时可以记录首批先交，之后在订单详情中还能继续点“保存本次先交”，每一次都会单独保留日期、数量和备注。

工具会同时显示“累计先交”和“剩余未交”一行数量；有先交记录的未核销订单集中出现在左侧“先交”列表，订单行和手机详情页也会显示橙色“先交”标记。

误填的新版先交记录可在电脑端逐笔撤销。旧版“先交要求”和“部分交付”数据会继续兼容显示，其中无法判断细分类的旧数量标记为“未分细类”。

订单总表默认按订单号从小到大排列，也可以切换为“登记日期早到晚”或“登记日期新到旧”。

## 手机模式

手机窄屏会自动进入手机模式，可以搜索、查看详情、查看急单、出货核销、标记返厂修改和完成返厂。

登记、修改详情、撤销核销只在电脑端显示。

## 办公室手机扫码访问

电脑端打开工具后，左侧会显示“手机访问”二维码。

手机连接办公室同一个 Wi-Fi 后，用相机扫码即可打开同一份订单总表。扫码打不开时，可以复制二维码下面的局域网地址，在手机浏览器里打开。

Windows 防火墙如果提示 Node.js 或 Jeff 订单工具需要访问网络，选择允许专用网络访问。

## 数据工具

电脑端左侧有“数据工具”：

- 下载数据库备份：生成一份一致性的 SQLite 备份文件。
- 导入 CSV：支持导入当前工具导出的 CSV，同订单号会更新，没有则新增；导入前会自动生成一份备份。
- 导入旧版 .db 备份：支持选择旧绿色版或备份目录里的 `jeff-order-*.db` 文件，按“公司 + 订单号”合并到当前安装版；导入前会自动生成一份备份。
- 最近操作：首页显示登记、更新、先交、撤销先交、出货核销、返厂修改、完成返厂、撤销核销等操作日志，也可进入 `/events` 查看最近 500 条。

服务器端和数据库更新条件都会防止重复出货核销；已核销订单再次点击不会重复写入核销记录。

## 自动备份和状态检查

每次打开首页时，工具会检查当天是否已有每日备份；如果没有，会自动在备份目录生成一份 SQLite 备份。

登录后可以点顶部“检查”，打开 `/health` 查看：

- 登录保护是否开启。
- 数据库是否正常。
- 订单数量和操作日志数量。
- 最近备份时间和备份目录。

云端或服务器计划任务可以每天运行：

```bash
npm run backup:daily
```

默认备份目录在 `data/backups`，默认保留 30 天。可以通过环境变量调整：

```text
JEFF_BACKUP_DIR=D:\JeffOrderBackups
JEFF_BACKUP_RETENTION_DAYS=30
```

## 本地运行

```bash
npm run dev
```

打开：

```text
http://localhost:3000
```

如果要让同一 Wi-Fi 下的手机访问，可以运行：

```bash
npm run dev:lan
```

然后用手机访问电脑的局域网 IP，例如：

```text
http://电脑IP:3000
```

Windows 11 可以直接双击：

```text
start-jeff-order-tool.cmd
```

它会启动服务并打开本机页面。

## 云端部署

Jeff 现在需要多设备随时访问和编辑同一份订单数据时，建议使用云端版。云端版会固定数据目录、保留登录保护、隐藏 Windows 安装包更新按钮，并支持 Windows 云桌面试运行和 Docker 正式部署。

详细步骤见：

```text
docs/cloud-deployment.zh.md
docs/multi-cloud-deployment.zh.md
```

核心命令：

```bash
npm run migrate:cloud-data
npm run start:cloud
```

天翼云桌面 Windows 试运行可直接使用：

```powershell
powershell -ExecutionPolicy Bypass -File .\cloud\windows\setup-cloud-desktop.ps1
```

正式云服务器或多云部署可以优先使用 GHCR 镜像：

```bash
docker compose -f docker-compose.ghcr.yml up -d
```

## Windows 绿色版

后续优先给 Jeff 发安装包；绿色版保留给临时测试或无需安装的场景。

生成免安装版：

```bash
npm run build:desktop
```

生成给 Jeff 传输的干净 `.7z` 包：

```bash
npm run package:desktop
```

生成目录和压缩包：

```text
release/JeffOrderTool
release-archives/JeffOrderTool-v版本号.7z
```

发给 Jeff 时优先发送 `release-archives` 里的 `.7z`。不要直接压缩本机测试过的 `release/JeffOrderTool` 目录，因为本机测试启动后会生成 `data` 和密码记录，直接发出容易把测试密码一起带过去。

Jeff 解压后只需要双击：

```text
打开Jeff订单工具.exe
```

工具会自动启动后台服务并打开浏览器。用完可以直接关闭浏览器；如果要关闭后台服务，可以打开 `SupportFiles` 文件夹并双击：

```text
CloseJeffOrderTool.exe
```

绿色版的数据保存在 Jeff 解压目录里的 `data` 文件夹，后续升级或云端迁移时复制这个 `data` 文件夹即可。

如果 Jeff 的电脑提示启动超时，查看绿色版目录下的 `logs/server.log`。这个文件会记录后台服务启动失败的具体原因。

给 Jeff 更新新版时，先备份旧 `JeffOrderTool/data`，再解压新的 `.7z`，最后把旧 `data` 文件夹放回新版目录。不要用我们本机的测试 `data` 覆盖 Jeff 的业务数据。

如果 Jeff 忘记密码或电脑重启后密码异常，打开 `SupportFiles`，双击 `ResetJeffOrderToolPassword.exe`。新版重置工具会同时关闭后台服务；提示完成后重新双击“Jeff订单工具”，页面会进入重新设置密码；订单数据不会删除。

## Windows 安装包和更新

生成安装包：

```bash
npm run package:installer
```

生成文件：

```text
release-installers/JeffOrderToolSetup-v版本号.exe
```

当前建议给 Jeff 发送 `release-installers/JeffOrderToolSetup-v0.1.20.exe`。该版本包含多次先交、剩余未交、紧凑订单详情和旧版 `.db` 导入能力，并使用修复后的 Windows 更新器。

安装包默认安装到当前 Windows 用户目录：

```text
%LOCALAPPDATA%\Programs\JeffOrderTool
```

安装后会创建桌面快捷方式“Jeff订单工具”。升级安装会覆盖程序文件，但保留安装目录里的 `data` 和 `logs`。

### 从绿色版迁移到安装版

如果 Jeff 已经使用过绿色版，建议直接发送 `0.1.12` 或更高版本安装包。安装版第一次启动时，如果安装目录里还没有订单数据库，或安装版只有空库没有真实订单，会自动在桌面、下载、文档、`D:\tools` 等常见位置查找旧绿色版的 `data/orders.db`，找到后复制整份旧 `data` 文件夹到安装目录。

Jeff 当前旧绿色版目录是：

```text
D:\tools\JeffOrderTool-v0.1.8
```

如果里面是压缩包默认结构，真实数据通常在：

```text
D:\tools\JeffOrderTool-v0.1.8\JeffOrderTool\data
```

给 Jeff 的操作口径：

1. 不要删除旧的绿色版文件夹。
2. 双击安装包完成安装。
3. 从桌面“Jeff订单工具”图标打开。
4. 打开后确认旧订单还在，后续只用桌面图标打开，不再打开旧绿色版。

应用内“软件更新”默认检查 GitHub Releases：

```text
https://github.com/MelodyJayai/jeff-order-tool/releases
```

发布新版时，把 `release-installers/JeffOrderToolSetup-v版本号.exe` 上传到对应 GitHub Release。Jeff 本机检测到新版后，可以在工具里点“更新到 x.x.x”；工具会先自动备份数据库，再下载安装到原目录，最后重新打开。更新结果会直接显示在软件更新卡片中，卡片也提供“手动下载安装包”作为备用入口。

如果以后不用 GitHub Releases，也可以设置静态更新清单：

```text
JEFF_UPDATE_MANIFEST_URL=https://example.com/jeff-order-tool/update.json
```

清单格式：

```json
{
  "version": "0.1.8",
  "assetName": "JeffOrderToolSetup-v0.1.8.exe",
  "downloadUrl": "https://example.com/JeffOrderToolSetup-v0.1.8.exe",
  "releaseUrl": "https://example.com/releases/0.1.8"
}
```

## 两台电脑使用

两台电脑不要分别运行两套 `JeffOrderTool`，否则会变成两份数据。

推荐方式：

1. 固定一台办公室电脑作为主机，双击打开工具。
2. 另一台电脑连接同一个 Wi-Fi 或局域网。
3. 在主机页面找到“手机/其他电脑访问”的地址。
4. 另一台电脑用 Edge 打开这个地址。

这样两台电脑登记、查询、核销的都是主机上的同一份订单总表。

## 数据文件

SQLite 数据库会自动创建在：

```text
data/orders.db
```

这个文件就是本地数据，已经加入 `.gitignore`。备份时复制 `data` 目录即可。

备份文件默认保存在：

```text
data/backups
```

## 后续云端兼容

当前版本的数据结构按“先本地试用，后续可迁移云端”设计：

- 订单使用稳定的内部 ID；业务订单号按“公司 + 订单号”判断唯一，不同公司允许使用相同订单号。
- 日期字段统一保存为文本日期，方便导入云端数据库。
- 公司、工厂、细分类数量、返厂数量、核销状态、急单等级都是结构化字段。
- 数据库会记录 `schema_version` 和 `schema_migrations`，后续版本可以识别旧数据并自动升级。
- 安装版更新只替换程序文件，`data` 目录继续保留，可作为未来云端迁移来源。

将来迁移云端时，优先复制完整 `data` 目录，再由迁移脚本导入云端数据库。

导出 PostgreSQL 导入 SQL：

```bash
npm run export:postgres
```

默认输出：

```text
data/jeff-order-postgres-import.sql
```

## 检查命令

```bash
npm run lint
npm run build
npm run build:desktop
npm run package:desktop
npm run backup:daily
```

## 许可证

MIT
