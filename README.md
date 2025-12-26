# 头哥实验自动复制脚本（Playwright Study）

自动登录两个账号，同步实验进度，从已完成账号复制代码到未完成账号，并进行测评与结果统计

![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-green) ![Playwright](https://img.shields.io/badge/Playwright-%F0%9F%8E%AC-blue)

## 目录

- 项目背景
- 项目功能
- 技术栈
- 项目结构
- 快速开始
- 配置说明
- 核心功能说明
- 部署说明
- 常见问题
- Roadmap / TODO
- 贡献指南
- License

## 项目背景

- 在头哥平台进行课程实验时，往往一个账号已完成，另一个账号需要同步进度与代码。
- 本项目通过自动化脚本实现双账号协同，自动复制代码、提交测评、记录结果与生成总结报告。

## 项目功能

- 双账号登录与课程导航
- 精准定位未完成的实验并进入详情与关卡
- 从来源账号提取代码（Monaco/CodeMirror、剪贴板、DOM 兜底）
- 将代码写入目标账号并自动提交测评
- 失败关卡自动记录并继续下一关
- 选择题自动识别并填写
- 可配置的关卡间等待与控制台倒计时输出
- 运行结束自动生成“本次运行总结”报告
- 安全日志（用户名掩码）、敏感配置文件忽略与环境变量加载

## 技术栈

- Node.js（>= 18）
- Playwright（浏览器自动化）
- JavaScript（CommonJS）

## 项目结构

```
Playwright Study/
├─ autocopy/
│  ├─ browserInit.js           # 浏览器与上下文初始化
│  ├─ config.example.json      # 配置占位文件（不含敏感信息）
│  ├─ configManager.js         # 配置读取：优先环境变量/.env，其次本地config.json
│  ├─ dualAutoCopy.js          # 主入口：双账号自动复制流程
│  ├─ educoderAutoCopy.js      # 单账号自动复制（可选）
│  ├─ evaluation.js            # 测评提交、等待结果、进入下一关
│  ├─ labFinder.js             # 查找未完成实验
│  ├─ labInteraction.js        # 进入关卡、切换关卡、代码读取与写入、选择题处理
│  ├─ login.js                 # 登录流程（支持验证码提示）
│  ├─ navigation.js            # 课程导航与页面跳转
│  ├─ pageUtils.js             # 工具方法（安全点击、标识掩码等）
│  ├─ sessionReporter.js       # 运行状态与最终报告
│  └─ package.json
├─ package.json                # 根项目描述（开发依赖）
├─ package-lock.json
├─ playwright.config.js        # Playwright 配置
└─ .gitignore                  # 忽略敏感与环境文件
```

## 快速开始

0. 克隆项目，进入目录

```
git clone https://github.com/janfeise/EducoderAutoCopy.git
cd .\EducoderAutoCopy\
```

1. 安装依赖

```
npm i
```

2. 安装浏览器（建议）

```
npx playwright install
```

3. 配置文件

- 将 `autocopy/config.example.json` 复制为 `autocopy/config.json`，并填写你的账号、课程与超时配置
- 注意：`autocopy/config.json` 已在 `.gitignore` 中忽略，不会提交到仓库

4. 运行脚本

```
 node .\AutoCopy\dualAutoCopy.js
```

## 配置说明

- 复制 `autocopy/config.example.json` 为 `autocopy/config.json`（该文件已在 `.gitignore` 中忽略，不会提交）。
- 所有敏感信息（账号、密码）仅保存在你的本地 `autocopy/config.json`。
- 关键字段：
  - `educoder.username` / `educoder.password`：目标账号（未完成）
  - `educoder.completeUsername` / `educoder.completePassword`：来源账号（已完成）
  - `timeout.levelWait`：每关等待时间（毫秒），脚本在开始关卡前、切换下一关后均会输出倒计时

## 核心功能说明

- 登录与导航
  - 自动识别是否在登录页，支持从首页点击进入登录弹窗或直接访问登录页。
  - 检测验证码并友好提示手动处理。
  - 登录成功后跳转到课程页面并加载实验列表。
- 实验定位与关卡进入
  - 在目标账号中分析实验状态，选择第一个未完成实验。
  - 进入实验详情后尝试进入第 1 关并强制同步两账号关卡。
- 代码读取与写入
  - 优先通过编辑器 API 获取代码，其次剪贴板 Ctrl+A/C，再次 DOM 兜底。
  - 写入目标账号时优先 API，失败时使用剪贴板粘贴或逐字输入。
- 测评与下一关
  - 自动点击评测并等待结果。
  - 通过则进入下一关，失败则记录并尝试继续。
- 选择题支持
  - 识别已选答案并填写，多选/单选皆可。
- 运行报告
  - 使用 `sessionReporter` 记录实验状态，最后输出关卡统计与失败详情。
- 安全日志
  - 控制台输出对用户名进行掩码（手机号/邮箱/其他标识）。
- 可配置等待与倒计时
  - 在关卡开始前、切到下一关后，按照 `timeout.levelWait` 输出倒计时并等待。

## 部署说明

- 本地运行：Node.js >= 18，建议安装 Playwright 浏览器。
- CI（可选）：如使用 GitHub Actions，请通过 `secrets.*` 注入凭证与配置，严禁明文写入工作流或日志。
- 敏感文件：`autocopy/config.json` 与 `.gitignore` 已配置忽略，勿提交。

## 常见问题

- 登录超时或验证码：
  - 控制台会提示“检测到验证码”，请在浏览器中完成验证后脚本会继续。
- 找不到按钮或结构变化：
  - 项目对选择器进行了多策略匹配，仍失败时会输出调试信息，按提示修正。
- 等待时间太短或太长：
  - 调整 `autocopy/config.json` 中的 `timeout.levelWait`，脚本会显示倒计时。

## Roadmap / TODO

- 更细粒度的错误重试与恢复
- 更完善的选择题解析与答案来源
- 支持更多课程页面结构与平台版本
- 可视化运行报告与导出

## 贡献指南

- 请先通过 Issue 讨论变更点。
- 提交 PR 前请确保不提交任何敏感信息（账号、密码、token、私有链接）。
- 建议遵守现有代码风格与模块拆分。

## License

- MIT（除非课程平台条款另有限制，请合理合规使用本项目）
