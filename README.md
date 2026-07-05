# 清洗机微信扫码检查确认

这是一个可部署到 Cloudflare Workers 的扫码检查小应用，按《清洗机运行记录本》的字段生成检查表：

- 微信扫码打开填写页
- 服务端自动记录检查日期和提交时间，避免只依赖手机本地时间或人工选择日期
- 后台按月份查看记录
- 后台一键导出当月 `.xlsx` 文件，包含总表和 1号/2号/3号清洗机分表

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

- 填写页：`http://127.0.0.1:8787/check?machine=cleaner-01`
- 后台：`http://127.0.0.1:8787/admin`

后台会显示 1号、2号、3号清洗机的独立二维码；也可以直接访问：

- `https://你的域名/check?machine=cleaner-01`
- `https://你的域名/check?machine=cleaner-02`
- `https://你的域名/check?machine=cleaner-03`

每个二维码卡片都可以下载带设备名称的 SVG 打印图，适合打印后贴到现场。

后台账号固定为 `admin`，密码读取 `.dev.vars` 或 Cloudflare Secret 里的 `ADMIN_PASSWORD`。

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
