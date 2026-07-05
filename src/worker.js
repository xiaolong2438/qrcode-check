import QRCode from "qrcode";
import { strToU8, zipSync } from "fflate";

const DEFAULT_PROJECTS = [
  {
    id: "cleaner-startup",
    name: "清洗机启动前检查",
    badge: "开机前",
    subjectLabel: "设备",
    operatorLabel: "操作者签名",
    exportFilenamePrefix: "cleaner-inspection",
    machines: [
      { id: "cleaner-01", name: "1号清洗机启动前检查" },
      { id: "cleaner-02", name: "2号清洗机启动前检查" },
      { id: "cleaner-03", name: "3号清洗机启动前检查" }
    ],
    checkItems: [
      { key: "power", label: "电源正常" },
      { key: "water_pressure", label: "水压(2.0-5.0bar)" },
      { key: "chamber_clean", label: "清洗机内腔清洁、无杂物" },
      { key: "detergent_lube", label: "清洗剂；润滑油的量达到指定位置" },
      { key: "filter_spray_holes", label: "滤网；喷臂出水孔通畅" },
      { key: "spray_arm", label: "喷臂无变形；运转正常" },
      { key: "transfer_lock", label: "传送车；锁止杆；锁止钩；解锁钩灵活" },
      { key: "printer", label: "记录打印正常" },
      { key: "loading", label: "物品装载规范" }
    ]
  }
];

const DEFAULT_PROJECT = DEFAULT_PROJECTS[0];
const DEFAULT_MACHINE = DEFAULT_PROJECT.machines[0];
const PROJECT_CONFIG_KEY = "projects";

const encoder = new TextEncoder();

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      const projects = await loadProjects(env);

      if (request.method === "GET" && url.pathname === "/") {
        return Response.redirect(defaultCheckUrl(url.origin, projects), 302);
      }

      if (request.method === "GET" && url.pathname === "/check") {
        return html(checkPage(url, projects), {
          "Cache-Control": "no-store"
        });
      }

      if (request.method === "POST" && url.pathname === "/api/records") {
        return createRecord(request, env, projects);
      }

      if (request.method === "GET" && url.pathname === "/qr.svg") {
        return qrSvg(url, projects);
      }

      if (request.method === "GET" && url.pathname === "/admin/label.svg") {
        const auth = await requireAdmin(request, env);
        if (auth) return auth;
        return labelSvg(url, projects);
      }

      if (url.pathname === "/admin/login" && request.method === "POST") {
        return adminLogin(request, env);
      }

      if (url.pathname === "/admin/logout" && request.method === "POST") {
        return adminLogout();
      }

      if (url.pathname === "/admin" && request.method === "GET") {
        const auth = await requireAdmin(request, env, { loginPage: true });
        if (auth) return auth;
        return html(await adminPage(request, env, projects), {
          "Cache-Control": "no-store"
        });
      }

      if (url.pathname === "/admin/config" && request.method === "PUT") {
        const auth = await requireAdmin(request, env);
        if (auth) return auth;
        return updateProjectConfig(request, env);
      }

      if (url.pathname === "/admin/config/reset" && request.method === "POST") {
        const auth = await requireAdmin(request, env);
        if (auth) return auth;
        return resetProjectConfig(env);
      }

      if (url.pathname === "/admin/export" && request.method === "GET") {
        const auth = await requireAdmin(request, env);
        if (auth) return auth;
        return exportWorkbook(request, env, projects);
      }

      if (url.pathname.startsWith("/admin/records/") && request.method === "DELETE") {
        const auth = await requireAdmin(request, env);
        if (auth) return auth;
        return deleteRecord(request, env);
      }

      if (url.pathname.startsWith("/admin/records/") && request.method === "PUT") {
        const auth = await requireAdmin(request, env);
        if (auth) return auth;
        return updateRecord(request, env, projects);
      }

      return new Response("Not found", { status: 404 });
    } catch (error) {
      console.error(error);
      return json({ ok: false, error: "服务器处理失败，请稍后重试。" }, 500);
    }
  }
};

function checkPage(url, projects) {
  const { project, machine } = resolveMachine(
    url.searchParams.get("machine") || DEFAULT_MACHINE.id,
    url.searchParams.get("project") || getDefaultProject(projects).id,
    projects
  );
  const machineId = machine.id;
  const machineName = machine.name;
  const openedAt = new Date().toISOString();
  const checkItems = getCheckItems(project, machine);
  const items = checkItems.map((item) => inspectionItem(item)).join("");

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${escapeHtml(machineName)}扫码确认</title>
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
        <span class="badge">${escapeHtml(project.badge || project.name)}</span>
      </div>

      <form id="inspectionForm">
        <input type="hidden" name="projectId" value="${escapeHtml(project.id)}">
        <input type="hidden" name="projectName" value="${escapeHtml(project.name)}">
        <input type="hidden" name="machineId" value="${escapeHtml(machineId)}">
        <input type="hidden" name="machineName" value="${escapeHtml(machineName)}">
        <input type="hidden" name="formOpenedAt" value="${openedAt}">

        <div class="grid two">
          <div class="autoTime">
            <span>检查日期</span>
            <strong>提交时自动记录当前时间</strong>
          </div>
          <label>
            <span>${escapeHtml(project.operatorLabel || "操作者签名")}</span>
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

async function createRecord(request, env, projects) {
  const database = getDb(env);
  const body = await request.json();
  const operatorName = cleanText(body.operatorName, 30);
  const now = new Date().toISOString();
  const recordDate = formatShanghaiDate(new Date(now));
  const { project, machine } = resolveMachine(body.machineId || DEFAULT_MACHINE.id, body.projectId, projects);
  const machineId = machine.id;
  const machineName = machine.name;
  const overallRemark = cleanText(body.overallRemark || "", 500);
  const formOpenedAt = cleanText(body.formOpenedAt || "", 40);
  const clientSubmittedAt = cleanText(body.clientSubmittedAt || "", 40);

  if (!operatorName) {
    return json({ ok: false, error: "请填写操作者签名。" }, 400);
  }

  const checkItems = getCheckItems(project, machine);
  const checks = checkItems.map((item) => {
    const input = body.checks?.[item.key] || {};
    const status = input.status === "abnormal" ? "abnormal" : "ok";
    const remark = cleanText(input.remark || "", 300);
    return {
      projectId: project.id,
      projectName: project.name,
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

async function adminPage(request, env, projects) {
  getDb(env);
  const url = new URL(request.url);
  const month = normalizedMonth(url.searchParams.get("month")) || formatShanghaiMonth(new Date());
  const machineFilter = cleanText(url.searchParams.get("machine") || "", 64);
  const records = await listRecords(env, month, machineFilter);
  const checkUrl = defaultCheckUrl(url.origin, projects);
  const qrUrl = `${url.origin}/qr.svg?text=${encodeURIComponent(checkUrl)}`;
  const machineOptions = adminMachineFilterOptions(projects, machineFilter);
  const exportUrl = `/admin/export?month=${escapeAttr(month)}${machineFilter ? `&machine=${escapeAttr(encodeURIComponent(machineFilter))}` : ""}`;
  const qrCards = projects.flatMap((project) =>
    project.machines.map((machine) => adminQrCard(url.origin, project, machine))
  ).join("");
  const rows = records.map((record) => adminRow(record, projects)).join("");

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>扫码检查后台</title>
  <style>${css()}</style>
</head>
<body>
  <main class="admin">
    <header class="adminHeader">
      <div>
        <p class="eyebrow">后台</p>
        <h1>扫码检查记录</h1>
      </div>
      <div class="headerActions">
        <a class="ghost" href="${escapeAttr(qrUrl)}" target="_blank" rel="noopener">打开二维码</a>
        <form method="post" action="/admin/logout" class="logoutForm">
          <button type="submit" class="ghost">退出登录</button>
        </form>
      </div>
    </header>

    <section class="toolbar">
      <form method="get" action="/admin" class="monthForm">
        <label>
          <span>月份</span>
          <input type="month" name="month" value="${escapeAttr(month)}">
        </label>
        <label>
          <span>设备/点位</span>
          <select name="machine">${machineOptions}</select>
        </label>
        <button type="submit">查看</button>
      </form>
      <a class="primary linkButton" href="${exportUrl}">导出当前筛选 XLSX</a>
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
            <th>项目 / 设备</th>
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

    ${projectConfigSection(projects)}
  </main>
  ${adminEditModal(projects)}
  <script>${adminJs(projects)}</script>
</body>
</html>`;
}

function adminQrCard(origin, project, machine) {
  const checkUrl = buildCheckUrl(origin, project.id, machine.id);
  const qrUrl = `${origin}/qr.svg?text=${encodeURIComponent(checkUrl)}`;
  const labelUrl = `${origin}/admin/label.svg?project=${encodeURIComponent(project.id)}&machine=${encodeURIComponent(machine.id)}`;

  return `<article class="qrCard">
    <img src="${escapeAttr(qrUrl)}" width="160" height="160" alt="${escapeAttr(machine.name)}二维码">
    <div>
      <h2>${escapeHtml(machine.name)}</h2>
      <p class="projectName">${escapeHtml(project.name)}</p>
      <p>${escapeHtml(checkUrl)}</p>
      <a class="downloadLabel" href="${escapeAttr(labelUrl)}" download="${escapeAttr(machine.name)}.svg">下载打印图</a>
    </div>
  </article>`;
}

function adminMachineFilterOptions(projects, selectedMachineId) {
  const groups = projects.map((project) => {
    const options = project.machines.map((machine) =>
      `<option value="${escapeAttr(machine.id)}"${machine.id === selectedMachineId ? " selected" : ""}>${escapeHtml(machine.name)}</option>`
    ).join("");
    return `<optgroup label="${escapeAttr(project.name)}">${options}</optgroup>`;
  }).join("");

  return `<option value="">全部设备/点位</option>${groups}`;
}

function projectConfigSection(projects) {
  return `<section class="configPanel">
    <div class="sectionHeader compactSectionHeader">
      <div>
        <p class="eyebrow">配置</p>
        <h2>扫码项目和检查内容</h2>
      </div>
      <div class="configActions">
        <button type="button" class="ghost" data-toggle-config-editor>编辑扫码项目和检查内容</button>
      </div>
    </div>
    <div id="projectConfigBody" class="configBody" hidden>
      <div class="configActions configBodyActions">
        <button type="button" class="ghost" data-add-project>新增项目</button>
        <button type="button" class="primary" data-save-config>保存配置</button>
        <button type="button" class="dangerButton" data-reset-config>恢复默认</button>
      </div>
      <p class="hint">修改后会影响新打开的扫码表单和新提交记录；已保存的历史记录仍保留当时提交的检查内容。</p>
      <div id="projectConfigEditor" class="configEditor"></div>
    </div>
    <script type="application/json" id="projectConfigData">${scriptJson(projects)}</script>
  </section>`;
}

function adminRow(record, projects) {
  const checks = parseChecks(record.checks_json);
  const project = resolveRecordProject(record, projects, checks);
  const abnormal = checks.filter((item) => item.status === "abnormal");
  const abnormalText = abnormal.length
    ? abnormal.map((item) => `${item.label}${item.remark ? `：${item.remark}` : ""}`).join("；")
    : "无";
  const editableRecord = {
    id: record.id,
    projectId: project.id,
    projectName: project.name,
    machineId: record.machine_id,
    machineName: record.machine_name,
    operatorName: record.operator_name,
    checks,
    overallRemark: record.overall_remark || ""
  };

  return `<tr>
    <td>${escapeHtml(formatShanghaiDateTime(record.server_submitted_at))}</td>
    <td>${escapeHtml(record.record_date)}</td>
    <td>${escapeHtml(project.name)}<br><strong>${escapeHtml(record.machine_name)}</strong></td>
    <td>${escapeHtml(record.operator_name)}</td>
    <td>${escapeHtml(abnormalText)}</td>
    <td>${escapeHtml(record.overall_remark || "")}</td>
    <td class="actionCell">
      <button class="editButton" type="button" data-edit-record="${escapeAttr(JSON.stringify(editableRecord))}">编辑</button>
      <button class="dangerButton" type="button" data-delete-id="${escapeAttr(record.id)}">删除</button>
    </td>
  </tr>`;
}

function adminEditModal(projects) {
  const machineOptions = projects.map((project) => {
    const options = project.machines.map((machine) =>
      `<option value="${escapeAttr(machine.id)}" data-project-id="${escapeAttr(project.id)}">${escapeHtml(machine.name)}</option>`
    ).join("");
    return `<optgroup label="${escapeAttr(project.name)}">${options}</optgroup>`;
  }).join("");

  return `<div class="modalBackdrop" id="editModal" hidden>
    <div class="modalPanel" role="dialog" aria-modal="true" aria-labelledby="editModalTitle">
      <form id="editRecordForm" class="editForm">
        <div class="modalHeader">
          <h2 id="editModalTitle">编辑检查记录</h2>
          <button class="iconButton" type="button" data-close-edit aria-label="关闭">×</button>
        </div>
        <p class="modalNote">只修改检查数据，不改变原提交时间和检查日期。</p>
        <label>
          <span>项目 / 设备</span>
          <select name="machineId" required>${machineOptions}</select>
        </label>
        <label>
          <span>操作者签名</span>
          <input name="operatorName" maxlength="30" required>
        </label>
        <div class="items" id="editItems"></div>
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

async function updateRecord(request, env, projects) {
  const database = getDb(env);
  const url = new URL(request.url);
  const id = cleanText(decodeURIComponent(url.pathname.replace("/admin/records/", "")), 80);
  const body = await request.json();
  const operatorName = cleanText(body.operatorName, 30);
  const { project, machine } = resolveMachine(body.machineId || DEFAULT_MACHINE.id, body.projectId, projects);
  const overallRemark = cleanText(body.overallRemark || "", 500);

  if (!id) {
    return json({ ok: false, error: "记录 ID 不能为空。" }, 400);
  }

  if (!operatorName) {
    return json({ ok: false, error: "请填写操作者签名。" }, 400);
  }

  const checkItems = getCheckItems(project, machine);
  const checks = checkItems.map((item) => {
    const input = body.checks?.[item.key] || {};
    const status = input.status === "abnormal" ? "abnormal" : "ok";
    const remark = cleanText(input.remark || "", 300);
    return {
      projectId: project.id,
      projectName: project.name,
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

async function exportWorkbook(request, env, projects) {
  getDb(env);
  const url = new URL(request.url);
  const month = normalizedMonth(url.searchParams.get("month")) || formatShanghaiMonth(new Date());
  const machineFilter = cleanText(url.searchParams.get("machine") || "", 64);
  const records = await listRecords(env, month, machineFilter);
  const summaryHeader = [
    "提交时间",
    "检查日期",
    "项目",
    "设备",
    "操作者签名",
    "检查明细",
    "异常备注",
    "总备注"
  ];
  const rows = records.map((record) => recordToSummaryExportRow(record, projects));
  const sheets = [
    { name: "总表", header: summaryHeader, rows }
  ];
  for (const project of projects) {
    const projectItems = projectAllCheckItems(project);
    const projectHeader = checkItemsExportHeader(projectItems);
    const projectRecords = records.filter((record) =>
      resolveRecordProject(record, projects, parseChecks(record.checks_json)).id === project.id
    );
    sheets.push({
      name: project.name,
      header: projectHeader,
      rows: projectRecords.map((record) => recordToCheckItemsExportRow(record, projectItems))
    });
    for (const machine of project.machines) {
      const machineItems = getCheckItems(project, machine);
      sheets.push({
        name: shortSheetName(machine.name),
        header: checkItemsExportHeader(machineItems),
        rows: projectRecords
          .filter((record) => record.machine_id === machine.id)
          .map((record) => recordToCheckItemsExportRow(record, machineItems))
      });
    }
  }

  const workbook = buildXlsxWorkbook(sheets);
  return new Response(workbook, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="inspection-records-${machineFilter || "all"}-${month}.xlsx"`,
      "Cache-Control": "no-store"
    }
  });
}

function checkItemsExportHeader(checkItems) {
  return [
    "提交时间",
    "检查日期",
    "设备",
    "操作者签名",
    ...checkItems.map((item) => item.label),
    "异常备注",
    "总备注"
  ];
}

function recordToSummaryExportRow(record, projects) {
  const checks = parseChecks(record.checks_json);
  const project = resolveRecordProject(record, projects, checks);

  return [
    formatShanghaiDateTime(record.server_submitted_at),
    record.record_date,
    project.name,
    record.machine_name,
    record.operator_name,
    checks.map((item) => `${item.label}：${item.status === "abnormal" ? "异常" : "√"}`).join("；"),
    abnormalNotes(checks),
    record.overall_remark || ""
  ];
}

function recordToCheckItemsExportRow(record, checkItems) {
  const checks = parseChecks(record.checks_json);
  const byKey = Object.fromEntries(checks.map((item) => [item.key, item]));

  return [
    formatShanghaiDateTime(record.server_submitted_at),
    record.record_date,
    record.machine_name,
    record.operator_name,
    ...checkItems.map((item) => checkStatusText(byKey[item.key])),
    abnormalNotes(checks),
    record.overall_remark || ""
  ];
}

function checkStatusText(check) {
  if (!check) return "";
  return check.status === "abnormal" ? "异常" : "√";
}

function abnormalNotes(checks) {
  return checks
    .filter((item) => item.status === "abnormal" || item.remark)
    .map((item) => `${item.label}：${item.remark || "异常"}`)
    .join("；");
}

function getCheckItems(project, machine) {
  return Array.isArray(machine?.checkItems) && machine.checkItems.length
    ? machine.checkItems
    : project.checkItems;
}

function projectAllCheckItems(project) {
  const byKey = new Map();
  for (const item of project.checkItems || []) {
    byKey.set(item.key, item);
  }
  for (const machine of project.machines || []) {
    for (const item of getCheckItems(project, machine)) {
      if (!byKey.has(item.key)) {
        byKey.set(item.key, item);
      }
    }
  }
  return Array.from(byKey.values());
}

async function loadProjects(env) {
  let database;
  try {
    database = getDb(env);
  } catch {
    return DEFAULT_PROJECTS;
  }

  try {
    await ensureSettingsTable(database);
    const row = await database.prepare("SELECT value FROM app_settings WHERE key = ?")
      .bind(PROJECT_CONFIG_KEY)
      .first();
    if (!row?.value) return DEFAULT_PROJECTS;

    const parsed = JSON.parse(row.value);
    return normalizeProjects(parsed);
  } catch (error) {
    console.warn("Using default project config.", error);
    return DEFAULT_PROJECTS;
  }
}

async function updateProjectConfig(request, env) {
  const database = getDb(env);
  const body = await request.json();
  const projects = normalizeProjects(body.projects);

  await ensureSettingsTable(database);
  await database.prepare(
    `INSERT OR REPLACE INTO app_settings (key, value, updated_at)
     VALUES (?, ?, ?)`
  )
    .bind(PROJECT_CONFIG_KEY, JSON.stringify(projects), new Date().toISOString())
    .run();

  return json({ ok: true, projects });
}

async function resetProjectConfig(env) {
  const database = getDb(env);
  await ensureSettingsTable(database);
  await database.prepare("DELETE FROM app_settings WHERE key = ?")
    .bind(PROJECT_CONFIG_KEY)
    .run();
  return json({ ok: true, projects: DEFAULT_PROJECTS });
}

async function ensureSettingsTable(database) {
  await database.prepare(
    `CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`
  ).run();
}

function normalizeProjects(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("至少需要保留一个扫码项目。");
  }

  const projectIds = new Set();
  const machineIds = new Set();

  return value.map((project, projectIndex) => {
    const id = cleanId(project.id || `project-${projectIndex + 1}`, 64);
    const name = cleanText(project.name, 80);
    const badge = cleanText(project.badge || name, 20);
    const subjectLabel = cleanText(project.subjectLabel || "设备", 20);
    const operatorLabel = cleanText(project.operatorLabel || "操作者签名", 20);
    const checkItems = normalizeCheckItems(project.checkItems);
    const machines = normalizeMachines(project.machines, checkItems);

    if (!id || !name) {
      throw new Error("项目 ID 和项目名称不能为空。");
    }
    if (projectIds.has(id)) {
      throw new Error(`项目 ID “${id}”重复。`);
    }
    projectIds.add(id);

    for (const machine of machines) {
      if (machineIds.has(machine.id)) {
        throw new Error(`设备/点位 ID “${machine.id}”重复。`);
      }
      machineIds.add(machine.id);
    }

    return {
      id,
      name,
      badge,
      subjectLabel,
      operatorLabel,
      machines,
      checkItems
    };
  });
}

function normalizeMachines(value, projectCheckItems) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("设备/点位至少需要保留一项。");
  }

  const ids = new Set();
  return value.map((item, index) => {
    const id = cleanId(item.id || `machine-${index + 1}`, 64);
    const name = cleanText(item.name, 120);
    if (!id || !name) {
      throw new Error("设备/点位 ID 和名称不能为空。");
    }
    if (ids.has(id)) {
      throw new Error(`设备/点位 ID “${id}”重复。`);
    }
    ids.add(id);
    const checkItems = Array.isArray(item.checkItems) && item.checkItems.length
      ? normalizeCheckItems(item.checkItems)
      : projectCheckItems.map((checkItem) => ({ ...checkItem }));
    return { id, name, checkItems };
  });
}

function normalizeCheckItems(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("检查项至少需要保留一项。");
  }

  const keys = new Set();
  return value.map((item, index) => {
    const key = cleanId(item.key || `check-${index + 1}`, 64);
    const label = cleanText(item.label, 120);
    if (!key || !label) {
      throw new Error("检查项 key 和名称不能为空。");
    }
    if (keys.has(key)) {
      throw new Error(`检查项 key “${key}”重复。`);
    }
    keys.add(key);
    return { key, label };
  });
}

function cleanId(value, maxLength) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength);
}

function shortSheetName(name) {
  return name
    .replace("启动前检查", "")
    .replace("检查", "")
    .trim() || name;
}

async function listRecords(env, month, machineId = "") {
  const database = getDb(env);
  const start = `${month}-01`;
  const end = nextMonth(month);
  const machineFilter = cleanText(machineId, 64);
  const sql = machineFilter
    ? `SELECT * FROM inspection_records
       WHERE record_date >= ? AND record_date < ? AND machine_id = ?
       ORDER BY server_submitted_at DESC`
    : `SELECT * FROM inspection_records
       WHERE record_date >= ? AND record_date < ?
       ORDER BY server_submitted_at DESC`;
  const statement = database.prepare(sql);
  const result = machineFilter
    ? await statement.bind(start, end, machineFilter).all()
    : await statement.bind(start, end).all();
  return result.results || [];
}

async function qrSvg(url, projects) {
  const text = url.searchParams.get("text") || defaultCheckUrl(url.origin, projects);
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

async function labelSvg(url, projects) {
  const { project, machine } = resolveMachine(
    url.searchParams.get("machine") || DEFAULT_MACHINE.id,
    url.searchParams.get("project") || getDefaultProject(projects).id,
    projects
  );
  const checkUrl = buildCheckUrl(url.origin, project.id, machine.id);
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

async function requireAdmin(request, env, options = {}) {
  const expected = env.ADMIN_PASSWORD;
  if (!expected) {
    return new Response("ADMIN_PASSWORD is not configured.", { status: 500 });
  }

  const cookies = parseCookies(request.headers.get("cookie") || "");
  const token = await adminSessionToken(expected);
  if (cookies.admin_session && constantTimeEqual(cookies.admin_session, token)) {
    return null;
  }

  const header = request.headers.get("authorization") || "";
  const prefix = "Basic ";
  if (!header.startsWith(prefix)) {
    return authChallenge(options);
  }

  let decoded = "";
  try {
    decoded = atob(header.slice(prefix.length));
  } catch {
    return authChallenge(options);
  }

  const separator = decoded.indexOf(":");
  const username = separator >= 0 ? decoded.slice(0, separator) : "";
  const password = separator >= 0 ? decoded.slice(separator + 1) : "";

  if (username !== "admin" || !constantTimeEqual(password, expected)) {
    return authChallenge(options);
  }

  return null;
}

async function adminLogin(request, env) {
  const expected = env.ADMIN_PASSWORD;
  if (!expected) {
    return new Response("ADMIN_PASSWORD is not configured.", { status: 500 });
  }

  const form = await request.formData();
  const username = cleanText(form.get("username"), 40);
  const password = String(form.get("password") || "");

  if (username !== "admin" || !constantTimeEqual(password, expected)) {
    return html(loginPage("账号或密码不正确。"), {
      "Cache-Control": "no-store"
    }, 401);
  }

  const token = await adminSessionToken(expected);
  return new Response(null, {
    status: 303,
    headers: {
      "Location": "/admin",
      "Set-Cookie": `admin_session=${token}; Path=/admin; Max-Age=28800; HttpOnly; SameSite=Lax`,
      "Cache-Control": "no-store"
    }
  });
}

function adminLogout() {
  return new Response(null, {
    status: 303,
    headers: {
      "Location": "/admin",
      "Set-Cookie": "admin_session=; Path=/admin; Max-Age=0; HttpOnly; SameSite=Lax",
      "Cache-Control": "no-store"
    }
  });
}

function authChallenge(options = {}) {
  if (options.loginPage) {
    return html(loginPage(), {
      "Cache-Control": "no-store"
    }, 401);
  }

  return new Response("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Inspection admin", charset="UTF-8"'
    }
  });
}

function loginPage(error = "") {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>后台登录</title>
  <style>${css()}</style>
</head>
<body>
  <main class="loginShell">
    <form method="post" action="/admin/login" class="loginPanel">
      <div>
        <p class="eyebrow">后台</p>
        <h1>扫码检查后台登录</h1>
      </div>
      ${error ? `<p class="loginError">${escapeHtml(error)}</p>` : ""}
      <label>
        <span>账号</span>
        <input name="username" value="admin" autocomplete="username" required>
      </label>
      <label>
        <span>密码</span>
        <input name="password" type="password" autocomplete="current-password" required autofocus>
      </label>
      <button type="submit" class="primary">登录</button>
    </form>
  </main>
</body>
</html>`;
}

async function adminSessionToken(password) {
  const bytes = await crypto.subtle.digest("SHA-256", encoder.encode(`inspection-admin:${password}`));
  return base64Url(new Uint8Array(bytes));
}

function base64Url(bytes) {
  let raw = "";
  for (const byte of bytes) {
    raw += String.fromCharCode(byte);
  }
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function parseCookies(header) {
  const result = {};
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    result[key] = value;
  }
  return result;
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

function getDefaultProject(projects) {
  return projects[0] || DEFAULT_PROJECT;
}

function getDefaultMachine(projects) {
  const project = getDefaultProject(projects);
  return project.machines[0] || DEFAULT_MACHINE;
}

function defaultCheckUrl(origin, projects) {
  const project = getDefaultProject(projects);
  const machine = getDefaultMachine(projects);
  return buildCheckUrl(origin, project.id, machine.id);
}

function buildCheckUrl(origin, projectId, machineId) {
  return `${origin}/check?project=${encodeURIComponent(projectId)}&machine=${encodeURIComponent(machineId)}`;
}

function resolveProject(value, projects) {
  const id = cleanText(value, 64);
  return projects.find((project) => project.id === id) || getDefaultProject(projects);
}

function resolveMachine(machineValue, projectValue, projects) {
  const project = resolveProject(projectValue, projects);
  const id = cleanText(machineValue, 64) || project.machines[0]?.id || getDefaultMachine(projects).id;
  const machine = project.machines.find((item) => item.id === id);
  if (machine) return { project, machine };

  const legacyProject = projects.find((item) => item.machines.some((candidate) => candidate.id === id));
  if (legacyProject) {
    return {
      project: legacyProject,
      machine: legacyProject.machines.find((item) => item.id === id)
    };
  }

  return { project, machine: { id, name: id } };
}

function resolveRecordProject(record, projects, checks = parseChecks(record.checks_json)) {
  const projectId = checks.find((item) => item.projectId)?.projectId;
  if (projectId) return resolveProject(projectId, projects);

  const matchedProject = projects.find((project) =>
    project.machines.some((machine) => machine.id === record.machine_id)
  );
  return matchedProject || getDefaultProject(projects);
}

function cleanText(value, maxLength) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function buildXlsxWorkbook(sheets) {
  const sheetFiles = {};
  const workbookSheets = [];
  const workbookRelationships = [];
  const usedSheetNames = new Map();

  sheets.forEach((sheet, index) => {
    const sheetNumber = index + 1;
    const safeName = uniqueSheetName(sanitizeSheetName(sheet.name), usedSheetNames);
    sheetFiles[`xl/worksheets/sheet${sheetNumber}.xml`] = xmlBytes(buildWorksheetXml([sheet.header, ...sheet.rows]));
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

function uniqueSheetName(name, usedNames) {
  const count = usedNames.get(name) || 0;
  usedNames.set(name, count + 1);
  if (count === 0) return name;

  const suffix = ` (${count + 1})`;
  return `${name.slice(0, 31 - suffix.length)}${suffix}`;
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

function html(markup, headers = {}, status = 200) {
  return new Response(markup, {
    status,
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

function scriptJson(value) {
  return JSON.stringify(value)
    .replace(/&/g, "\\u0026")
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
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
    projectId: data.get("projectId"),
    projectName: data.get("projectName"),
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

function adminJs(projects) {
  return `
function showAdminError(message) {
  let banner = document.querySelector("#adminScriptError");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "adminScriptError";
    banner.className = "loginError adminError";
    document.querySelector(".admin")?.prepend(banner);
  }
  banner.textContent = message;
}

window.addEventListener("error", (event) => {
  showAdminError("后台脚本错误：" + (event.message || "未知错误"));
});

window.addEventListener("unhandledrejection", (event) => {
  showAdminError("后台操作失败：" + (event.reason?.message || event.reason || "未知错误"));
});

let adminProjects = [];
try {
  adminProjects = JSON.parse(document.querySelector("#projectConfigData")?.textContent || "[]");
} catch (error) {
  showAdminError("项目配置读取失败，请刷新页面或联系管理员。");
}
const editModal = document.querySelector("#editModal");
const editForm = document.querySelector("#editRecordForm");
const editItems = document.querySelector("#editItems");
const configEditor = document.querySelector("#projectConfigEditor");
const configBody = document.querySelector("#projectConfigBody");

function escapeText(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function makeId(value, fallback) {
  const id = String(value || fallback || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return id || fallback;
}

function renderConfigEditor() {
  configEditor.innerHTML = adminProjects.map((project, projectIndex) => {
    const selectedMachineIndex = Number.isInteger(project.selectedMachineIndex) && project.machines?.[project.selectedMachineIndex]
      ? project.selectedMachineIndex
      : 0;
    const selectedMachine = (project.machines || [])[selectedMachineIndex] || { checkItems: [] };
    const machineOptions = (project.machines || []).map((machine, machineIndex) =>
      '<option value="' + machineIndex + '"' + (machineIndex === selectedMachineIndex ? " selected" : "") + '>' +
        escapeText(machine.name || machine.id || ("设备" + (machineIndex + 1))) +
      '</option>'
    ).join("");
    const machines = (project.machines || []).map((machine, machineIndex) =>
      '<div class="configMachine" data-machine-index="' + machineIndex + '">' +
        '<div class="configRow">' +
          '<input data-field="machine-id" value="' + escapeText(machine.id) + '" placeholder="设备ID">' +
          '<input data-field="machine-name" value="' + escapeText(machine.name) + '" placeholder="设备/点位名称">' +
          '<button type="button" class="iconButton smallIcon" data-remove-machine aria-label="删除设备/点位">×</button>' +
        '</div>' +
      '</div>'
    ).join("");
    const machineItems = getMachineCheckItems(project, selectedMachine).map((item, itemIndex) =>
      '<div class="configRow" data-machine-check-index="' + itemIndex + '">' +
        '<input data-field="machine-check-key" value="' + escapeText(item.key) + '" placeholder="检查项key">' +
        '<input data-field="machine-check-label" value="' + escapeText(item.label) + '" placeholder="检查项名称">' +
        '<button type="button" class="iconButton smallIcon" data-remove-machine-check aria-label="删除设备检查项">×</button>' +
      '</div>'
    ).join("");
    const checkItems = (project.checkItems || []).map((item, itemIndex) =>
      '<div class="configRow" data-project-check-index="' + itemIndex + '">' +
        '<input data-field="check-key" value="' + escapeText(item.key) + '" placeholder="检查项key">' +
        '<input data-field="check-label" value="' + escapeText(item.label) + '" placeholder="检查项名称">' +
        '<button type="button" class="iconButton smallIcon" data-remove-check aria-label="删除检查项">×</button>' +
      '</div>'
    ).join("");

    return '<article class="configProject" data-project-index="' + projectIndex + '">' +
      '<div class="configProjectHeader">' +
        '<h3>项目 ' + (projectIndex + 1) + '</h3>' +
        '<button type="button" class="dangerButton" data-remove-project>删除项目</button>' +
      '</div>' +
      '<div class="grid two">' +
        '<label><span>项目ID</span><input data-field="project-id" value="' + escapeText(project.id) + '" placeholder="cleaner-startup"></label>' +
        '<label><span>项目名称</span><input data-field="project-name" value="' + escapeText(project.name) + '" placeholder="清洗机启动前检查"></label>' +
        '<label><span>右上角标签</span><input data-field="project-badge" value="' + escapeText(project.badge || "") + '" placeholder="开机前"></label>' +
        '<label><span>签名字段名称</span><input data-field="operator-label" value="' + escapeText(project.operatorLabel || "操作者签名") + '" placeholder="操作者签名"></label>' +
      '</div>' +
      '<div class="configGroup">' +
        '<div class="configGroupHeader"><h4>设备/点位</h4><button type="button" class="ghost compactButton" data-add-machine>新增设备/点位</button></div>' +
        '<div class="configRows" data-list="machines">' + machines + '</div>' +
      '</div>' +
      '<div class="configGroup machineChecks">' +
        '<div class="configGroupHeader"><h4>当前设备检查项</h4><button type="button" class="ghost compactButton" data-add-machine-check>新增检查项</button></div>' +
        '<label class="machinePicker"><span>选择设备/点位</span><select data-select-machine-checks data-current-machine-index="' + selectedMachineIndex + '">' + machineOptions + '</select></label>' +
        '<div class="configRows" data-list="machine-checks">' + machineItems + '</div>' +
      '</div>' +
      '<div class="configGroup">' +
        '<div class="configGroupHeader"><h4>项目默认检查项</h4><button type="button" class="ghost compactButton" data-add-check>新增默认检查项</button></div>' +
        '<p class="hint">新增同类设备时会复制这套默认检查项；每个设备下方仍可单独修改。</p>' +
        '<button type="button" class="ghost compactButton defaultCheckToggle" data-toggle-default-checks>' + (project.defaultChecksOpen ? "收起默认检查项" : "展开默认检查项") + '（' + (project.checkItems || []).length + '项）</button>' +
        '<div class="configRows defaultChecks" data-list="project-checks"' + (project.defaultChecksOpen ? "" : " hidden") + '>' + checkItems + '</div>' +
      '</div>' +
    '</article>';
  }).join("");
}

function collectConfig() {
  if (!configEditor.children.length) {
    return adminProjects;
  }

  return Array.from(configEditor.querySelectorAll(".configProject")).map((projectNode, projectIndex) => {
    const projectName = projectNode.querySelector('[data-field="project-name"]').value.trim();
    const projectId = makeId(projectNode.querySelector('[data-field="project-id"]').value, "project-" + (projectIndex + 1));
    const sourceProject = adminProjects[projectIndex] || {};
    const selectedMachineIndex = Number(projectNode.querySelector("[data-select-machine-checks]")?.value || sourceProject.selectedMachineIndex || 0);
    const defaultCheckRows = projectNode.querySelector('[data-list="project-checks"]');
    const checkItems = Array.from(defaultCheckRows.querySelectorAll("[data-project-check-index]")).map((row, rowIndex) => ({
      key: makeId(row.querySelector('[data-field="check-key"]').value, "check-" + (rowIndex + 1)),
      label: row.querySelector('[data-field="check-label"]').value.trim()
    }));
    const editedMachineItems = Array.from(projectNode.querySelectorAll('[data-list="machine-checks"] [data-machine-check-index]')).map((row, itemIndex) => ({
        key: makeId(row.querySelector('[data-field="machine-check-key"]').value, "check-" + (itemIndex + 1)),
        label: row.querySelector('[data-field="machine-check-label"]').value.trim()
    }));
    const machines = Array.from(projectNode.querySelectorAll("[data-machine-index]")).map((machineNode, rowIndex) => {
      const previous = sourceProject.machines?.[rowIndex] || {};
      return {
        id: makeId(machineNode.querySelector('[data-field="machine-id"]').value, projectId + "-point-" + (rowIndex + 1)),
        name: machineNode.querySelector('[data-field="machine-name"]').value.trim(),
        checkItems: rowIndex === selectedMachineIndex
          ? editedMachineItems
          : (previous.checkItems || checkItems).map((item) => ({ ...item }))
      };
    });

    return {
      id: projectId,
      name: projectName,
      badge: projectNode.querySelector('[data-field="project-badge"]').value.trim() || projectName,
      subjectLabel: "设备",
      operatorLabel: projectNode.querySelector('[data-field="operator-label"]').value.trim() || "操作者签名",
      machines,
      checkItems,
      selectedMachineIndex,
      defaultChecksOpen: !defaultCheckRows.hidden
    };
  });
}

function insertConfigRow(projectIndex, type) {
  adminProjects = collectConfig();
  const project = adminProjects[projectIndex];
  if (!project) return;

  if (type === "machine") {
    const next = (project.machines || []).length + 1;
    project.machines.push({
      id: project.id + "-point-" + next,
      name: "新设备/点位" + next,
      checkItems: (project.checkItems || []).map((item) => ({ ...item }))
    });
  } else {
    const next = (project.checkItems || []).length + 1;
    project.checkItems.push({ key: "check-" + next, label: "新检查项" + next });
    project.defaultChecksOpen = true;
  }
  renderConfigEditor();
}

function insertMachineCheck(projectIndex, machineIndex) {
  adminProjects = collectConfig();
  const machine = adminProjects[projectIndex]?.machines?.[machineIndex];
  if (!machine) return;
  const next = (machine.checkItems || []).length + 1;
  machine.checkItems.push({ key: "check-" + next, label: "新检查项" + next });
  renderConfigEditor();
}

function getMachineCheckItems(project, machine) {
  return Array.isArray(machine?.checkItems) && machine.checkItems.length
    ? machine.checkItems
    : project.checkItems || [];
}

async function saveProjectConfig() {
  adminProjects = collectConfig();
  const button = document.querySelector("[data-save-config]");
  button.disabled = true;
  button.textContent = "保存中...";

  try {
    const response = await fetch("/admin/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projects: adminProjects })
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      throw new Error(result.error || "保存失败");
    }
    window.alert("项目配置已保存。");
    window.location.reload();
  } catch (error) {
    window.alert(error.message || "保存失败，请稍后重试。");
  } finally {
    button.disabled = false;
    button.textContent = "保存配置";
  }
}

async function resetProjectConfig() {
  if (!window.confirm("确定恢复默认项目配置吗？当前后台配置会被清除。")) return;

  const response = await fetch("/admin/config/reset", { method: "POST" });
  const result = await response.json();
  if (!response.ok || !result.ok) {
    window.alert(result.error || "恢复默认失败");
    return;
  }
  window.alert("已恢复默认配置。");
  window.location.reload();
}

function openConfigEditor() {
  if (!configBody.hidden) return;
  configBody.hidden = false;
  const toggle = document.querySelector("[data-toggle-config-editor]");
  if (toggle) toggle.textContent = "收起配置编辑";
  renderConfigEditor();
}

function closeConfigEditor() {
  configBody.hidden = true;
  const toggle = document.querySelector("[data-toggle-config-editor]");
  if (toggle) toggle.textContent = "编辑扫码项目和检查内容";
}

function findProject(projectId) {
  return adminProjects.find((project) => project.id === projectId) || adminProjects[0];
}

function findProjectByMachine(machineId) {
  return adminProjects.find((project) =>
    project.machines.some((machine) => machine.id === machineId)
  ) || adminProjects[0];
}

function selectedProjectId() {
  const option = editForm.elements.machineId.selectedOptions[0];
  return option?.dataset.projectId || adminProjects[0].id;
}

function selectedMachineId() {
  return editForm.elements.machineId.value;
}

function findMachine(project, machineId) {
  return (project?.machines || []).find((machine) => machine.id === machineId) || project?.machines?.[0];
}

function attachItemBehavior(fieldset) {
  const remark = fieldset.querySelector("textarea");
  const update = () => {
    const checked = fieldset.querySelector("input:checked")?.value || "ok";
    remark.classList.toggle("show", checked === "abnormal");
    remark.required = checked === "abnormal";
  };
  fieldset.addEventListener("change", update);
  update();
}

function renderEditItems(projectId, checks = [], machineId = selectedMachineId()) {
  const project = findProject(projectId);
  const machine = findMachine(project, machineId);
  const checkItems = getMachineCheckItems(project, machine);
  const byKey = Object.fromEntries(checks.map((item) => [item.key, item]));
  editItems.innerHTML = checkItems.map((item) => {
    const saved = byKey[item.key] || {};
    const status = saved.status === "abnormal" ? "abnormal" : "ok";
    const okChecked = status === "ok" ? " checked" : "";
    const abnormalChecked = status === "abnormal" ? " checked" : "";
    return '<fieldset class="item editItem" data-edit-key="' + escapeText(item.key) + '">' +
      '<legend>' + escapeText(item.label) + '</legend>' +
      '<div class="segmented">' +
      '<label><input type="radio" name="' + escapeText(item.key) + '" value="ok"' + okChecked + '><span>正常</span></label>' +
      '<label><input type="radio" name="' + escapeText(item.key) + '" value="abnormal"' + abnormalChecked + '><span>异常</span></label>' +
      '</div>' +
      '<textarea name="' + escapeText(item.key) + '_remark" rows="2" maxlength="300" placeholder="异常备注">' + escapeText(saved.remark || "") + '</textarea>' +
      '</fieldset>';
  }).join("");

  for (const fieldset of editItems.querySelectorAll(".editItem")) {
    attachItemBehavior(fieldset);
  }
}

function selectMachine(machineId, projectId) {
  let matched = false;
  for (const option of editForm.elements.machineId.options) {
    option.selected = option.value === machineId && option.dataset.projectId === projectId;
    matched ||= option.selected;
  }
  if (!matched) {
    const project = findProject(projectId);
    const fallback = project.machines[0] || adminProjects[0].machines[0];
    for (const option of editForm.elements.machineId.options) {
      option.selected = option.value === fallback.id && option.dataset.projectId === project.id;
    }
  }
}

function openEditModal(record) {
  editForm.dataset.recordId = record.id;
  const project = findProject(record.projectId || findProjectByMachine(record.machineId).id);
  selectMachine(record.machineId, project.id);
  editForm.elements.operatorName.value = record.operatorName || "";
  editForm.elements.overallRemark.value = record.overallRemark || "";
  renderEditItems(project.id, record.checks || [], record.machineId);

  editModal.hidden = false;
}

function closeEditModal() {
  editModal.hidden = true;
  editForm.reset();
  delete editForm.dataset.recordId;
}

editForm.elements.machineId.addEventListener("change", () => {
  renderEditItems(selectedProjectId(), [], selectedMachineId());
});

document.addEventListener("change", (event) => {
  const selector = event.target.closest("[data-select-machine-checks]");
  if (!selector) return;

  const configProject = selector.closest(".configProject");
  const projectIndex = Number(configProject.dataset.projectIndex);
  const nextMachineIndex = Number(selector.value);
  selector.value = selector.dataset.currentMachineIndex || "0";
  adminProjects = collectConfig();
  adminProjects[projectIndex].selectedMachineIndex = nextMachineIndex;
  renderConfigEditor();
});

document.addEventListener("click", async (event) => {
  if (event.target.closest("[data-toggle-config-editor]")) {
    if (configBody.hidden) {
      openConfigEditor();
    } else {
      closeConfigEditor();
    }
    return;
  }

  if (event.target.closest("[data-save-config]")) {
    await saveProjectConfig();
    return;
  }

  if (event.target.closest("[data-reset-config]")) {
    await resetProjectConfig();
    return;
  }

  if (event.target.closest("[data-add-project]")) {
    adminProjects = collectConfig();
    const next = adminProjects.length + 1;
    adminProjects.push({
      id: "project-" + next,
      name: "新扫码项目" + next,
      badge: "检查",
      subjectLabel: "设备",
      operatorLabel: "操作者签名",
      machines: [{
        id: "project-" + next + "-point-1",
        name: "新设备/点位1",
        checkItems: [{ key: "check-1", label: "新检查项1" }]
      }],
      checkItems: [{ key: "check-1", label: "新检查项1" }]
    });
    renderConfigEditor();
    return;
  }

  const configProject = event.target.closest(".configProject");
  if (configProject) {
    const projectIndex = Number(configProject.dataset.projectIndex);

    if (event.target.closest("[data-remove-project]")) {
      adminProjects = collectConfig();
      if (adminProjects.length <= 1) {
        window.alert("至少需要保留一个扫码项目。");
        return;
      }
      adminProjects.splice(projectIndex, 1);
      renderConfigEditor();
      return;
    }

    if (event.target.closest("[data-add-machine]")) {
      insertConfigRow(projectIndex, "machine");
      return;
    }

    if (event.target.closest("[data-add-check]")) {
      insertConfigRow(projectIndex, "check");
      return;
    }

    if (event.target.closest("[data-toggle-default-checks]")) {
      adminProjects = collectConfig();
      const project = adminProjects[projectIndex];
      if (project) {
        project.defaultChecksOpen = !project.defaultChecksOpen;
        renderConfigEditor();
      }
      return;
    }

    if (event.target.closest("[data-add-machine-check]")) {
      adminProjects = collectConfig();
      insertMachineCheck(projectIndex, adminProjects[projectIndex]?.selectedMachineIndex || 0);
      return;
    }

    if (event.target.closest("[data-remove-machine-check]")) {
      adminProjects = collectConfig();
      const machineIndex = adminProjects[projectIndex]?.selectedMachineIndex || 0;
      const checkItems = adminProjects[projectIndex]?.machines?.[machineIndex]?.checkItems || [];
      if (checkItems.length <= 1) {
        window.alert("每个设备至少需要保留一个检查项。");
        return;
      }
      checkItems.splice(Number(event.target.closest("[data-machine-check-index]").dataset.machineCheckIndex), 1);
      renderConfigEditor();
      return;
    }

    if (event.target.closest("[data-remove-machine]")) {
      adminProjects = collectConfig();
      const machines = adminProjects[projectIndex]?.machines || [];
      if (machines.length <= 1) {
        window.alert("每个项目至少需要保留一个设备/点位。");
        return;
      }
      machines.splice(Number(event.target.closest("[data-machine-index]").dataset.machineIndex), 1);
      adminProjects[projectIndex].selectedMachineIndex = Math.max(0, Math.min(adminProjects[projectIndex].selectedMachineIndex || 0, machines.length - 1));
      renderConfigEditor();
      return;
    }

    if (event.target.closest("[data-remove-check]")) {
      adminProjects = collectConfig();
      const checkItems = adminProjects[projectIndex]?.checkItems || [];
      if (checkItems.length <= 1) {
        window.alert("每个项目至少需要保留一个检查项。");
        return;
      }
      checkItems.splice(Number(event.target.closest("[data-project-check-index]").dataset.projectCheckIndex), 1);
      renderConfigEditor();
      return;
    }
  }

  const editButton = event.target.closest("[data-edit-record]");
  if (editButton) {
    try {
      openEditModal(JSON.parse(editButton.dataset.editRecord));
    } catch (error) {
      showAdminError("打开编辑窗口失败：" + (error.message || "记录数据格式异常"));
    }
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
  const project = findProject(selectedProjectId());
  const machine = findMachine(project, selectedMachineId());
  const checkItems = getMachineCheckItems(project, machine);

  for (const item of checkItems) {
    checks[item.key] = {
      status: data.get(item.key),
      remark: data.get(item.key + "_remark") || ""
    };
  }

  const payload = {
    projectId: project.id,
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

[hidden] {
  display: none !important;
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
.modalActions,
.headerActions {
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

.headerActions {
  justify-content: flex-end;
}

.logoutForm {
  margin: 0;
  display: block;
}

.loginShell {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 20px;
}

.loginPanel {
  width: min(420px, 100%);
  margin: 0;
  padding: 24px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: white;
  box-shadow: 0 16px 44px rgba(35, 46, 28, 0.08);
}

.loginError {
  margin: 0;
  border: 1px solid #f1b7b2;
  border-radius: 8px;
  background: #fff1f0;
  color: var(--danger);
  padding: 10px 12px;
  font-weight: 700;
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
.configPanel,
.tableWrap {
  max-width: 1180px;
  margin: 0 auto;
}

.toolbar,
.qrBlock,
.qrGrid,
.configPanel {
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

.sectionHeader,
.configActions,
.configProjectHeader,
.configGroupHeader,
.configRow {
  display: flex;
  align-items: center;
  gap: 12px;
}

.sectionHeader,
.configProjectHeader,
.configGroupHeader {
  justify-content: space-between;
}

.configActions {
  flex-wrap: wrap;
  justify-content: flex-end;
}

.compactSectionHeader h2 {
  font-size: 17px;
}

.configBody {
  margin-top: 14px;
}

.configBodyActions {
  justify-content: flex-start;
  margin-bottom: 12px;
}

.configEditor {
  display: grid;
  gap: 16px;
  margin-top: 16px;
}

.configProject {
  display: grid;
  gap: 16px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: white;
  padding: 16px;
}

.configProject h3,
.configGroup h4,
.configGroup h5 {
  margin: 0;
}

.configGroup {
  display: grid;
  gap: 10px;
}

.configRows {
  display: grid;
  gap: 8px;
}

.machineChecks {
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 14px;
  background: #fbfcf8;
}

.machinePicker {
  max-width: 420px;
}

.defaultCheckToggle {
  justify-self: start;
}

.configRow {
  align-items: stretch;
}

.configRow input:first-child {
  flex: 0 0 210px;
}

.configRow input:nth-child(2) {
  flex: 1 1 auto;
}

.compactButton {
  min-height: 36px;
  padding: 0 12px;
}

.smallIcon {
  flex: 0 0 38px;
  width: 38px;
  min-height: 38px;
  font-size: 22px;
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
  .qrBlock,
  .sectionHeader,
  .configProjectHeader,
  .configGroupHeader,
  .configRow {
    align-items: stretch;
    flex-direction: column;
  }

  .configActions {
    justify-content: stretch;
  }

  .configActions > *,
  .configGroupHeader > *,
  .configRow input:first-child {
    width: 100%;
    flex-basis: auto;
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
