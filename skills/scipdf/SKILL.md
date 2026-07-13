---
name: scipdf
description: >
  Download academic paper PDFs via scipdf MCP (or CLI). Workflow: resolve DOI
  (Crossref/OpenAlex) → download_paper(s) → return local paths + citations.
  Triggers: /scipdf, 下载论文, 找论文, 全文, PDF, download paper, bibliography,
  文献, DOI batch, bib/ris import.
metadata:
  short-description: "DOI → scipdf MCP → local PDF path + citation"
---

# scipdf — 论文 PDF 本地下载工作流

配套：**MCP `scipdf`** + 可选 CLI `node …/scipdf-mcp/dist/index.js`。

目标：用户要论文 → **DOI** → 本地下载 → 返回 **path**（+ 可选引用格式）。

下载顺序（MCP 内部）：

1. **可选 Unpaywall OA**：仅当用户同时配置了  
   `SCIPDF_UNPAYWALL_EMAIL` **且** `SCIPDF_PREFER_OA=true` 时，才在 Sci-Hub **之前**尝试合法 OA  
2. **默认：pdfHosts → Sci-Hub 镜像**（始终主路径，无需额外配置）  
   - pdfHosts 默认：`https://sci.bban.top/pdf/`  
   - 镜像默认约 15 个（含 ren/red/ee/st/ru/box/se、sidesgame、vg、usualwant、hkvisa、al、mksa.top、pismin、sci-hub.in 等）  
   - 完整列表见仓库 `src/config.ts` / `config.example.json` / README  

未配置邮箱 / 未开 PREFER_OA → 行为与纯 Sci-Hub 一致。不要要求用户必须配邮箱。  
镜像异常时用 `check_mirrors`（可 `force_refresh: true`）；可用 `SCIPDF_MIRRORS` / `SCIPDF_PDF_HOSTS` 覆盖。

## 前置条件 / 诊断

1. 工具列表应有 `download_paper`（MCP 名 `scipdf`）。
2. **若没有 MCP 工具：**
   - 提示用户：重启客户端；或运行  
     `cd <repo> && bash install.sh` / `bash install.sh --update`
   - 不要假装已下载。
   - 若用户本机有仓库，可退路执行 CLI：  
     `node /path/to/scipdf-mcp/dist/index.js download "<query>"`

## 完整工作流

```
用户：标题 / DOI / 链接 / 文献列表 / bib
  → ① 收集查询
  → ② resolve_doi（必要时）
  → ③ download_paper / download_papers
  → ④ 汇报 path + DOI + 引用；失败报 code
```

### ① 收集

优先级：DOI → URL → 标题 → 引用串 → bib/ris 整段（用 `parse_references`）。

### ② 解析 DOI

| 输入 | 动作 |
|------|------|
| DOI | 直接 `download_paper` |
| 标题 | `resolve_doi` 或直接 `download_paper`（内部会解析） |
| 失败 `DOI_NOT_FOUND` | 看 `candidates`；或 web 检索后用明确 DOI 再下 |
| `AMBIGUOUS_DOI` | **列出 candidates 让用户选**，不要静默下错篇 |

### ③ 下载

```text
download_paper:
  query: "..."
  query_type: auto|doi|title|url|citation
  force: false
```

批量：

```text
download_papers:
  queries: ["10.a/b", "title...", "@article{...}"]
```

- 已存在文件会返回 `cached: true` + path（不必当错误）。
- 镜像异常：`check_mirrors`（可 `force_refresh: true`）。

### ④ 汇报（必填字段）

成功：

- 标题、DOI、**path**、bytes、`cached`、可选 `citation.apa` / `gbt` / `bibtex`

失败：

- `code`（如 `DOI_NOT_FOUND` / `MIRROR_BLOCKED` / `ALL_SOURCES_FAILED` / `PDF_NOT_IN_DB`）
- `error` 原文
- `candidates`（若有）

**禁止编造 path。**

## 失败重试（固定策略）

1. 标题 → `download_paper` 失败且 `DOI_NOT_FOUND`  
2. 用 `resolve_doi` 或 candidates / 公开网页确认 DOI  
3. `download_paper` + `query_type: "doi"`  
4. 仍失败 → `check_mirrors`，把 code 给用户，不无限重试

## 引用与打开

- 下载结果已含 citation 时直接展示 APA 或 GB/T。
- 需要时可 `format_citation` / `open_paper`。

## 批量 / 文献库

- `parse_references` 抽 DOI  
- `download_papers` 自动去重并写 `scipdf-manifest.json`  
- `list_papers` 查看已下载

## 完成标准

- [ ] 每篇有 DOI 或明确无法解析  
- [ ] 成功项有真实 path  
- [ ] 失败项有 code，无虚构文件  
- [ ] 歧义时已请用户确认  

## 合规

合规由用户自负。本 skill 只规范工具调用与结果汇报。
