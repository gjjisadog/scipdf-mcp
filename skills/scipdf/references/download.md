# PDF 下载

优先级：DOI / arXiv ID → URL → 标题 → 引用串 → BibTeX/RIS 整段。

- 单篇：`download_paper`。
- arXiv ID、`arXiv:…`、`arxiv.org/abs/…` 和 `arxiv.org/pdf/…` 会直接
  使用官方 PDF，不依赖 DOI，也不要求 `SCIPDF_PREFER_OA=true`。
- 批量：`parse_references` 后用 `download_papers`；后者去重并写 manifest。
- 出版商 API：Elsevier 使用官方 PDF API；Springer Nature 和 IEEE 只有在
  配置了单独获权的 PDF/full-text endpoint 后参与下载。普通元数据 key
  不代表 PDF 权限。
- `DOI_NOT_FOUND`：检查 candidates，必要时公开检索后以明确 DOI 重试。
- `AMBIGUOUS_DOI`：请用户选择，不要静默下载。
- 镜像错误：可调用 `check_mirrors`，但不要无限重试。

成功时返回标题、DOI/arXiv ID、真实 `path`、`cached`、`sha256`、
`attempts` 和可用 citation。OA 下载同时查看 `oa`/`oaEvidence`。
失败时返回原始 `code`、`status`、`error`、`attempts` 与 candidates；
`not_entitled` 与 `rate_limited` 不应误报为“论文不存在”。

批量 manifest v2 带来源历史、OA 证据、SHA-256 与汇总；出版商 key/token
在返回和 manifest 中必须保持脱敏。
