# scipdf-mcp

一键安装的 **学术论文 PDF 下载** 工具：**MCP Server + Skill + CLI**（v0.3）。

```text
用户找论文 → Crossref/OpenAlex/Semantic Scholar/arXiv 检索
用户要全文 → DOI 或 arXiv ID → 下载 → 返回本地 path + 引用
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
node dist/index.js search "wide bandgap inverter"
node dist/index.js search --sources openalex,semanticscholar --year-from 2022 --oa "SiC inverter"
node dist/index.js citations 10.1038/nature12373
node dist/index.js related 10.1038/nature12373
node dist/index.js search --source arxiv "grid-forming inverter"
node dist/index.js download arXiv:2501.01234
node dist/index.js download 10.1038/nature12373
node dist/index.js download --title "Nanometre-scale thermometry in a living cell"
node dist/index.js batch 10.a/b 10.c/d
node dist/index.js resolve "some title"
node dist/index.js parse refs.bib
node dist/index.js audit refs.bib
node dist/index.js extract "/absolute/path/to/paper.pdf"
node dist/index.js list
node dist/index.js check-mirrors
```

无参数启动 = MCP stdio 服务。

---

## 下载顺序与数据源

默认路径（无需邮箱）：

```text
arXiv ID / URL → arXiv 官方 PDF（直接下载）

DOI：
（可选）出版商授权 PDF API      # Elsevier；Springer Nature/IEEE 需全文 endpoint
（可选）免费 OA 数据源         # SCIPDF_PREFER_OA=true；无需邮箱
  → Unpaywall OA              # 另设 SCIPDF_UNPAYWALL_EMAIL 时加入
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
| `search_papers` | Crossref + OpenAlex + Semantic Scholar + arXiv 统一检索 |
| `list_search_sources` | 列出检索源及搜索、引用链、推荐、PDF 等能力 |
| `list_pdf_sources` | 列出 `PdfSource`、合法性和支持的标识符 |
| `get_citations` / `get_references` | 通过 Semantic Scholar 前向/后向追踪引用 |
| `find_related_papers` | 查找相似论文 |
| `download_paper` | 单篇 DOI/标题/arXiv ID；arXiv 直接从官方 PDF 下载 |
| `download_papers` | 批量去重 + manifest v2（来源历史、OA 证据、SHA-256） |
| `resolve_doi` | Crossref + OpenAlex |
| `parse_references` | bib/ris/粘贴列表抽 DOI |
| `extract_paper_text` | 从下载目录内的 PDF 提取正文并写入相邻 `.txt` |
| `audit_references` | 批量核验引用、解析 DOI、输出规范引用与失败项 |
| `list_mirrors` / `check_mirrors` | 配置与健康缓存探测 |
| `list_papers` | 已下载列表 |
| `open_paper` | 系统默认打开 PDF |
| `format_citation` | APA / GB/T / BibTeX |
| `reload_config` | 热加载配置 |

- Resource: `papers://list`
- Prompt: `download_papers_batch`

错误码：`DOI_NOT_FOUND` / `AMBIGUOUS_DOI` / `INVALID_ARXIV_ID` /
`MIRROR_BLOCKED` / `ALL_SOURCES_FAILED` / `PDF_NOT_IN_DB` 等。

---

## 环境变量（节选）

| 变量 | 含义 | 默认 |
|------|------|------|
| `SCIPDF_DOWNLOAD_DIR` | 保存目录 | `~/Documents/Papers` |
| `SCIPDF_UNPAYWALL_EMAIL` | 可选，启用 Unpaywall 时使用的真实邮箱 | 未设 = 跳过 Unpaywall |
| `SCIPDF_SEMANTIC_SCHOLAR_API_KEY` | 可选，提高 Semantic Scholar 检索配额 | 未设置 = 匿名配额 |
| `SCIPDF_ELSEVIER_API_KEY` | Elsevier Article Retrieval API key（仅从环境读取） | 未设置 = 跳过 |
| `SCIPDF_ELSEVIER_INSTTOKEN` / `SCIPDF_ELSEVIER_AUTHTOKEN` | 可选 Elsevier 机构/用户授权令牌 | 未设置 |
| `SCIPDF_SPRINGER_NATURE_API_KEY` | Springer Nature key（仅从环境读取） | 未设置 = 跳过 |
| `SCIPDF_SPRINGER_NATURE_PDF_ENDPOINT` | 已获授权的 Springer Nature PDF endpoint 模板，支持 `{doi}` | 未设置 |
| `SCIPDF_IEEE_API_KEY` | IEEE API key（仅从环境读取） | 未设置 = 跳过 |
| `SCIPDF_IEEE_FULLTEXT_ENDPOINT` | 已获授权的 IEEE PDF endpoint 模板，支持 `{doi}` | 未设置 |
| `SCIPDF_PREFER_OA` | 为 true 时才在 Sci-Hub **前**试 OA | **`false`（默认 Sci-Hub）** |
| `SCIPDF_ALLOW_SCIHUB` | 是否允许 Sci-Hub（主路径） | `true` |
| `SCIPDF_FILENAME_STYLE` | `doi` 或 `author_year_title` | `doi` |
| `SCIPDF_PDF_HOSTS` | 直连 PDF 主机（逗号分隔） | `https://sci.bban.top/pdf/` |
| `SCIPDF_MIRRORS` | HTML 镜像列表（逗号分隔） | 见上表（15 个） |
| `SCIPDF_DEBUG=1` | 调试日志 | off |
| `SCIPDF_HEALTH_TTL_MS` | 镜像健康缓存 | 15min |

### Unpaywall（可选，非强制）

**默认只走 Sci-Hub**，无需任何邮箱。

若要优先合法 OA，启用：

```bash
export SCIPDF_PREFER_OA=true
```

这会先尝试 OpenAlex、Europe PMC 和 Semantic Scholar。若还要加入
[Unpaywall](https://unpaywall.org/products/api)，再设置
`SCIPDF_UNPAYWALL_EMAIL`；该服务要求真实邮箱（统计用量，不收费）。

| 配置 | 行为 |
|------|------|
| 默认（无邮箱 / 无 PREFER_OA） | 只走 Sci-Hub / pdfHosts |
| 只设邮箱 | 仍默认 Sci-Hub（可用 `unpaywall` 命令单独查询） |
| 仅 `PREFER_OA=true` | 先免费 OA 数据源，失败再 Sci-Hub |
| 邮箱 + `PREFER_OA=true` | 在上述 OA 数据源中加入 Unpaywall |
| `ALLOW_SCIHUB=false` + `PREFER_OA=true` | 仅 OA |

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

### 统一论文检索

`search_papers` 同时查询 Crossref、OpenAlex、Semantic Scholar 和 arXiv，
将不同来源统一为相同字段，按 DOI、arXiv ID 或“标题 + 年份”去重，并使用
Reciprocal Rank Fusion 融合来源排名。支持：

- 指定一个或多个来源；
- 限制年份区间；
- 最低引用量；
- 仅保留已知开放获取结果；
- 最多返回 50 条。

MCP 参数示例：

```json
{
  "query": "wide bandgap semiconductor inverter",
  "sources": ["openalex", "semanticscholar"],
  "limit": 20,
  "year_from": 2022,
  "min_citations": 5,
  "open_access_only": true
}
```

搜索结果只用于发现和筛选论文；选定结果后，把 DOI 或 arXiv ID 交给
`download_paper` / `download_papers` 下载。arXiv 结果始终包含官方 PDF
地址，不要求开启 `SCIPDF_PREFER_OA`。

### PDF 来源抽象

下载层通过统一 `PdfSource` 调度：

| 来源 | 标识符 | 行为 |
|------|--------|------|
| `arxiv` | arXiv ID | 官方仓储直接 PDF，合法来源 |
| `elsevier` | DOI | 配置 `SCIPDF_ELSEVIER_API_KEY` 后调用官方 Article Retrieval PDF API |
| `springer-nature` | DOI | key + 授权 PDF endpoint；官方标准 Full Text API 返回 JATS/XML，不能冒充 PDF |
| `ieee` | DOI | key + 单独获权的全文 endpoint；普通 Metadata API key 不等于全文权限 |
| `doi-oa` | DOI | `PREFER_OA=true` 时尝试 Unpaywall/OpenAlex/Europe PMC/Semantic Scholar |
| `legacy` | DOI | 现有 pdfHosts/Sci-Hub 回退链 |

缓存侧车使用 `identifier` 保存 `doi:…` 或 `arxiv:…`，并兼容旧版仅含 `doi`
的侧车文件。

出版商 key/token 不写入 `SciPdfConfig`，也不会出现在 MCP 配置回显或
manifest。endpoint URL 中的 `api_key`、`apikey`、`token` 等查询参数在
返回和落盘前会被脱敏。

### 下载状态与 manifest v2

下载结果继续保留兼容字段 `ok`、`code`、`source`，并新增：

- `status`：`downloaded`、`cached`、`not_found`、`not_entitled`、
  `rate_limited`、`invalid_pdf` 等；
- `attempts`：按实际顺序记录来源、结果、耗时、HTTP 状态、合法性和访问模式；
- `oa` / `oaEvidence`：OA 提供者、版本、许可证及 PDF 证据；
- `sha256`：最终保存或缓存 PDF 的 SHA-256。

批量下载写出的 `scipdf-manifest.json` 使用 `manifestVersion: 2`，包含汇总、
上述审计字段和自动凭据脱敏。

---

## 开发

```bash
npm install && npm run build && npm test
npm run install:all
```

CI：GitHub Actions 上 Node 20/22 build + test。

## License

MIT
