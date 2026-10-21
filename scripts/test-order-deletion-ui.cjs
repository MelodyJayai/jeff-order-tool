/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const { spawn, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const Database = require("better-sqlite3");
const net = require("node:net");

const project = path.resolve(__dirname, "..");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "jeff-delete-ui-"));
const databasePath = path.join(temporary, "orders.db");
const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const password = "test-only-delete-2026";
const children = [];
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, label) {
  for (let attempt = 0; attempt < 120; attempt++) {
    try { if (await check()) return; } catch { /* navigation in progress */ }
    await pause(150);
  }
  throw new Error(`Timed out: ${label}`);
}
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
function launch(binary, args, extraEnv = {}) {
  const process = spawn(binary, args, {
    cwd: project, env: { ...global.process.env, ...extraEnv },
    windowsHide: true, stdio: "ignore",
  });
  children.push(process);
  return process;
}
function row(id) {
  const connection = new Database(databasePath, { readonly: true });
  try { return connection.prepare("SELECT * FROM orders WHERE id = ?").get(id); }
  finally { connection.close(); }
}

class CDP {
  constructor(ws) {
    this.ws = ws; this.serial = 0; this.pending = new Map(); this.dialogs = [];
    ws.addEventListener("message", ({ data }) => {
      const message = JSON.parse(String(data));
      if (message.id) {
        const task = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) task.reject(new Error(message.error.message));
        else task.resolve(message.result);
      } else if (message.method === "Page.javascriptDialogOpening") {
        this.dialogs.push(message.params);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.serial;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", { expression, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  }
  async dialog(type, matches, accept) {
    await until(() => this.dialogs.length > 0, "dialog");
    const dialog = this.dialogs.shift();
    assert.equal(dialog.type, type);
    assert.match(dialog.message, matches);
    await this.send("Page.handleJavaScriptDialog", { accept });
    return dialog.message;
  }
}

(async () => {
  const fixture = path.join(temporary, "fixture.mts");
  fs.writeFileSync(fixture, `
    const db = await import(${JSON.stringify(pathToFileURL(path.join(project, "src/lib/db.ts")).href)});
    for (const [submissionKey, code] of [["first", "SAME"], ["second", "SAME"], ["delivery", "DELIVERED"], ["closed", "CLOSED"]]) {
      db.createOrders({ submissionKey, codes: [code], companyName: "UI Test Company",
        factoryName: "新奇洋服", firstDelivery: "", customerName: "", quantity: 2,
        suitQuantity: 0, jacketQuantity: 2, pantQuantity: 0, vestQuantity: 0, coatQuantity: 0,
        registeredAt: "2026-10-21", urgency: "NORMAL", note: "", deliveryRequest: null, initialDelivery: null });
    }
    const orders = db.listOrders();
    db.addOrderDelivery({ orderId: orders.find(o => o.code === "DELIVERED").id,
      deliveredAt: "2026-10-21", suitQuantity: 0, jacketQuantity: 1, pantQuantity: 0, vestQuantity: 0, coatQuantity: 0, note: "" });
    db.writeOffOrder(orders.find(o => o.code === "CLOSED").id, "2026-10-21");
    db.closeDatabaseForMigration();
  `);
  const testEnv = {
    JEFF_ORDER_DB_PATH: databasePath, JEFF_BACKUP_DIR: path.join(temporary, "backups"),
    JEFF_ADMIN_PASSWORD: password, JEFF_DEPLOYMENT_MODE: "", JEFF_COOKIE_SECURE: "false",
    JEFF_CLOUD_SYNC_READ_ONLY: "false", NEXT_PUBLIC_SITE_URL: "",
  };
  execFileSync(global.process.execPath, [path.join(project, "node_modules/tsx/dist/cli.mjs"), fixture], {
    cwd: project, env: { ...global.process.env, ...testEnv }, windowsHide: true,
  });
  const connection = new Database(databasePath);
  const orders = connection.prepare("SELECT id, code FROM orders ORDER BY created_at, id").all();
  connection.close();
  const same = orders.filter((order) => order.code === "SAME");
  const appPort = await freePort(), debugPort = await freePort();
  const base = `http://127.0.0.1:${appPort}`;
  launch(global.process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(appPort)], testEnv);
  await until(async () => (await fetch(`${base}/api/health`)).ok, "app ready");
  launch(edgePath, ["--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-background-networking",
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${path.join(temporary, "edge-profile")}`, "about:blank"]);
  let target;
  await until(async () => {
    const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
    target = pages.find((page) => page.type === "page"); return target;
  }, "headless browser");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));
  const cdp = new CDP(ws);
  await cdp.send("Page.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp.send("Page.navigate", { url: base });
  await until(() => cdp.evaluate('Boolean(document.querySelector("input[name=password]"))'), "login");
  await cdp.evaluate(`document.querySelector('input[name=password]').value=${JSON.stringify(password)}; document.querySelector('input[name=password]').form.requestSubmit()`);
  const deleteSelector = 'button[title="删除误登记订单"],button[title="查看不能删除的原因"]';
  await until(() => cdp.evaluate(`Boolean(document.querySelector(${JSON.stringify(deleteSelector)}))`), "delete entry");
  await pause(500);
  const choose = async (code, id) => {
    await cdp.evaluate(`(() => {
      const input = document.querySelector('input[name="query"]') || document.querySelector('input[placeholder*="输入订单号、公司"]');
      input.focus(); input.select();
    })()`);
    await cdp.send("Input.insertText", { text: code });
    await until(() => cdp.evaluate(`Array.from(document.querySelectorAll('button')).some(b => b.textContent.includes(${JSON.stringify(code)}))`), "search result");
    if (id) {
      // Same-number results display registration details; select the corresponding record via form after row selection.
      await cdp.evaluate(`(() => { const buttons = Array.from(document.querySelectorAll('button')).filter(b => b.textContent.includes(${JSON.stringify(code)}) && b.textContent.includes('登记')); buttons[0]?.click(); })()`);
    }
    const expectedIds = id ? same.map((item) => item.id) : [orders.find((order) => order.code === code).id];
    await until(() => cdp.evaluate(`${JSON.stringify(expectedIds)}.includes(document.querySelector(${JSON.stringify(deleteSelector)}).form.querySelector('[name=id]').value)`), `selected order ${code}`);
  };
  const clickDelete = () => cdp.evaluate(`setTimeout(() => document.querySelector(${JSON.stringify(deleteSelector)}).click(), 0)`);
  await choose("DELIVERED"); await clickDelete();
  await cdp.dialog("alert", /实际交货.*删除会/, true);
  await choose("CLOSED"); await clickDelete();
  await cdp.dialog("alert", /出货核销.*删除会/, true);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await pause(250);
  await clickDelete(); await cdp.dialog("alert", /出货核销/, true);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await choose("SAME", same[0].id);
  const selectedId = await cdp.evaluate(`document.querySelector(${JSON.stringify(deleteSelector)}).form.querySelector('[name=id]').value`);
  await clickDelete();
  const confirm = await cdp.dialog("confirm", /UI Test Company[\s\S]*SAME[\s\S]*2026-10-21[\s\S]*无法在页面上撤销/, false);
  assert.match(confirm, /数量：2 件/);
  assert.ok(row(selectedId), "cancel preserves order");
  await cdp.evaluate(`document.querySelector(${JSON.stringify(deleteSelector)}).form.querySelector('[name=expectedUpdatedAt]').value='old-page'`);
  await clickDelete(); await cdp.dialog("confirm", /SAME/, true);
  await cdp.dialog("alert", /又被修改过/, true);
  assert.ok(row(selectedId), "stale form must not delete");
  await cdp.send("Page.reload");
  await until(() => cdp.evaluate(`Boolean(document.querySelector(${JSON.stringify(deleteSelector)}))`), "reload");
  await choose("SAME", same[0].id);
  await clickDelete(); await cdp.dialog("confirm", /SAME/, true);
  await until(() => !row(selectedId), "delete persisted");
  assert.ok(row(same.find((item) => item.id !== selectedId).id), "same-number peer remains");
  const screenshot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const output = path.join(project, "release-installers", "delete-button-v0.1.31.png");
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, Buffer.from(screenshot.data, "base64"));
  const readOnlyPort = await freePort();
  const readOnlyBase = `http://127.0.0.1:${readOnlyPort}`;
  launch(global.process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(readOnlyPort)], {
    ...testEnv, JEFF_DEPLOYMENT_MODE: "cloud", JEFF_CLOUD_SYNC_READ_ONLY: "true",
  });
  await until(async () => (await fetch(`${readOnlyBase}/api/health`)).ok, "read-only app ready");
  await cdp.send("Page.navigate", { url: readOnlyBase });
  await until(() => cdp.evaluate(`Boolean(document.querySelector(${JSON.stringify(deleteSelector)}))`), "read-only entry");
  await pause(500);
  await clickDelete(); await cdp.dialog("alert", /云端只读.*办公室电脑/, true);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await pause(250);
  await clickDelete(); await cdp.dialog("alert", /云端只读/, true);
  assert.ok(row(same.find((item) => item.id !== selectedId).id));
  console.log("Deletion UI smoke passed: desktop/mobile entry, protected/read-only reasons, cancel, stale refusal, selected-ID deletion.");
  console.log(`Screenshot: ${output}`);
  await cdp.send("Browser.close");
})().catch((error) => { console.error(error); global.process.exitCode = 1; }).finally(async () => {
  for (const child of children) {
    try { if (child.exitCode === null) child.kill(); } catch { /* already exited */ }
  }
  await pause(500);
  try { fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* transient Windows file lock */ }
});
