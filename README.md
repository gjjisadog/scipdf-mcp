# scipdf-mcp

一键安装的 **学术论文 PDF 下载** 工具：**MCP Server + Skill + CLI**（v0.3）。

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

## 下载顺序与数据源

默认路径（无需邮箱）：

```text
（可选）Unpaywall OA          # 仅当 SCIPDF_UNPAYWALL_EMAIL + SCIPDF_PREFER_OA=true
  → pdfHosts 直链 PDF         # 如 sci.bban.top
  → scihubMirrors HTML 镜像   # 逐个解析页面中的 PDF 链接
```

健康缓存会跳过近期失败的镜像（`SCIPDF_HEALTH_TTL_MS`，默认 15 分钟）。可用 `check-mirrors` / MCP `check_mirrors` 探测。

### 默认 pdfHosts

| 主机 | 说明 |
|------|------|
| `https://sci.bban.top/pdf/` | 优先尝试的 DOI 直链主机 |

### 默认 Sci-Hub 镜像（`DEFAULT_MIRRORS`）

内置 **15** 个 HTML 镜像（以 `src/config.ts` / `config.example.json` 为准）：

| 镜像 | 备注 |
|------|------|
| `https://sci-hub.ren/` | 传统域名 |
| `https://sci-hub.red/` | 传统域名 |
| `https://sci-hub.ee/` | 传统域名 |
| `https://sci-hub.st/` | 传统域名（部分网络较慢或拦截） |
| `https://sci-hub.ru/` | 传统域名 |
| `https://sci-hub.box/` | 传统域名 |
| `https://sci-hub.se/` | 传统域名（部分网络 DNS 失败） |
| `https://sci-hub.sidesgame.com/` | 已实测可下 PDF |
| `https://sci-hub.vg/` | 已实测可下 PDF |
| `https://sci-hub.usualwant.com/` | 已实测可下 PDF |
| `https://sci-hub.hkvisa.net/` | 已实测；可能跳转 usualwant |
| `https://sci-hub.al/` | 已实测可下 PDF |
| `https://sci-hub.mksa.top/` | 已实测；可能跳转 pismin |
| `https://www.pismin.com/` | 已实测可下 PDF |
| `https://www.sci-hub.in/` | 已实测可下 PDF |

镜像可用性随地区与封锁变化；列表仅作默认回退，**不是**可用性保证。

### 自定义镜像

环境变量（逗号 / 分号 / 换行分隔）：

```bash
export SCIPDF_MIRRORS="https://sci-hub.vg/,https://www.pismin.com/"
export SCIPDF_PDF_HOSTS="https://sci.bban.top/pdf/"
node dist/index.js check-mirrors
node dist/index.js download --force 10.1038/nature12373
```

或复制 `config.example.json` → 项目目录 `config.json` / `~/.config/scipdf-mcp/config.json`，编辑 `scihubMirrors` 与 `pdfHosts`。  
配置优先级：`SCIPDF_*` 环境变量 > 配置文件 > 内置默认。

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
| `SCIPDF_UNPAYWALL_EMAIL` | 可选，Unpaywall 真实邮箱 | 未设 = 不用 OA |
| `SCIPDF_PREFER_OA` | 为 true 时才在 Sci-Hub **前**试 OA | **`false`（默认 Sci-Hub）** |
| `SCIPDF_ALLOW_SCIHUB` | 是否允许 Sci-Hub（主路径） | `true` |
| `SCIPDF_FILENAME_STYLE` | `doi` 或 `author_year_title` | `doi` |
| `SCIPDF_PDF_HOSTS` | 直连 PDF 主机（逗号分隔） | `https://sci.bban.top/pdf/` |
| `SCIPDF_MIRRORS` | HTML 镜像列表（逗号分隔） | 见上表（15 个） |
| `SCIPDF_DEBUG=1` | 调试日志 | off |
| `SCIPDF_HEALTH_TTL_MS` | 镜像健康缓存 | 15min |

### Unpaywall（可选，非强制）

**默认只走 Sci-Hub**，无需任何邮箱。

若要优先合法 OA，需**同时**配置：

```bash
export SCIPDF_UNPAYWALL_EMAIL="你的真实邮箱@gmail.com"
export SCIPDF_PREFER_OA=true
```

[Unpaywall](https://unpaywall.org/products/api) 要求真实邮箱（统计用量，不收费）。`example.com` 无效。

| 配置 | 行为 |
|------|------|
| 默认（无邮箱 / 无 PREFER_OA） | 只走 Sci-Hub / pdfHosts |
| 只设邮箱 | 仍默认 Sci-Hub（可用 `unpaywall` 命令单独查询） |
| 邮箱 + `PREFER_OA=true` | 先 OA，失败再 Sci-Hub |
| `ALLOW_SCIHUB=false` + 邮箱 + PREFER_OA | 仅 OA |

Grok 示例（可选 OA）：

```toml
[mcp_servers.scipdf]
command = "node"
args = ["/path/to/scipdf-mcp/dist/index.js"]
env = {
  SCIPDF_DOWNLOAD_DIR = "/Users/you/Documents/Papers",
  SCIPDF_UNPAYWALL_EMAIL = "you@gmail.com",
  SCIPDF_PREFER_OA = "true"
}
```

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
