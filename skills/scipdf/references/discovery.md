# 引用链与相似论文

- `get_citations`：查询引用目标论文的文献。
- `get_references`：查询目标论文引用的文献。
- `find_related_papers`：查询相似论文。

输入使用 DOI 或 Semantic Scholar paper ID，`limit` 为 1–100。三项功能当前
均由 Semantic Scholar 提供，结果沿用统一论文模型。没有结果时说明可能是
标识符未收录、匿名配额受限或网络失败，不要声称引用数为零。
