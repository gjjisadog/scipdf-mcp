# scipdf-mcp

一键安装的 **学术论文 PDF 下载** 工具：MCP Server + Agent Skill。

把仓库地址甩给 AI，它执行安装命令后即可：

```text
用户要论文 → Agent 解析 DOI → MCP 下载 → 返回本地 path
```

> 合规提示：请自行确认当地法规与机构政策。本工具仅供个人科研学习自用。

---

## 给别人 / 给 AI 的一键安装

把下面整段发给任意 AI Agent（Grok / Claude / Cursor 等）：

```text
请按仓库 AGENTS.md 为我安装 scipdf-mcp：

git clone https://github.com/gjjisadog/scipdf-mcp.git
cd scipdf-mcp
bash install.sh

装完后重启客户端，用 /scipdf 或「下载论文 + 标题/DOI」测试。
```

### 人类手动安装

```bash
git clone https://github.com/gjjisadog/scipdf-mcp.git
cd scipdf-mcp
bash install.sh
```

可选指定下载目录：

```bash
SCIPDF_DOWNLOAD_DIR=~/Documents/Papers bash install.sh
```

要求：**Node.js ≥ 20**。

安装脚本会自动：

| 步骤 | 内容 |
|------|------|
| 依赖 + 构建 | `npm install` + `npm run build` |
| Skill | 写入 `~/.grok/skills/scipdf`（以及 Claude / agents 目录） |
| MCP | 注册到 Grok / Claude Desktop / Cursor |
| 目录 | 创建 `~/Documents/Papers`（或自定义） |

然后 **重启** 对应 AI 客户端。

---

## 使用

```text
/scipdf 帮我下载：Nanometre-scale thermometry in a living cell
```

或：

```text
下载 DOI 10.1038/nature12373
```

成功示例：

| 字段 | 内容 |
|------|------|
| DOI | `10.1038/nature12373` |
| 路径 | `/Users/你/Documents/Papers/10.1038_nature12373.pdf` |

---

## MCP Tools

| Tool | 说明 |
|------|------|
| `download_paper` | 单篇（DOI / URL / 标题） |
| `download_papers` | 批量 |
| `resolve_doi` | 只解析 DOI |
| `list_mirrors` / `check_mirrors` | 镜像与配置 |

---

## 手动配置（安装脚本失败时）

### Grok `~/.grok/config.toml`

```toml
[mcp_servers.scipdf]
command = "node"
args = ["/绝对路径/scipdf-mcp/dist/index.js"]
enabled = true
env = { SCIPDF_DOWNLOAD_DIR = "/Users/你/Documents/Papers" }
```

### Claude / Cursor JSON

```json
{
  "mcpServers": {
    "scipdf": {
      "command": "node",
      "args": ["/绝对路径/scipdf-mcp/dist/index.js"],
      "env": {
        "SCIPDF_DOWNLOAD_DIR": "/Users/你/Documents/Papers"
      }
    }
  }
}
```

Skill 文件：复制 `skills/scipdf/SKILL.md` → `~/.grok/skills/scipdf/SKILL.md`

---

## 环境变量

| 变量 | 含义 | 默认 |
|------|------|------|
| `SCIPDF_DOWNLOAD_DIR` | PDF 保存目录 | `~/Documents/Papers` |
| `SCIPDF_MIRRORS` | Sci-Hub 镜像（逗号分隔） | 内置列表 |
| `SCIPDF_PDF_HOSTS` | 直连 PDF 主机 | `https://sci.bban.top/pdf/` |
| `SCIPDF_TIMEOUT_MS` | 超时 | `30000` |
| `SCIPDF_CONCURRENCY` | 批量并发 | `2` |

也可复制 `config.example.json` → `config.json`。

---

## 开发

```bash
npm install
npm run build
npm test
npm run dev          # 开发模式跑 MCP
npm run install:all  # 同 install.sh
```

---

## 工作原理（简）

```
query → DOI（Crossref 支持标题）
     → 直连 PDF host / Sci-Hub 镜像
     → 校验 %PDF- → 写入本地
```

Skill 说明见 [`skills/scipdf/SKILL.md`](skills/scipdf/SKILL.md)  
给 Agent 的安装说明见 [`AGENTS.md`](AGENTS.md)

## License

MIT
