# 引用审计

对 BibTeX、RIS 或粘贴的参考文献列表调用 `audit_references`。结果状态：

- `verified`：输入 DOI 且已取得元数据。
- `resolved`：标题/引用串已解析到 DOI。
- `unverified`：DOI 合法，但未取得可核验标题元数据。
- `ambiguous`：多个候选接近，需要用户选择。
- `not_found`：未找到可信 DOI。

汇报总数、成功解析数、失败数，并重点列出 ambiguous/not_found。工具同时
返回 APA、GB/T 7714 和 BibTeX，不能把 unresolved 项伪装成已验证引用。
