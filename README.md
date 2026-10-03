# DSH AStudio Connect

[English](./README.en.md) | 中文

将 AStudio 桌面 App 包含的模型（GLM-5.2、DeepSeek-V4-Pro、DeepSeek-V4-Flash、Spark-X2.5、AstronClaw Auto 等）自动接入 DeepSeek Harness，在 DSH 对话窗口里零配置使用。

## 功能

- **开箱即用**：安装并启用插件后，AStudio 桌面 App 已登录账号包含的模型自动出现在 DSH 模型选择器中，无需额外配置。

- **自动跟随登录状态**：插件直接读取 AStudio 桌面 App 的本地会话文件，登录后模型分组自动出现，退出登录后分组自动消失。账号切换自动跟随，无需重启 DSH。

- **本地模型目录**：模型列表从 AStudio 桌面 App 本地磁盘上的网关目录读取，包含上下文窗口、推理档位（none/high/max）和促销徽章等完整元数据。无网络请求，即时可用。

- **推理档位**：模型声明的推理档位直接映射到 DSH 的推理等级选择器。例如 GLM-5.2 和 DeepSeek-V4 系列可选 none/high/max。

- **促销徽章**：模型名后直接显示促销信息（如「专享特惠」），以 AStudio 服务端数据为准。

- **零凭据存储**：插件不复制或存储任何凭据。每次模型调用时直接从桌面 App 的会话文件读取 bearer token，发送到 AStudio 模型网关。

## 安装

前置条件：已安装并登录 AStudio 桌面 App。插件复用 App 的登录状态，无需额外账号。

插件在三种 DSH 界面下均可运行：**Web**、**Desktop**、**TUI**。根据使用的 profile 选对应命令安装。

```sh
# Web（推荐）
dsh plugin --profile web add dsh-astudio-connect
dsh web

# 或从 GitHub 源码安装
dsh plugin --profile web add github:your-org/dsh-astudio-connect
dsh web
```

```sh
# Desktop（DSH Desktop 桌面版）
dsh plugin --profile desktop add dsh-astudio-connect
dsh --profile desktop
```

```sh
# TUI（终端界面）
dsh plugin --profile dsh-tui add dsh-astudio-connect
dsh --profile dsh-tui
```

安装后，在对应界面的模型选择器里切换到 **AStudio** 分组即可使用。

## 命令行

`dsh plugin --profile <web|desktop|dsh-tui> exec dsh-astudio-connect status`：查看登录状态与模型目录来源（`--json` 输出机器可读格式；另有 `doctor` 诊断、`logout` 报告）。

```sh
# 查看登录状态
dsh plugin --profile web exec dsh-astudio-connect status

# 诊断环境（数据根位置、会话文件、模型目录来源）
dsh plugin --profile web exec dsh-astudio-connect doctor --json
```

`logout` 仅报告桌面 App 登录状态不变（插件不存储凭据副本，无法也不需要清除）。

## 工作原理

插件通过以下步骤实现零配置接入：

1. **定位数据根**：从注册表（Windows）或默认安装路径定位 AStudio 数据根目录。
2. **读取会话文件**：从 `<数据根>/userdata/astron-session.json` 读取已登录账号的 bearer token。
3. **读取模型目录**：从 `<数据根>/userdata/model-gateway/catalog-<账号哈希>.json` 读取该账号可用模型列表。
4. **注册 Provider**：将模型列表注册为 DSH 的 `astudio` provider，通过 pi-ai 直接连接到 AStudio 模型网关（OpenAI Responses API）。
5. **轮询更新**：每 30 秒检查一次登录状态变化，自动跟随账号切换或退出登录。

## 已知限制

- 模型目录来源依赖 AStudio 桌面 App 本地文件，App 未运行时目录不会更新。
- 推理档位映射基于网关声明的词汇表（none/high/max），其他档位不可用。
- 凭据直接从桌面 App 会话文件读取，不经过加密保护（与桌面 App 自身的存储方式一致）。
- 依赖 AStudio 桌面 App 的本地文件格式，App 大版本更新后可能需要插件适配。

## 免责声明

- 本项目**仅供个人学习和研究使用**，仅驱动使用者自己的 AStudio 账号在本机调用，请勿用于商业用途或超出个人合理使用的场景。
- 使用者需遵守 AStudio 的服务条款；因使用本项目产生的任何后果（包括但不限于账号被限制、额度被清空、服务中断），由使用者自行承担。
- 本项目作者不对任何因使用或滥用本项目产生的直接或间接损失负责。
- 本项目与 AStudio、DeepSeek 均无关联，未获其授权或认可；文中出现的名称仅用于描述兼容关系，其商标权利归各自所有。

## 致谢

- [corrinehu/dsh-workbuddy-connect](https://github.com/corrinehu/dsh-workbuddy-connect)（MIT）— DSH 插件结构与 provider 注册的参照。

## 许可证

[MIT](./LICENSE)
