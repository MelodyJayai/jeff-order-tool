# Jeff Order Tool

[中文说明](./README.md)

Jeff Order Tool is a lightweight order registration and shipment write-off tool for small garment workshops, tailoring shops, processing factories, and similar teams that still rely on paper notebooks or ad-hoc spreadsheets.

It was originally built from a real workshop workflow: register order numbers when orders arrive, automatically record registration dates, search by order number, mark shipped orders, and keep urgent orders visible.

The data is kept in one long-running order table. It is not split by month.

## Why This Exists

Many small workshops do not need a full ERP system. They need a practical tool that makes these daily tasks easier:

- Register an order number.
- Select the company and factory for an order.
- Record quantities by product type.
- See pending write-off quantities by product type.
- Mark what the customer wants to deliver first before the full order is done.
- Search an order number quickly.
- Mark an order as shipped.
- Mark returned-for-alteration items by product type after shipment.
- Automatically record registration and shipment dates.
- Track partial delivery notes.
- Keep urgent orders at the top.
- Open the same local tool from a phone on the office Wi-Fi.

This repository contains only the application source code. Real order data, local SQLite databases, generated Windows packages, and logs are ignored by Git.

## Login And First Setup

On the first visit, if no admin password is configured, the app opens `/setup` and asks for an admin password with at least 8 characters.

After setup, both desktop and phone access require login. The desktop header includes a logout button.

For cloud deployment, you can also configure the password through an environment variable:

```text
JEFF_ADMIN_PASSWORD=replace-with-a-strong-password
```

If `JEFF_ADMIN_PASSWORD` is set, the app uses it and skips the first-setup page.

## Main Features

- One persistent order table, no monthly table splitting.
- Manual order-number registration.
- Company and factory selection fields.
- Automatic registration date.
- Search by order number.
- Shipment write-off with automatic shipment date.
- Returned-for-alteration workflow after shipment, with quantities recorded by fine category.
- First-delivery request selection, such as "deliver one suit first" or "deliver pants first".
- Fine category quantities:
  - Suit set
  - Shirt / top
  - Pants
  - Vest
  - Coat
- Pending write-off quantity summary by fine category.
- Paired quantity labels, such as "Suit set 128" and "Shirt 98", so totals are easier to read.
- Urgency levels.
- Partial delivery quantity/date/note fields, kept separate from first-delivery requests.
- CSV export.
- CSV import with order-number based update/insert.
- Legacy SQLite `.db` backup import, useful when migrating from the old portable package to the installed version.
- Operation log page for registration, updates, partial delivery, write-off, returned alterations, returned-alteration completion, and undo.
- Consistent SQLite backup download.
- Login protection with first-run admin password setup.
- Automatic backup before CSV import.
- Daily backup helper and protected health page.
- Mobile mode for search, viewing, urgent orders, shipment write-off, returned alterations, and returned-alteration completion.
- Desktop-only registration and detail editing.
- Local Wi-Fi phone access QR code.
- SQLite storage with schema version metadata for future migration.
- Windows green-package build for non-technical users.
- Windows installer build and in-app update checks through GitHub Releases.

## Data Model And Future Migration

The local data is stored in SQLite:

```text
data/orders.db
```

The database is designed with future migration in mind:

- Orders use stable internal IDs.
- Order numbers are stored as searchable structured fields.
- Dates are stored as text dates.
- Company, factory, first-delivery request, shipment status, returned-alteration quantities, urgency, and fine-category quantities are structured fields.
- The database records `schema_version` and `schema_migrations`.

Company and factory options are maintained in:

```text
src/lib/companies.ts
```

The first company list has been populated from Jeff's chat feedback and the receipt photos in `companylist`. Factory options are currently set to `新奇洋服` and `度邦洋服`. Add future company or factory names in the same file.

If the tool is later moved to a cloud server, the recommended migration source is the complete `data` directory, not only a single `orders.db` file. SQLite may also use `orders.db-wal` and `orders.db-shm` while running.

Export PostgreSQL import SQL:

```bash
npm run export:postgres
```

Default output:

```text
data/jeff-order-postgres-import.sql
```

## Development

Install dependencies:

```bash
npm install
```

Run the local development server:

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

Run on the office LAN so a phone on the same Wi-Fi can access it:

```bash
npm run dev:lan
```

Then open the computer's LAN IP from the phone, for example:

```text
http://192.168.1.20:3000
```

The desktop page also shows a QR code for phone access when a private LAN address is detected.

## Cloud Deployment

For Jeff's multi-device workflow, use the cloud mode so phones and computers edit the same server-side data. Cloud mode keeps login protection, uses a fixed data directory, hides the Windows installer update card, and supports both a Windows cloud-desktop trial and a Docker deployment.

Chinese deployment guide:

```text
docs/cloud-deployment.zh.md
docs/multi-cloud-deployment.zh.md
```

Core commands:

```bash
npm run migrate:cloud-data
npm run start:cloud
```

For a Windows cloud-desktop trial, use:

```powershell
powershell -ExecutionPolicy Bypass -File .\cloud\windows\setup-cloud-desktop.ps1
```

For a cloud VM or multi-cloud Docker deployment, prefer the GHCR image:

```bash
docker compose -f docker-compose.ghcr.yml up -d
```

## Windows Green Package

For real end users, prefer the Windows installer. The green package is still useful for quick testing or portable use.

This project can build a portable Windows folder for users who do not know how to use the command line.

Build it with:

```bash
npm run build:desktop
```

Output:

```text
release/JeffOrderTool
```

The user opens:

```text
打开Jeff订单工具.exe
```

That launcher starts the local background service and opens the browser automatically.

The support shutdown tool is stored under:

```text
SupportFiles/CloseJeffOrderTool.exe
```

The green-package data lives in:

```text
release/JeffOrderTool/data
```

When upgrading an existing user, keep their `data` folder. Do not overwrite or delete it.

If startup fails, check:

```text
logs/server.log
```

If the password needs to be reset, run:

```text
SupportFiles/ResetJeffOrderToolPassword.exe
```

The reset helper closes the background service. Reopen Jeff Order Tool after the prompt; the app should show the first-setup password page. Order data is not deleted.

## Windows Installer And Updates

Build the installer:

```bash
npm run package:installer
```

Output:

```text
release-installers/JeffOrderToolSetup-vVERSION.exe
```

For Jeff, the current recommended installer is `release-installers/JeffOrderToolSetup-v0.1.18.exe`. It keeps the first-delivery request and legacy `.db` import features validated in `0.1.16`, includes the `0.1.17` quantity-summary readability improvement, and makes the in-app updater more reliable when stopping the old service and restarting the tool.

The installer defaults to the current Windows user's local app directory:

```text
%LOCALAPPDATA%\Programs\JeffOrderTool
```

It creates a desktop shortcut. Upgrade installs overwrite program files but keep `data` and `logs`.

### Migrating From The Green Package To The Installer

If a user has already entered data in the green package, send installer `0.1.12` or newer. On first launch, if the installer data folder does not yet contain `orders.db`, or if the installed database is still empty with no real orders, the launcher searches common locations such as Desktop, Downloads, Documents, and `D:\tools` for an old green-package `data/orders.db`. When it finds one, it copies the whole old `data` folder into the installed app directory.

Jeff's current old green-package folder is:

```text
D:\tools\JeffOrderTool-v0.1.8
```

If it keeps the default archive structure, the real data is usually under:

```text
D:\tools\JeffOrderTool-v0.1.8\JeffOrderTool\data
```

Recommended user instructions:

1. Do not delete the old green-package folder.
2. Run the installer.
3. Open Jeff Order Tool from the desktop shortcut.
4. Confirm the old orders are still visible, then use only the desktop shortcut from then on.

The in-app update card checks GitHub Releases by default:

```text
https://github.com/MelodyJayai/jeff-order-tool/releases
```

When publishing a new version, upload `release-installers/JeffOrderToolSetup-vVERSION.exe` to the matching GitHub Release. Installed users can click the update button in the app; the app creates a database backup, downloads the installer, runs it silently in the existing install directory, and reopens the tool.

You can also use a static update manifest instead of GitHub Releases:

```text
JEFF_UPDATE_MANIFEST_URL=https://example.com/jeff-order-tool/update.json
```

Manifest format:

```json
{
  "version": "0.1.8",
  "assetName": "JeffOrderToolSetup-v0.1.8.exe",
  "downloadUrl": "https://example.com/JeffOrderToolSetup-v0.1.8.exe",
  "releaseUrl": "https://example.com/releases/0.1.8"
}
```

## Office Phone Access

When the computer and phone are on the same Wi-Fi:

1. Start the tool on the Windows computer.
2. Find the "手机访问" / phone access card on the desktop page.
3. Scan the QR code with the phone camera.
4. The phone opens the same order table.
5. Phone mode allows search, viewing, urgent-order checking, and shipment write-off.

If the phone cannot connect, check:

- The phone and computer are on the same Wi-Fi.
- Windows Firewall allows private network access for Node.js or this tool.
- The computer is awake and connected to the network.

This is local network access. It is not a public cloud deployment.

## Data Tools

The desktop UI includes a data tools card:

- Download a consistent SQLite backup.
- Import CSV rows. Existing order numbers are updated; new order numbers are created. A backup is created before import.
- View recent operation logs, with a full `/events` page for the latest 500 events.

Duplicate shipment write-off is also blocked by the server-side database update condition, so repeated clicks do not create repeated write-off records.

## Backup And Health Check

When the home page opens, the app checks whether today's daily backup already exists. If not, it creates one under the backup directory.

After login, open `/health` or click "检查" in the desktop header to view:

- Login protection status.
- Database status.
- Order and operation-log counts.
- Latest backup time and backup directory.

For cloud servers or scheduled tasks:

```bash
npm run backup:daily
```

Default backup directory:

```text
data/backups
```

Useful environment variables:

```text
JEFF_ORDER_DB_PATH=
JEFF_BACKUP_DIR=
JEFF_BACKUP_RETENTION_DAYS=30
NEXT_PUBLIC_SITE_URL=
JEFF_COOKIE_SECURE=false
```

## Build And Check

```bash
npm run lint
npm run build
npm run build:desktop
npm run package:desktop
npm run package:installer
```

Send users the clean `.7z` file from `release-archives`. Do not directly zip a locally tested `release/JeffOrderTool` folder, because local test runs create `data` and password files.

## Security And Privacy

Do not commit real workshop data. The following are intentionally ignored:

- `data/*.db`
- `data/*.db-*`
- `release/`
- `release-package/`
- `release-archives/`
- `release-installers/`
- `logs/`
- `node_modules/`
- `.next/`

Before publishing a new release, make sure the packaged `data` directory does not contain real customer/order data.

## License

MIT
