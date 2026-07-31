# PDF 正文提取

对已经下载的本地论文调用 `extract_paper_text`，参数 `path` 必须是配置下载
目录内的绝对 PDF 路径。可用 `page_from`、`page_to` 限制页码，
`preview_chars` 控制工具返回的预览长度。

工具会在 PDF 相邻位置写同名 `.txt`，并返回 `textPath`、页数、字符数和
preview。路径越界、符号链接逃逸、无效 PDF 均应原样报错。
