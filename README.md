# scipdf-mcp

一键安装的 **学术论文 PDF 下载** 工具：**MCP Server + Skill + CLI**（v0.2）。

```text
用户要论文 → 解析 DOI（Crossref/OpenAlex）→ 下载 → 返回本地 path + 引用
```

> 合规提示：请自行确认当地法规与机构政策。本工具仅供个人科研学习自用。

**仓库：** https://github.com/gjjisadog/scipdf-mcp

---

## 给 AI / 一键安装

```text
请按仓库 AGENTS.md 安装 scipdf-mcp：

git clone https://github.com/gjjisadog/scipdf-mcp.git
cd scipdf-mcp && bash install.sh

重启客户端后用 /scipdf 测试。更新：bash install.sh --update
```

```bash
git clone https://github.com/gjjisadog/scipdf-mcp.git
cd scipdf-mcp
bash install.sh
# 更新
bash install.sh --update
```

要求：**Node.js ≥ 20**。安装后会注册 MCP + Skill，并做 CLI 自检。

---

## 使用

**Agent：** `/scipdf 下载：Nanometre-scale thermometry in a living cell`

**CLI：**

```bash
node dist/index.js download 10.1038/nature12373
node dist/index.js download --title "Nanometre-scale thermometry in a living cell"
node dist/index.js batch 10.a/b 10.c/d
node dist/index.js resolve "some title"
node dist/index.js parse refs.bib
node dist/index.js list
node dist/index.js check-mirrors
```

无参数启动 = MCP stdio 服务。

---

## MCP Tools / Resources / Prompts

| Tool | 说明 |
|------|------|
| `download_paper` | 单篇；返回 path、`cached`、`citation`、错误 `code` |
| `download_papers` | 批量去重 + `scipdf-manifest.json` |
| `resolve_doi` | Crossref + OpenAlex |
| `parse_references` | bib/ris/粘贴列表抽 DOI |
| `list_mirrors` / `check_mirrors` | 配置与健康缓存探测 |
| `list_papers` | 已下载列表 |
| `open_paper` | 系统默认打开 PDF |
| `format_citation` | APA / GB/T / BibTeX |
| `reload_config` | 热加载配置 |

- Resource: `papers://list`
- Prompt: `download_papers_batch`

错误码：`DOI_NOT_FOUND` / `AMBIGUOUS_DOI` / `MIRROR_BLOCKED` / `ALL_SOURCES_FAILED` / `PDF_NOT_IN_DB` 等。

---

## 环境变量（节选）

| 变量 | 含义 | 默认 |
|------|------|------|
| `SCIPDF_DOWNLOAD_DIR` | 保存目录 | `~/Documents/Papers` |
| `SCIPDF_UNPAYWALL_EMAIL` | **Unpaywall 邮箱（你自己的真实邮箱）** | 未设置则跳过 OA |
| `SCIPDF_PREFER_OA` | 是否优先 Unpaywall | `true` |
| `SCIPDF_ALLOW_SCIHUB` | OA 失败后是否走 Sci-Hub | `true` |
| `SCIPDF_FILENAME_STYLE` | `doi` 或 `author_year_title` | `doi` |
| `SCIPDF_PDF_HOSTS` | 直连 PDF 主机 | `sci.bban.top/pdf/` |
| `SCIPDF_MIRRORS` | HTML 镜像列表 | 内置 |
| `SCIPDF_DEBUG=1` | 调试日志 | off |
| `SCIPDF_HEALTH_TTL_MS` | 镜像健康缓存 | 15min |

### Unpaywall（合法 OA）

[Unpaywall](https://unpaywall.org/products/api) 要求请求里带**你自己的邮箱**（统计用量，非注册付费）。

```bash
export SCIPDF_UNPAYWALL_EMAIL="you@example.com"
# 或 config.json: "unpaywallEmail": "you@example.com"
```

Grok MCP 配置示例：

```toml
[mcp_servers.scipdf]
command = "node"
args = ["/path/to/scipdf-mcp/dist/index.js"]
env = { SCIPDF_DOWNLOAD_DIR = "/Users/you/Documents/Papers", SCIPDF_UNPAYWALL_EMAIL = "you@example.com" }
```

下载顺序：`Unpaywall OA → Sci-Hub/pdfHosts`。仅 OA：`SCIPDF_ALLOW_SCIHUB=false`。

见 `config.example.json`。

---

## 开发

```bash
npm install && npm run build && npm test
npm run install:all
```

CI：GitHub Actions 上 Node 20/22 build + test。

## License

MIT
