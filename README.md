# 微信扫码检查确认

这是一个可部署到 Cloudflare Workers 的扫码检查小应用，可以按不同项目生成不同检查表：

- 微信扫码打开填写页
- 服务端自动记录检查日期和提交时间，避免只依赖手机本地时间或人工选择日期
- 后台按月份、设备/点位查看记录
- 后台一键导出当前筛选的 `.xlsx` 文件，包含总表、项目分表和设备/点位分表
- 支持在后台新增不同扫码项目，每个项目可以有自己的设备/点位和检查内容

## 本地运行

```powershell
npm install
npm run db:init
@"
ADMIN_PASSWORD=请改成强密码
"@ | Set-Content -Encoding UTF8 .dev.vars
npm run dev
```

打开：

- 填写页：`http://127.0.0.1:8787/check?project=cleaner-startup&machine=cleaner-01`
- 后台：`http://127.0.0.1:8787/admin`

后台会显示已配置项目的独立二维码；清洗机项目也兼容旧链接：

- `https://你的域名/check?machine=cleaner-01`
- `https://你的域名/check?machine=cleaner-02`
- `https://你的域名/check?machine=cleaner-03`

每个二维码卡片都可以下载带设备名称的 SVG 打印图，适合打印后贴到现场。

后台账号固定为 `admin`，密码读取 `.dev.vars` 或 Cloudflare Secret 里的 `ADMIN_PASSWORD`。

## 新增或修改扫码项目

进入后台 `/admin`，首页优先展示检查记录；“扫码项目和检查内容”默认收起，需要修改配置时点击展开。配置区可以维护：

- 新增或删除扫码项目
- 修改项目名称、右上角标签、签名字段名称
- 新增或删除设备/点位
- 通过设备/点位下拉框筛选并维护该设备自己的检查项
- 维护项目默认检查项；新增同类设备时会复制这套默认项，之后仍可单独修改该设备检查项

保存配置后，后台二维码、填写页和后续导出会立即按新配置生成。历史记录仍保留提交时的检查项内容，不会因为后续修改配置而丢失。不同类型设备不要共用一套检查项；可以在该设备下面直接维护独立检查项。

线上旧数据库需要补一下配置表：

```powershell
npx wrangler d1 execute cleaner_check_db --remote --file=./schema.sql
```

如果只是本地调试，运行：

```powershell
npm run db:init
```

## 部署到 Cloudflare

1. 创建 D1 数据库：

```powershell
npx wrangler d1 create cleaner_check_db
```

2. 把命令输出里的 `database_id` 填到 `wrangler.toml`。

3. 初始化线上表结构：

```powershell
npx wrangler d1 execute cleaner_check_db --remote --file=./schema.sql
```

4. 设置后台密码：

```powershell
npx wrangler secret put ADMIN_PASSWORD
```

5. 部署：

```powershell
npm run deploy
```

部署完成后进入 `/admin`，用后台页面中的二维码让员工用微信扫码填写。
