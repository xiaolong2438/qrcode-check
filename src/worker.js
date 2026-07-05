import QRCode from "qrcode";
import { strToU8, zipSync } from "fflate";

const CHECK_ITEMS = [
  { key: "power", label: "电源正常" },
  { key: "water_pressure", label: "水压(2.0-5.0bar)" },
  { key: "chamber_clean", label: "清洗机内腔清洁、无杂物" },
  { key: "detergent_lube", label: "清洗剂；润滑油的量达到指定位置" },
  { key: "filter_spray_holes", label: "滤网；喷臂出水孔通畅" },
  { key: "spray_arm", label: "喷臂无变形；运转正常" },
  { key: "transfer_lock", label: "传送车；锁止杆；锁止钩；解锁钩灵活" },
  { key: "printer", label: "记录打印正常" },
  { key: "loading", label: "物品装载规范" }
];

const MACHINES = [
  { id: "cleaner-01", name: "1号清洗机启动前检查" },
  { id: "cleaner-02", name: "2号清洗机启动前检查" },
  { id: "cleaner-03", name: "3号清洗机启动前检查" }
];

const DEFAULT_MACHINE = MACHINES[0];

const encoder = new TextEncoder();

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      if (request.method === "GET" && url.pathname === "/") {
        return Response.redirect(`${url.origin}/check?machine=${DEFAULT_MACHINE.id}`, 302);
      }

      if (request.method === "GET" && url.pathname === "/check") {
        return html(checkPage(url), {
          "Cache-Control": "no-store"
        });
      }

      if (request.method === "POST" && url.pathname === "/api/records") {
        return createRecord(request, env);
      }

      if (request.method === "GET" && url.pathname === "/qr.svg") {
        return qrSvg(url);
      }

      if (request.method === "GET" && url.pathname === "/admin/label.svg") {
        const auth = requireAdmin(request, env);
        if (auth) return auth;
        return labelSvg(url);
      }

      if (url.pathname === "/admin" && request.method === "GET") {
        const auth = requireAdmin(request, env);
        if (auth) return auth;
        return html(await adminPage(request, env), {
          "Cache-Control": "no-store"
        });
      }

      if (url.pathname === "/admin/export" && request.method === "GET") {
        const auth = requireAdmin(request, env);
        if (auth) return auth;
        return exportWorkbook(request, env);
      }

      if (url.pathname.startsWith("/admin/records/") && request.method === "DELETE") {
        const auth = requireAdmin(request, env);
        if (auth) return auth;
        return deleteRecord(request, env);
      }

      if (url.pathname.startsWith("/admin/records/") && request.method === "PUT") {
        const auth = requireAdmin(request, env);
        if (auth) return auth;
        return updateRecord(request, env);
      }

      return new Response("Not found", { status: 404 });
    } catch (error) {
      console.error(error);
      return json({ ok: false, error: "服务器处理失败，请稍后重试。" }, 500);
    }
  }
};

function checkPage(url) {
  const machine = resolveMachine(url.searchParams.get("machine") || DEFAULT_MACHINE.id);
  const machineId = machine.id;
  const machineName = machine.name;
  const openedAt = new Date().toISOString();
  const items = CHECK_ITEMS.map((item) => inspectionItem(item)).join("");

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${escapeHtml(machineName)}扫码检查确认</title>
  <style>${css()}</style>
</head>
<body>
  <main class="shell">
    <section class="panel">
      <div class="topline">
        <div>
          <p class="eyebrow">微信扫码确认</p>
          <h1>${escapeHtml(machineName)}</h1>
        </div>
        <span class="badge">开机前</span>
      </div>

      <form id="inspectionForm">
        <input type="hidden" name="machineId" value="${escapeHtml(machineId)}">
        <input type="hidden" name="machineName" value="${escapeHtml(machineName)}">
        <input type="hidden" name="formOpenedAt" value="${openedAt}">

        <div class="grid two">
          <div class="autoTime">
            <span>检查日期</span>
            <strong>提交时自动记录当前时间</strong>
          </div>
          <label>
            <span>操作者签名</span>
            <input name="operatorName" placeholder="请输入姓名" maxlength="30" required>
          </label>
        </div>

        <div class="items">
          ${items}
        </div>

        <label>
          <span>总备注</span>
          <textarea name="overallRemark" rows="3" maxlength="500" placeholder="如有异常请填写处理说明或补充信息"></textarea>
        </label>

        <p class="hint">项目正常选“正常”；如有异常，请选择“异常”并填写对应备注。检查日期和提交时间由服务器自动记录。</p>
        <button class="primary" type="submit">提交检查记录</button>
      </form>
    </section>
  </main>
  <div id="toast" role="status" aria-live="polite"></div>
  <script>${clientJs()}</script>
</body>
</html>`;
}

function inspectionItem(item) {
  return `<fieldset class="item" data-key="${item.key}">
    <legend>${escapeHtml(item.label)}</legend>
    <div class="segmented">
      <label><input type="radio" name="${item.key}" value="ok" checked><span>正常</span></label>
      <label><input type="radio" name="${item.key}" value="abnormal"><span>异常</span></label>
    </div>
    <textarea name="${item.key}_remark" rows="2" maxlength="300" placeholder="异常备注"></textarea>
  </fieldset>`;
}

async function createRecord(request, env) {
  const database = getDb(env);
  const body = await request.json();
  const operatorName = cleanText(body.operatorName, 30);
  const now = new Date().toISOString();
  const recordDate = formatShanghaiDate(new Date(now));
  const machine = resolveMachine(body.machineId || DEFAULT_MACHINE.id);
  const machineId = machine.id;
  const machineName = machine.name;
  const overallRemark = cleanText(body.overallRemark || "", 500);
  const formOpenedAt = cleanText(body.formOpenedAt || "", 40);
  const clientSubmittedAt = cleanText(body.clientSubmittedAt || "", 40);

  if (!operatorName) {
    return json({ ok: false, error: "请填写操作者签名。" }, 400);
  }

  const checks = CHECK_ITEMS.map((item) => {
    const input = body.checks?.[item.key] || {};
    const status = input.status === "abnormal" ? "abnormal" : "ok";
    const remark = cleanText(input.remark || "", 300);
    return {
      key: item.key,
      label: item.label,
      status,
      remark
    };
  });

  const missingRemark = checks.find((item) => item.status === "abnormal" && !item.remark);
  if (missingRemark) {
    return json({ ok: false, error: `“${missingRemark.label}”异常时必须填写备注。` }, 400);
  }

  const id = crypto.randomUUID();
  const userAgent = cleanText(request.headers.get("user-agent") || "", 300);

  await database.prepare(
    `INSERT INTO inspection_records (
      id, machine_id, machine_name, record_date, operator_name, checks_json,
      overall_remark, form_opened_at, client_submitted_at, server_submitted_at, user_agent
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      machineId,
      machineName,
      recordDate,
      operatorName,
      JSON.stringify(checks),
      overallRemark,
      formOpenedAt,
      clientSubmittedAt,
      now,
      userAgent
    )
    .run();

  return json({
    ok: true,
    id,
    serverSubmittedAt: now,
    serverSubmittedAtText: formatShanghaiDateTime(now)
  });
}

async function adminPage(request, env) {
  getDb(env);
  const url = new URL(request.url);
  const month = normalizedMonth(url.searchParams.get("month")) || formatShanghaiMonth(new Date());
  const records = await listRecords(env, month);
  const checkUrl = `${url.origin}/check?machine=${DEFAULT_MACHINE.id}`;
  const qrUrl = `${url.origin}/qr.svg?text=${encodeURIComponent(checkUrl)}`;
  const qrCards = MACHINES.map((machine) => adminQrCard(url.origin, machine)).join("");
  const rows = records.map((record) => adminRow(record)).join("");

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>清洗机检查后台</title>
  <style>${css()}</style>
</head>
<body>
  <main class="admin">
    <header class="adminHeader">
      <div>
        <p class="eyebrow">后台</p>
        <h1>清洗机检查记录</h1>
      </div>
      <a class="ghost" href="${escapeAttr(qrUrl)}" target="_blank" rel="noopener">打开二维码</a>
    </header>

    <section class="toolbar">
      <form method="get" action="/admin" class="monthForm">
        <label>
          <span>月份</span>
          <input type="month" name="month" value="${escapeAttr(month)}">
        </label>
        <button type="submit">查看</button>
      </form>
      <a class="primary linkButton" href="/admin/export?month=${escapeAttr(month)}">导出本月 XLSX</a>
    </section>

    <section class="qrGrid">
      ${qrCards}
    </section>

    <section class="tableWrap">
      <table>
        <thead>
          <tr>
            <th>提交时间</th>
            <th>检查日期</th>
            <th>设备</th>
            <th>操作者</th>
            <th>异常项</th>
            <th>备注</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          ${rows || `<tr><td colspan="7" class="empty">这个月份还没有记录。</td></tr>`}
        </tbody>
      </table>
    </section>
  </main>
  ${adminEditModal()}
  <script>${adminJs()}</script>
</body>
</html>`;
}

function adminQrCard(origin, machine) {
  const checkUrl = `${origin}/check?machine=${machine.id}`;
  const qrUrl = `${origin}/qr.svg?text=${encodeURIComponent(checkUrl)}`;
  const labelUrl = `${origin}/admin/label.svg?machine=${encodeURIComponent(machine.id)}`;

  return `<article class="qrCard">
    <img src="${escapeAttr(qrUrl)}" width="160" height="160" alt="${escapeAttr(machine.name)}二维码">
    <div>
      <h2>${escapeHtml(machine.name)}</h2>
      <p>${escapeHtml(checkUrl)}</p>
      <a class="downloadLabel" href="${escapeAttr(labelUrl)}" download="${escapeAttr(machine.name)}.svg">下载打印图</a>
    </div>
  </article>`;
}

function adminRow(record) {
  const checks = parseChecks(record.checks_json);
  const abnormal = checks.filter((item) => item.status === "abnormal");
  const abnormalText = abnormal.length
    ? abnormal.map((item) => `${item.label}${item.remark ? `：${item.remark}` : ""}`).join("；")
    : "无";
  const editableRecord = {
    id: record.id,
    machineId: record.machine_id,
    machineName: record.machine_name,
    operatorName: record.operator_name,
    checks,
    overallRemark: record.overall_remark || ""
  };

  return `<tr>
    <td>${escapeHtml(formatShanghaiDateTime(record.server_submitted_at))}</td>
    <td>${escapeHtml(record.record_date)}</td>
    <td>${escapeHtml(record.machine_name)}</td>
    <td>${escapeHtml(record.operator_name)}</td>
    <td>${escapeHtml(abnormalText)}</td>
    <td>${escapeHtml(record.overall_remark || "")}</td>
    <td class="actionCell">
      <button class="editButton" type="button" data-edit-record="${escapeAttr(JSON.stringify(editableRecord))}">编辑</button>
      <button class="dangerButton" type="button" data-delete-id="${escapeAttr(record.id)}">删除</button>
    </td>
  </tr>`;
}

function adminEditModal() {
  const machineOptions = MACHINES.map((machine) =>
    `<option value="${escapeAttr(machine.id)}">${escapeHtml(machine.name)}</option>`
  ).join("");
  const items = CHECK_ITEMS.map((item) => adminEditItem(item)).join("");

  return `<div class="modalBackdrop" id="editModal" hidden>
    <div class="modalPanel" role="dialog" aria-modal="true" aria-labelledby="editModalTitle">
      <form id="editRecordForm" class="editForm">
        <div class="modalHeader">
          <h2 id="editModalTitle">编辑检查记录</h2>
          <button class="iconButton" type="button" data-close-edit aria-label="关闭">×</button>
        </div>
        <p class="modalNote">只修改检查数据，不改变原提交时间和检查日期。</p>
        <label>
          <span>设备</span>
          <select name="machineId" required>${machineOptions}</select>
        </label>
        <label>
          <span>操作者签名</span>
          <input name="operatorName" maxlength="30" required>
        </label>
        <div class="items">${items}</div>
        <label>
          <span>总备注</span>
          <textarea name="overallRemark" rows="3" maxlength="500"></textarea>
        </label>
        <div class="modalActions">
          <button type="button" class="ghost" data-close-edit>取消</button>
          <button type="submit" class="primary">保存修改</button>
        </div>
      </form>
    </div>
  </div>`;
}

function adminEditItem(item) {
  return `<fieldset class="item editItem" data-edit-key="${item.key}">
    <legend>${escapeHtml(item.label)}</legend>
    <div class="segmented">
      <label><input type="radio" name="${item.key}" value="ok"><span>正常</span></label>
      <label><input type="radio" name="${item.key}" value="abnormal"><span>异常</span></label>
    </div>
    <textarea name="${item.key}_remark" rows="2" maxlength="300" placeholder="异常备注"></textarea>
  </fieldset>`;
}

async function deleteRecord(request, env) {
  const database = getDb(env);
  const url = new URL(request.url);
  const id = cleanText(decodeURIComponent(url.pathname.replace("/admin/records/", "")), 80);

  if (!id) {
    return json({ ok: false, error: "记录 ID 不能为空。" }, 400);
  }

  const result = await database.prepare("DELETE FROM inspection_records WHERE id = ?")
    .bind(id)
    .run();

  return json({
    ok: true,
    deleted: result.meta?.changes || 0
  });
}

async function updateRecord(request, env) {
  const database = getDb(env);
  const url = new URL(request.url);
  const id = cleanText(decodeURIComponent(url.pathname.replace("/admin/records/", "")), 80);
  const body = await request.json();
  const operatorName = cleanText(body.operatorName, 30);
  const machine = resolveMachine(body.machineId || DEFAULT_MACHINE.id);
  const overallRemark = cleanText(body.overallRemark || "", 500);

  if (!id) {
    return json({ ok: false, error: "记录 ID 不能为空。" }, 400);
  }

  if (!operatorName) {
    return json({ ok: false, error: "请填写操作者签名。" }, 400);
  }

  const checks = CHECK_ITEMS.map((item) => {
    const input = body.checks?.[item.key] || {};
    const status = input.status === "abnormal" ? "abnormal" : "ok";
    const remark = cleanText(input.remark || "", 300);
    return {
      key: item.key,
      label: item.label,
      status,
      remark
    };
  });

  const missingRemark = checks.find((item) => item.status === "abnormal" && !item.remark);
  if (missingRemark) {
    return json({ ok: false, error: `“${missingRemark.label}”异常时必须填写备注。` }, 400);
  }

  const result = await database.prepare(
    `UPDATE inspection_records
     SET machine_id = ?, machine_name = ?, operator_name = ?, checks_json = ?, overall_remark = ?
     WHERE id = ?`
  )
    .bind(machine.id, machine.name, operatorName, JSON.stringify(checks), overallRemark, id)
    .run();

  return json({
    ok: true,
    updated: result.meta?.changes || 0
  });
}

async function exportWorkbook(request, env) {
  getDb(env);
  const url = new URL(request.url);
  const month = normalizedMonth(url.searchParams.get("month")) || formatShanghaiMonth(new Date());
  const records = await listRecords(env, month);
  const header = [
    "提交时间",
    "检查日期",
    "设备",
    "操作者签名",
    ...CHECK_ITEMS.map((item) => item.label),
    "异常备注",
    "总备注"
  ];
  const rows = records.map((record) => recordToExportRow(record));
  const sheets = [
    { name: "总表", rows },
    ...MACHINES.map((machine) => ({
      name: machine.name.replace("启动前检查", ""),
      rows: rows.filter((row) => row[2] === machine.name)
    }))
  ];

  const workbook = buildXlsxWorkbook(sheets, header);
  return new Response(workbook, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="cleaner-inspection-${month}.xlsx"`,
      "Cache-Control": "no-store"
    }
  });
}

function recordToExportRow(record) {
    const checks = parseChecks(record.checks_json);
    const byKey = Object.fromEntries(checks.map((item) => [item.key, item]));
    const abnormalNotes = checks
      .filter((item) => item.status === "abnormal" || item.remark)
      .map((item) => `${item.label}：${item.remark || "异常"}`)
      .join("；");

    return [
      formatShanghaiDateTime(record.server_submitted_at),
      record.record_date,
      record.machine_name,
      record.operator_name,
      ...CHECK_ITEMS.map((item) => (byKey[item.key]?.status === "abnormal" ? "异常" : "√")),
      abnormalNotes,
      record.overall_remark || ""
    ];
}

async function listRecords(env, month) {
  const database = getDb(env);
  const start = `${month}-01`;
  const end = nextMonth(month);
  const result = await database.prepare(
    `SELECT * FROM inspection_records
     WHERE record_date >= ? AND record_date < ?
     ORDER BY server_submitted_at DESC`
  )
    .bind(start, end)
    .all();
  return result.results || [];
}

async function qrSvg(url) {
  const text = url.searchParams.get("text") || `${url.origin}/check?machine=${DEFAULT_MACHINE.id}`;
  if (text.length > 500) {
    return new Response("QR text is too long", { status: 400 });
  }

  const svg = await QRCode.toString(text, {
    type: "svg",
    margin: 1,
    width: 360,
    errorCorrectionLevel: "M"
  });

  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600"
    }
  });
}

async function labelSvg(url) {
  const machine = resolveMachine(url.searchParams.get("machine") || DEFAULT_MACHINE.id);
  const checkUrl = `${url.origin}/check?machine=${machine.id}`;
  const qr = await QRCode.toString(checkUrl, {
    type: "svg",
    margin: 1,
    width: 300,
    errorCorrectionLevel: "M"
  });
  const viewBox = qr.match(/viewBox="([^"]+)"/)?.[1] || "0 0 35 35";
  const inner = qr
    .replace(/^<svg\b[^>]*>/, "")
    .replace(/<\/svg>\s*$/, "");
  const label = machine.name;
  const filename = encodeURIComponent(`${label}.svg`);
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="480" height="560" viewBox="0 0 480 560">
  <rect width="480" height="560" fill="#ffffff"/>
  <rect x="50" y="34" width="380" height="380" rx="12" fill="#ffffff" stroke="#d8ded2" stroke-width="2"/>
  <svg x="78" y="62" width="324" height="324" viewBox="${escapeAttr(viewBox)}" shape-rendering="crispEdges">
    ${inner}
  </svg>
  <text x="240" y="474" text-anchor="middle"
    font-family="Microsoft YaHei, PingFang SC, Noto Sans CJK SC, Arial, sans-serif"
    font-size="34" font-weight="700" fill="#111111">${escapeXml(label)}</text>
</svg>`;

  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
      "Cache-Control": "no-store"
    }
  });
}

function requireAdmin(request, env) {
  const expected = env.ADMIN_PASSWORD;
  if (!expected) {
    return new Response("ADMIN_PASSWORD is not configured.", { status: 500 });
  }

  const header = request.headers.get("authorization") || "";
  const prefix = "Basic ";
  if (!header.startsWith(prefix)) {
    return authChallenge();
  }

  let decoded = "";
  try {
    decoded = atob(header.slice(prefix.length));
  } catch {
    return authChallenge();
  }

  const separator = decoded.indexOf(":");
  const username = separator >= 0 ? decoded.slice(0, separator) : "";
  const password = separator >= 0 ? decoded.slice(separator + 1) : "";

  if (username !== "admin" || !constantTimeEqual(password, expected)) {
    return authChallenge();
  }

  return null;
}

function authChallenge() {
  return new Response("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Cleaner inspection admin", charset="UTF-8"'
    }
  });
}

function constantTimeEqual(left, right) {
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let index = 0; index < length; index += 1) {
    diff |= (a[index] || 0) ^ (b[index] || 0);
  }
  return diff === 0;
}

function normalizedMonth(value) {
  return /^\d{4}-\d{2}$/.test(value || "") ? value : "";
}

function nextMonth(month) {
  const [year, rawMonth] = month.split("-").map(Number);
  const next = rawMonth === 12 ? { year: year + 1, month: 1 } : { year, month: rawMonth + 1 };
  return `${next.year}-${String(next.month).padStart(2, "0")}-01`;
}

function formatShanghaiMonth(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit"
  }).format(date);
}

function formatShanghaiDate(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function formatShanghaiDateTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(date);
}

function parseChecks(value) {
  try {
    return JSON.parse(value || "[]");
  } catch {
    return [];
  }
}

function resolveMachine(value) {
  const id = cleanText(value, 64) || DEFAULT_MACHINE.id;
  return MACHINES.find((machine) => machine.id === id) || { id, name: id };
}

function cleanText(value, maxLength) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function buildXlsxWorkbook(sheets, header) {
  const sheetFiles = {};
  const workbookSheets = [];
  const workbookRelationships = [];

  sheets.forEach((sheet, index) => {
    const sheetNumber = index + 1;
    const safeName = sanitizeSheetName(sheet.name);
    sheetFiles[`xl/worksheets/sheet${sheetNumber}.xml`] = xmlBytes(buildWorksheetXml([header, ...sheet.rows]));
    workbookSheets.push(`<sheet name="${escapeXml(safeName)}" sheetId="${sheetNumber}" r:id="rId${sheetNumber}"/>`);
    workbookRelationships.push(`<Relationship Id="rId${sheetNumber}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${sheetNumber}.xml"/>`);
  });

  const files = {
    "[Content_Types].xml": xmlBytes(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`),
    "_rels/.rels": xmlBytes(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`),
    "xl/workbook.xml": xmlBytes(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>${workbookSheets.join("")}</sheets>
</workbook>`),
    "xl/_rels/workbook.xml.rels": xmlBytes(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${workbookRelationships.join("")}
  <Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`),
    "xl/styles.xml": xmlBytes(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="1"><font><sz val="11"/><name val="Microsoft YaHei"/></font></fonts>
  <fills count="1"><fill><patternFill patternType="none"/></fill></fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`),
    "docProps/core.xml": xmlBytes(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:creator>wechat-cleaner-check</dc:creator>
  <cp:lastModifiedBy>wechat-cleaner-check</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:modified>
</cp:coreProperties>`),
    "docProps/app.xml": xmlBytes(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>wechat-cleaner-check</Application>
</Properties>`),
    ...sheetFiles
  };

  return zipSync(files);
}

function buildWorksheetXml(rows) {
  const body = rows.map((row, rowIndex) => {
    const cells = row.map((value, columnIndex) => {
      const cellRef = `${columnName(columnIndex + 1)}${rowIndex + 1}`;
      return `<c r="${cellRef}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
    }).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");

  const columnCount = Math.max(...rows.map((row) => row.length), 1);
  const rowCount = Math.max(rows.length, 1);

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:${columnName(columnCount)}${rowCount}"/>
  <sheetViews><sheetView workbookViewId="0"/></sheetViews>
  <sheetData>${body}</sheetData>
</worksheet>`;
}

function xmlBytes(value) {
  return strToU8(value);
}

function columnName(index) {
  let name = "";
  let current = index;
  while (current > 0) {
    current -= 1;
    name = String.fromCharCode(65 + (current % 26)) + name;
    current = Math.floor(current / 26);
  }
  return name;
}

function sanitizeSheetName(value) {
  const name = String(value || "Sheet")
    .replace(/[:\\/?*\[\]]/g, " ")
    .trim()
    .slice(0, 31);
  return name || "Sheet";
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function html(markup, headers = {}) {
  return new Response(markup, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      ...headers
    }
  });
}

function getDb(env) {
  const database = env.cleaner_check_db || env.DB;
  if (!database) {
    throw new Error("D1 binding cleaner_check_db is not configured.");
  }
  return database;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function clientJs() {
  return `
const form = document.querySelector("#inspectionForm");
const toast = document.querySelector("#toast");

for (const fieldset of document.querySelectorAll(".item")) {
  const remark = fieldset.querySelector("textarea");
  const update = () => {
    const checked = fieldset.querySelector("input:checked").value;
    remark.classList.toggle("show", checked === "abnormal");
    remark.required = checked === "abnormal";
  };
  fieldset.addEventListener("change", update);
  update();
}

function showToast(message, kind = "ok") {
  toast.textContent = message;
  toast.className = kind;
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    toast.className = "";
  }, 3600);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = form.querySelector("button[type=submit]");
  const data = new FormData(form);
  const checks = {};

  for (const fieldset of document.querySelectorAll(".item")) {
    const key = fieldset.dataset.key;
    checks[key] = {
      status: data.get(key),
      remark: data.get(key + "_remark") || ""
    };
  }

  const payload = {
    machineId: data.get("machineId"),
    machineName: data.get("machineName"),
    formOpenedAt: data.get("formOpenedAt"),
    clientSubmittedAt: new Date().toISOString(),
    operatorName: data.get("operatorName"),
    overallRemark: data.get("overallRemark"),
    checks
  };

  button.disabled = true;
  button.textContent = "正在提交...";

  try {
    const response = await fetch("/api/records", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      throw new Error(result.error || "提交失败");
    }
    showToast("已提交，服务器记录时间：" + result.serverSubmittedAtText);
    form.reset();
    for (const fieldset of document.querySelectorAll(".item")) {
      fieldset.querySelector('input[value="ok"]').checked = true;
      fieldset.querySelector("textarea").value = "";
      fieldset.dispatchEvent(new Event("change"));
    }
  } catch (error) {
    showToast(error.message || "提交失败，请稍后重试。", "error");
  } finally {
    button.disabled = false;
    button.textContent = "提交检查记录";
  }
});`;
}

function adminJs() {
  return `
const adminCheckItems = ${JSON.stringify(CHECK_ITEMS)};
const editModal = document.querySelector("#editModal");
const editForm = document.querySelector("#editRecordForm");

for (const fieldset of document.querySelectorAll(".editItem")) {
  const remark = fieldset.querySelector("textarea");
  const update = () => {
    const checked = fieldset.querySelector("input:checked")?.value || "ok";
    remark.classList.toggle("show", checked === "abnormal");
    remark.required = checked === "abnormal";
  };
  fieldset.addEventListener("change", update);
  update();
}

function openEditModal(record) {
  editForm.dataset.recordId = record.id;
  editForm.elements.machineId.value = record.machineId || "cleaner-01";
  editForm.elements.operatorName.value = record.operatorName || "";
  editForm.elements.overallRemark.value = record.overallRemark || "";

  const byKey = Object.fromEntries((record.checks || []).map((item) => [item.key, item]));
  for (const item of adminCheckItems) {
    const saved = byKey[item.key] || {};
    const status = saved.status === "abnormal" ? "abnormal" : "ok";
    editForm.elements[item.key].value = status;
    editForm.elements[item.key + "_remark"].value = saved.remark || "";
    editForm.querySelector('[data-edit-key="' + item.key + '"]').dispatchEvent(new Event("change"));
  }

  editModal.hidden = false;
}

function closeEditModal() {
  editModal.hidden = true;
  editForm.reset();
  delete editForm.dataset.recordId;
}

document.addEventListener("click", async (event) => {
  const editButton = event.target.closest("[data-edit-record]");
  if (editButton) {
    openEditModal(JSON.parse(editButton.dataset.editRecord));
    return;
  }

  if (event.target.closest("[data-close-edit]") || event.target === editModal) {
    closeEditModal();
    return;
  }

  const button = event.target.closest("[data-delete-id]");
  if (!button) return;

  const confirmed = window.confirm("确定删除这条检查记录吗？删除后无法恢复。");
  if (!confirmed) return;

  button.disabled = true;
  button.textContent = "删除中...";

  try {
    const response = await fetch("/admin/records/" + encodeURIComponent(button.dataset.deleteId), {
      method: "DELETE"
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      throw new Error(result.error || "删除失败");
    }
    window.location.reload();
  } catch (error) {
    window.alert(error.message || "删除失败，请稍后重试。");
    button.disabled = false;
    button.textContent = "删除";
  }
});

editForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const id = editForm.dataset.recordId;
  if (!id) return;

  const submit = editForm.querySelector('button[type="submit"]');
  const data = new FormData(editForm);
  const checks = {};

  for (const item of adminCheckItems) {
    checks[item.key] = {
      status: data.get(item.key),
      remark: data.get(item.key + "_remark") || ""
    };
  }

  const payload = {
    machineId: data.get("machineId"),
    operatorName: data.get("operatorName"),
    overallRemark: data.get("overallRemark"),
    checks
  };

  submit.disabled = true;
  submit.textContent = "保存中...";

  try {
    const response = await fetch("/admin/records/" + encodeURIComponent(id), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      throw new Error(result.error || "保存失败");
    }
    window.location.reload();
  } catch (error) {
    window.alert(error.message || "保存失败，请稍后重试。");
    submit.disabled = false;
    submit.textContent = "保存修改";
  }
});`;
}

function css() {
  return `
:root {
  color-scheme: light;
  --bg: #f6f7f2;
  --panel: #ffffff;
  --ink: #18201b;
  --muted: #667063;
  --line: #dde3d6;
  --brand: #18794e;
  --brand-dark: #12623e;
  --warn: #b54708;
  --danger: #b42318;
  --soft: #eef6ed;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-height: 100vh;
  background: var(--bg);
  color: var(--ink);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
}

.shell {
  width: min(760px, 100%);
  margin: 0 auto;
  padding: 18px 14px 40px;
}

.panel,
.admin {
  background: var(--panel);
}

.panel {
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 22px;
  box-shadow: 0 16px 44px rgba(35, 46, 28, 0.08);
}

.topline,
.adminHeader,
.toolbar,
.qrBlock {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.eyebrow {
  margin: 0 0 6px;
  color: var(--brand);
  font-size: 13px;
  font-weight: 700;
}

h1 {
  margin: 0;
  font-size: 26px;
  line-height: 1.2;
}

h2 {
  margin: 0 0 8px;
  font-size: 18px;
}

.badge {
  flex: 0 0 auto;
  padding: 8px 12px;
  border-radius: 999px;
  background: var(--soft);
  color: var(--brand-dark);
  font-weight: 700;
}

form {
  display: grid;
  gap: 18px;
  margin-top: 24px;
}

.grid {
  display: grid;
  gap: 14px;
}

.two {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

label,
fieldset {
  display: grid;
  gap: 8px;
}

label > span,
.autoTime > span,
legend {
  color: var(--muted);
  font-size: 14px;
  font-weight: 700;
}

.autoTime {
  display: grid;
  gap: 8px;
}

.autoTime strong {
  min-height: 46px;
  display: flex;
  align-items: center;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #f7f9f4;
  color: var(--ink);
  padding: 12px;
  font-size: 15px;
}

input,
textarea,
select,
button {
  font: inherit;
}

input,
textarea,
select {
  width: 100%;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #fff;
  color: var(--ink);
  padding: 12px;
  outline: none;
}

input:focus,
textarea:focus,
select:focus {
  border-color: var(--brand);
  box-shadow: 0 0 0 3px rgba(24, 121, 78, 0.14);
}

.items {
  display: grid;
  gap: 12px;
}

.item {
  margin: 0;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 14px;
}

.segmented {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.segmented label {
  display: block;
}

.segmented input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.segmented span {
  display: grid;
  min-height: 42px;
  place-items: center;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #fff;
  color: var(--muted);
  font-weight: 700;
}

.segmented input:checked + span {
  border-color: var(--brand);
  background: var(--soft);
  color: var(--brand-dark);
}

.segmented input[value="abnormal"]:checked + span {
  border-color: var(--warn);
  background: #fff4e8;
  color: var(--warn);
}

.item textarea {
  display: none;
}

.item textarea.show {
  display: block;
}

.hint {
  margin: 0;
  color: var(--muted);
  font-size: 14px;
  line-height: 1.6;
}

button,
.linkButton,
.ghost {
  min-height: 44px;
  border: 0;
  border-radius: 8px;
  padding: 0 18px;
  cursor: pointer;
  font-weight: 800;
  text-decoration: none;
  display: inline-grid;
  place-items: center;
}

.primary {
  background: var(--brand);
  color: white;
}

.primary:hover {
  background: var(--brand-dark);
}

.primary:disabled {
  cursor: wait;
  opacity: 0.65;
}

.ghost,
.toolbar button {
  background: #e7ece2;
  color: var(--ink);
}

.actionCell {
  min-width: 126px;
  white-space: nowrap;
}

.editButton,
.dangerButton {
  min-height: 34px;
  padding: 0 12px;
}

.editButton {
  background: #eef6ed;
  color: var(--brand-dark);
  border: 1px solid #b7d7c4;
  margin-right: 6px;
}

.editButton:hover {
  background: #dff0df;
}

.dangerButton {
  background: #fff1f0;
  color: var(--danger);
  border: 1px solid #f1b7b2;
}

.dangerButton:hover {
  background: #ffe4e0;
}

.dangerButton:disabled {
  cursor: wait;
  opacity: 0.7;
}

.modalBackdrop {
  position: fixed;
  inset: 0;
  z-index: 10;
  display: grid;
  place-items: center;
  background: rgba(24, 32, 27, 0.46);
  padding: 18px;
}

.modalBackdrop[hidden] {
  display: none;
}

.modalPanel {
  width: min(760px, 100%);
  max-height: calc(100vh - 36px);
  overflow: auto;
  border-radius: 8px;
  background: white;
  box-shadow: 0 22px 70px rgba(24, 32, 27, 0.24);
}

.editForm {
  margin: 0;
  padding: 20px;
}

.modalHeader,
.modalActions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.modalHeader h2 {
  margin: 0;
}

.iconButton {
  width: 40px;
  min-height: 40px;
  padding: 0;
  background: #e7ece2;
  color: var(--ink);
  font-size: 24px;
  line-height: 1;
}

.modalNote {
  margin: 0;
  color: var(--muted);
  font-size: 14px;
}

.modalActions {
  justify-content: flex-end;
}

#toast {
  position: fixed;
  left: 50%;
  bottom: 22px;
  transform: translateX(-50%) translateY(16px);
  max-width: calc(100% - 28px);
  padding: 12px 16px;
  border-radius: 8px;
  background: var(--ink);
  color: #fff;
  opacity: 0;
  pointer-events: none;
  transition: opacity .18s ease, transform .18s ease;
}

#toast.ok,
#toast.error {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
}

#toast.error {
  background: var(--danger);
}

.admin {
  min-height: 100vh;
  padding: 24px;
}

.adminHeader,
.toolbar,
.qrBlock,
.qrGrid,
.tableWrap {
  max-width: 1180px;
  margin: 0 auto;
}

.toolbar,
.qrBlock,
.qrGrid {
  margin-top: 22px;
  padding: 16px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #fbfcf8;
}

.monthForm {
  display: flex;
  align-items: end;
  gap: 10px;
  margin: 0;
}

.monthForm label {
  min-width: 180px;
}

.qrBlock,
.qrGrid {
  justify-content: flex-start;
}

.qrGrid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}

.qrCard {
  display: grid;
  gap: 12px;
  align-content: start;
}

.downloadLabel {
  min-height: 38px;
  margin-top: 10px;
  padding: 0 14px;
  border-radius: 8px;
  background: var(--brand);
  color: white;
  display: inline-grid;
  place-items: center;
  text-decoration: none;
  font-weight: 800;
}

.downloadLabel:hover {
  background: var(--brand-dark);
}

.qrCard img,
.qrBlock img {
  width: 180px;
  height: 180px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: white;
}

.qrCard p,
.qrBlock p {
  margin: 0;
  overflow-wrap: anywhere;
  color: var(--muted);
}

.tableWrap {
  margin-top: 22px;
  overflow-x: auto;
  border: 1px solid var(--line);
  border-radius: 8px;
}

table {
  width: 100%;
  min-width: 860px;
  border-collapse: collapse;
  background: white;
}

th,
td {
  padding: 12px 14px;
  border-bottom: 1px solid var(--line);
  text-align: left;
  vertical-align: top;
  font-size: 14px;
  line-height: 1.5;
}

th {
  color: var(--muted);
  background: #f7f9f4;
  font-weight: 800;
}

.empty {
  text-align: center;
  color: var(--muted);
  padding: 34px;
}

@media (max-width: 680px) {
  .panel {
    padding: 18px;
  }

  .topline,
  .adminHeader,
  .toolbar,
  .qrBlock {
    align-items: stretch;
    flex-direction: column;
  }

  .qrGrid {
    grid-template-columns: 1fr;
  }

  .two {
    grid-template-columns: 1fr;
  }

  .monthForm {
    width: 100%;
    align-items: stretch;
    flex-direction: column;
  }

  .linkButton,
  .ghost {
    width: 100%;
  }
}`;
}
