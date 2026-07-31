---
name: scipdf
description: >
  Search academic papers, trace citations, audit references, download PDFs,
  and extract local PDF text via scipdf MCP or CLI. Triggers: /scipdf,
  下载论文, 找论文, 全文, PDF, 文献, 引用链, 相似论文, DOI batch, bib/ris.
metadata:
  short-description: "论文检索 → DOI/arXiv ID → PDF/正文/引用"
---

# scipdf

使用 MCP `scipdf`；只有 MCP 不可用时才退回
`node /path/to/scipdf-mcp/dist/index.js <command>`。不要编造 DOI、本地路径或
下载成功状态。

## 路由

- 主题、关键词、找相关论文：读取 [references/search.md](references/search.md)。
- 引用、参考文献、相似论文：读取 [references/discovery.md](references/discovery.md)。
- 下载 PDF、批量下载、失败恢复：读取 [references/download.md](references/download.md)。
- 提取本地 PDF 正文：读取 [references/extract.md](references/extract.md)。
- 核验参考文献、BibTeX/RIS 审计：读取 [references/audit.md](references/audit.md)。

## 默认工作流

```text
主题/关键词 → search_papers → 用户选择 → 明确 DOI 或 arXiv ID
标题/引用串 → resolve_doi → 明确 DOI
明确 DOI → download_paper(s) → 返回真实 path + citation
arXiv ID/URL → download_paper(s) → arXiv 官方 PDF
本地 PDF → extract_paper_text → 返回 textPath + preview
```

遇到 `AMBIGUOUS_DOI` 时列出 candidates 请用户选择；失败时原样报告
`code` 和 `error`。成功下载必须有工具返回的真实 `path`。

## 数据源行为

- 默认下载路径：pdfHosts → Sci-Hub 镜像，无需邮箱。
- arXiv ID/URL 始终优先从 arXiv 官方 PDF 直接下载。
- `SCIPDF_PREFER_OA=true`：先尝试 OpenAlex、Europe PMC、Semantic Scholar。
- 同时设置 `SCIPDF_UNPAYWALL_EMAIL`：OA 阶段额外加入 Unpaywall。
- `SCIPDF_SEMANTIC_SCHOLAR_API_KEY` 可选，用于提高 Semantic Scholar 配额。
- 配置出版商授权后优先尝试 Elsevier PDF API；Springer Nature/IEEE 还必须
  配置其获权全文 endpoint。所有 key/token 只从环境读取。

## 完成标准

- 检索结果说明来源；下载前尽量确认 DOI 或 arXiv ID。
- 成功项有真实 path、sha256 和 attempts；失败项有 code/status/error/attempts。
- 歧义引用未被静默选取。
- 正文提取只处理配置下载目录内的有效 PDF。

合规由用户自负；本 Skill 只规范工具调用与结果汇报。
