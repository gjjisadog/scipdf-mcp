# 论文检索

用户提供主题或关键词时调用 `search_papers`，不要直接把宽泛主题交给下载工具。

可用过滤：`sources`、`limit`、`year_from`、`year_to`、
`min_citations`、`open_access_only`。默认源为 Crossref、OpenAlex、
Semantic Scholar 和 arXiv；结果按 DOI、arXiv ID 或“标题 + 年份”去重，
并融合来源排名。

向用户展示标题、年份、作者、DOI/arXiv ID、引用量、OA 状态和来源。用户
选定后，把明确 DOI 或 arXiv ID 交给下载工具。arXiv 适合查找最新预印本，
其 `openAccessPdf` 指向官方 PDF。
