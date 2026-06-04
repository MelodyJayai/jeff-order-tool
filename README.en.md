# Jeff Order Tool

[中文说明](./README.md)

Jeff Order Tool is a lightweight order registration and shipment write-off tool for small garment workshops, tailoring shops, processing factories, and similar teams that still rely on paper notebooks or ad-hoc spreadsheets.

It was originally built from a real workshop workflow: register order numbers when orders arrive, automatically record registration dates, search by order number, mark shipped orders, and keep urgent orders visible.

The data is kept in one long-running order table. It is not split by month.

## Why This Exists

Many small workshops do not need a full ERP system. They need a practical tool that makes these daily tasks easier:

- Register an order number.
- Record quantities by product type.
- Search an order number quickly.
- Mark an order as shipped.
- Automatically record registration and shipment dates.
- Track partial delivery notes.
- Keep urgent orders at the top.
- Open the same local tool from a phone on the office Wi-Fi.

This repository contains only the application source code. Real order data, local SQLite databases, generated Windows packages, and logs are ignored by Git.

## Main Features

- One persistent order table, no monthly table splitting.
- Manual order-number registration.
- Automatic registration date.
- Search by order number.
- Shipment write-off with automatic shipment date.
- Fine category quantities:
  - Suit set
  - Shirt / top
  - Pants
  - Vest
  - Coat
- Urgency levels.
- Partial delivery quantity/date/note fields.
- CSV export.
- CSV import with order-number based update/insert.
- Operation log for registration, updates, partial delivery, write-off, and undo.
- Consistent SQLite backup download.
- Mobile mode for search, viewing, urgent orders, and shipment write-off.
- Desktop-only registration and detail editing.
- Local Wi-Fi phone access QR code.
- SQLite storage with schema version metadata for future migration.
- Windows green-package build for non-technical users.

## Data Model And Future Migration

The local data is stored in SQLite:

```text
data/orders.db
```

The database is designed with future migration in mind:

- Orders use stable internal IDs.
- Order numbers are stored as searchable structured fields.
- Dates are stored as text dates.
- Shipment status, urgency, and fine-category quantities are structured fields.
- The database records `schema_version` and `schema_migrations`.

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

## Windows Green Package

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
- Import CSV rows. Existing order numbers are updated; new order numbers are created.
- View recent operation logs.

Duplicate shipment write-off is also blocked on the server side, so repeated clicks do not create repeated write-off records.

## Build And Check

```bash
npm run lint
npm run build
npm run build:desktop
```

## Security And Privacy

Do not commit real workshop data. The following are intentionally ignored:

- `data/*.db`
- `data/*.db-*`
- `release/`
- `logs/`
- `node_modules/`
- `.next/`

Before publishing a new release, make sure the packaged `data` directory does not contain real customer/order data.

## License

MIT
