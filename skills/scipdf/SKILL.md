---
name: scipdf
description: >
  Download academic paper PDFs to a local folder via the scipdf MCP server.
  Workflow: resolve DOI → call MCP download tools → return saved file paths.
  Use when the user wants papers, PDFs, full text, "下载论文", "找论文",
  "download paper", DOI batch download, or runs /scipdf.
metadata:
  short-description: "Resolve DOI → scipdf MCP → local PDF path"
---

# scipdf — 论文 PDF 本地下载工作流

配套 MCP：`scipdf`（`download_paper` / `download_papers` / `resolve_doi` 等）。

目标：用户说出要找的论文 → 得到 **DOI** → 调用 MCP → 把 **本地保存路径** 交还给用户。

## 前置条件

1. MCP server `scipdf` 已在客户端配置并可用。
2. 若工具列表里没有 `download_paper`，先告知用户检查 MCP 配置，不要假装已下载。

## 完整工作流（必须按序）

```
用户：我需要这些论文（标题 / 链接 / DOI / 文献列表）
        │
        ▼
 ① 收集与规范化查询
        │
        ▼
 ② 解析 DOI（能直接用就不搜）
        │
        ▼
 ③ 调用 scipdf MCP 下载
        │
        ▼
 ④ 向用户汇报：标题、DOI、本地 path、是否成功
```

### ① 收集查询

从用户消息中提取每一篇的标识，优先级：

1. **DOI**（`10.xxxx/...` 或 `https://doi.org/...`）— 直接用  
2. **出版社 / doi.org URL** — 交给 MCP（可抽 DOI）或先 `resolve_doi`  
3. **论文标题**（可带作者、年份）— 用于解析 DOI  
4. 模糊描述 — 先澄清或检索公开元数据，**确认标题/DOI 后再下载**

多篇时列成清单，逐项处理；批量时用 `download_papers`。

### ② 解析 DOI

| 用户已有 | Agent 动作 |
|----------|------------|
| 明确 DOI | 规范化后进入 ③（去掉 `https://doi.org/` 前缀即可） |
| 只有标题 / 不完整引用 | 调用 MCP `resolve_doi`，或用公开学术元数据（Crossref 等）确认 DOI |
| 只有链接 | 优先从链接抽 DOI；抽不到则 `resolve_doi` |
| DOI 不确定 | 把候选 DOI + 标题给用户确认，或取置信度最高的一条并在回复中注明 |

**不要**在没有合理 DOI/标题的情况下盲目下载。

### ③ 调用 MCP 下载

**单篇：**

```text
tool: download_paper
args:
  query: "<DOI 或标题或 URL>"
  query_type: "doi" | "title" | "url" | "auto"   # 能确定类型就显式传
  force: false   # 仅当用户要求重新下载时为 true
```

**多篇：**

```text
tool: download_papers
args:
  queries: ["10.xxx/a", "10.xxx/b", "..."]
  query_type: "auto"
```

可选：

- 镜像异常时先 `check_mirrors` / `list_mirrors`
- 用户指定目录时传 `outdir`

### ④ 向用户汇报

对每一篇清楚给出：

| 字段 | 来源 |
|------|------|
| 标题 | MCP 返回的 `title`（若有） |
| DOI | `doi` |
| 本地路径 | `path`（**这是用户最需要的结果**） |
| 大小 | `bytes`（若有） |
| 状态 | `ok: true/false`；失败写 `error` |

成功示例表述：

> 已保存：  
> - *Nanometre-scale thermometry in a living cell*  
> - DOI: `10.1038/nature12373`  
> - 路径: `/Users/.../Papers/10.1038_nature12373.pdf`

失败时：

- 如实说明 MCP 的 `error`
- 可建议：核对 DOI、`check_mirrors`、换网络/镜像配置
- **不要编造**路径或假装文件已存在

## 行为准则

1. **工作流中心是 DOI + 本地 path**，不是长篇讲解下载原理。  
2. 优先调用 MCP，不要自己用浏览器/ curl 重造下载逻辑（除非 MCP 不可用且用户要求排查）。  
3. 批量任务：先解析齐 DOI 清单，再 `download_papers`，最后用表格汇总成功/失败。  
4. 已存在文件：MCP 可能返回已有 `path`；告知用户已存在，除非其要求 `force: true`。  
5. 合法与合规由用户自负；本 skill 只规范工具调用与结果汇报，不做来源伪装，也不引导规避安全策略。

## 示例对话

**用户：** `/scipdf` 帮我找 Nature 上这篇：Nanometre-scale thermometry in a living cell  

**Agent：**

1. `resolve_doi` 或 `download_paper` with title/DOI  
2. 得到 path  
3. 回复路径与 DOI  

**用户：** 批量下载这些 DOI：`10.a/b`, `10.c/d`  

**Agent：** `download_papers` → 表格列出每篇 path 或 error。

## MCP 工具速查

| Tool | 用途 |
|------|------|
| `download_paper` | 单篇下载 |
| `download_papers` | 批量下载 |
| `resolve_doi` | 只解析 DOI，不下载 |
| `list_mirrors` | 查看配置与镜像 |
| `check_mirrors` | 探测镜像是否可用 |

## 完成标准

- [ ] 每篇目标论文都有明确 DOI（或已说明无法解析）  
- [ ] 已调用 scipdf MCP（而非口头声称）  
- [ ] 成功项给出可打开的本地 `path`  
- [ ] 失败项给出真实错误，无虚构文件  
