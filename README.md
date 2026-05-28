# ARC Agent 远程代理

在任意电脑上运行此代理，即可通过手机/平板远程控制该电脑的终端。

## 快速开始

### Windows

1. 安装 [Node.js 18+](https://nodejs.org)（如果没有的话）
2. 双击 `install.bat`（或手动运行 `npm install`）
3. 编辑 `.env` 文件，配置：
   - `SERVER_URL` → 你的服务器 WebSocket 地址
   - `AGENT_ID` → 给这台机器起个名字（如 `office-pc`、`home-laptop`）
   - `JWT_SECRET` → 必须跟服务器一致
   - `WORKSPACE_DIR` → 工作目录路径
4. 双击 `start.bat`（或运行 `npm start`）

### Linux / macOS

```bash
# 安装 Node.js 18+ (如果没有)
# Ubuntu/Debian:
# curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
# sudo apt install -y nodejs

cd arc-agent
npm install
# 编辑 .env
npm start
```

## .env 配置说明

| 变量 | 说明 | 示例 |
|------|------|------|
| `SERVER_URL` | 服务器 WebSocket 地址 | `wss://arc.example.com/ws` |
| `AGENT_ID` | 代理名称（需唯一） | `office-pc` |
| `JWT_SECRET` | 认证密钥（跟服务器一致） | `arc-production-secret-2024` |
| `WORKSPACE_DIR` | 默认工作目录 | `D:\mIDE` 或 `/home/user/project` |

## 多台电脑部署

每台电脑复制一份此文件夹，修改 `.env` 中的 `AGENT_ID` 为不同名称：

```
电脑A: AGENT_ID=office-pc
电脑B: AGENT_ID=home-server
电脑C: AGENT_ID=dev-laptop
```

然后在手机浏览器打开控制页面，新建会话时选择对应的 Agent。

## 注意事项

- Windows 默认使用 `pwsh.exe`（PowerShell 7），如未安装请改为 `powershell.exe`
- 连接失败时检查：服务器地址、JWT_SECRET 是否一致、防火墙是否放行
- 支持 Windows / Linux / macOS