# macOS 支持说明

Jeff 订单工具的业务页面、SQLite 数据库、云端同步接口和 Windows 版使用同一套 TypeScript 代码。macOS 版通过 Node.js 运行 Next.js 服务，不依赖 Windows 的 `.exe` 启动器、PowerShell 或 DPAPI。

## 首次运行

安装 Node.js LTS 后，在项目目录执行：

```bash
npm install
npm run build
npm run start:mac
```

脚本会等待本机健康检查通过，再使用 macOS 的 `open` 命令打开 `http://127.0.0.1:3000`。也可以直接双击 `start-jeff-order-tool.command`（或在终端运行 `start-jeff-order-tool.sh`）。

## 数据位置和备份

macOS 默认数据目录是：

```text
~/Library/Application Support/JeffOrderTool/data
```

其中包含 `orders.db`、SQLite WAL 文件、每日备份和服务日志。升级程序时只替换程序目录，保留这个 `data` 目录即可。需要迁移到另一台 Mac 时，退出服务后复制整个 `data` 目录。

也可以用环境变量指定位置：

```bash
export JEFF_ORDER_DATA_DIR="$HOME/JeffOrderToolData"
```

## 云端同步凭据

Windows 继续使用当前用户 DPAPI。macOS 使用系统钥匙串保存同步令牌，配置文件只保存钥匙串引用；重新配对或断开云端时会删除旧钥匙串项。若钥匙串弹出访问确认，请允许 Jeff 订单工具访问该项目。

## 构建可运行目录

```bash
npm run build:desktop:mac
```

输出目录为 `release/JeffOrderTool`，其中包含匹配当前 Mac 架构的 Node.js 运行时和可双击的 `start-jeff-order-tool.command`。从源码运行仍需先安装 Node.js LTS；目录中不包含 Windows `.exe` 启动器。macOS 版暂不执行网页内 Windows 安装包更新，升级时下载新版本后保留 `~/Library/Application Support/JeffOrderTool/data`。
