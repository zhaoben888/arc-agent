# ARC Agent - 远程终端代理

在任意电脑上运行此代理，即可通过手机/平板远程控制该电脑的终端。

## 两种模式

### 轻量模式（推荐新手）

根目录的 `index.js`，无需编译原生模块，开箱即用：

```
npm install && npm start
```

> 使用 child_process.spawn，终端无 PTY 支持（无颜色、无 vim 等交互程序）

### PTY 模式（完整体验）

`pty-agent/` 目录，需要 node-pty 原生模块编译：

```
cd pty-agent
npm install && npm start
```

> 使用 node-pty 创建真实伪终端，支持颜色、vim、交互式命令等

## 快速开始

### Windows

1. 安装 [Node.js 18+](https://nodejs.org)
2. 复制 `.env.example` 为 `.env`，修改配置
3. 双击 `install.bat` 安装依赖
4. 双击 `start.bat` 启动

### Linux / macOS

```bash
npm install
cp .env.example .env
# 编辑 .env
npm start
```

## .env 配置

| 变量 | 说明 | 示例 |
|------|------|------|
| `SERVER_URL` | 服务器 WebSocket 地址 | `wss://arc.example.com/ws` |
| `AGENT_ID` | 代理名称（每台电脑不同） | `office-pc` |
| `JWT_SECRET` | 认证密钥（跟服务器一致） | `arc-production-secret-2024` |
| `WORKSPACE_DIR` | 默认工作目录 | `.` 或 `/home/user/project` |

## 多台电脑部署

每台电脑复制一份，改不同的 `AGENT_ID`：

```
电脑A: AGENT_ID=office-pc
电脑B: AGENT_ID=home-server
电脑C: AGENT_ID=dev-laptop
```

## Linux PTY 模式额外依赖

```bash
# Ubuntu/Debian
sudo apt install build-essential python3

# CentOS/RHEL
sudo yum groupinstall "Development Tools"
```

## 注意事项

- Windows 默认使用 `pwsh.exe`（PowerShell 7），未安装会自动 fallback
- `JWT_SECRET` 必须跟服务器一致才能认证
- 连接失败时检查：服务器地址、密钥、防火墙