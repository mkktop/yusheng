# yusheng — dsh 语音后端插件库

围绕 [dsh（DeepSeek Harness）](https://www.npmjs.com/package/@deepseek-ai/dsh) 生态开发的独立插件包集合。每个子目录一个自包含的 dsh 插件（bundle），不依赖 harness 源码构建链，可直接 `link:` 安装进 profile。

## 插件清单

| 插件 | 说明 |
|---|---|
| [`plugins/voice/`](plugins/voice/)（dsh-yusheng-voice） | 语音交互系统后端：WebSocket 语音协议（PCM 进/PCM 出），minimax asr-1.0 语音识别 + minimax t2a_v2 流式合成，对话直接驱动宿主 dsh 会话（每客户端独立配置模型、人设、长期记忆及会话，提供方凭据由 dsh 管理）。设置面板挂载在 dsh 网页左侧边栏「全局面板」（「语声语音」按钮，位于「自动化任务」上方） |
| [`plugins/login-gate/`](plugins/login-gate/)（dsh-login-gate） | 远程访问登录门：`/login` 密码验证后转入官方 token→cookie 交换（自 MinuSense 项目迁入） |

## 安装到 dsh

语音插件 0.2 支持兼容 v1 的 [WebSocket 协议 v2](plugins/voice/PROTOCOL.md)，包含轮次隔离、会话切换、工具活动、音频流标识和播放反馈。管理接口使用独立 `adminToken`，设备凭据只用于语音接入；迁移说明见插件 README。

0.3 增加 [形象与智能 UI](plugins/voice/INTERACTION.md)：状态、同步表情动作、卡片/选项/进度/表单，以及点击回传 agent；内置 `/demo` 参考客户端和浏览器 SDK。

0.4 增加「语声助手」专用 dsh 会话模式和可配置人设：名称、用户称呼、角色、性格、回答长度与表情动作风格。设置面板保存后下一轮生效，保留当前模式的对话上下文。

0.4.1 设置页自动复用 dsh 登录状态，无需再次填写管理令牌；无客户端在线时也可配置。独立外部管理接口继续使用单独的管理令牌。

0.5 增加每客户端独立的配置、模型、人设、长期记忆、会话与智能 UI；客户端离线也可配置。详见 [客户端数据架构](plugins/voice/README.md#05-每个客户端独立)。

```sh
dsh plugin --profile web add "link:<插件包的绝对路径>"
```

安装后重启 Harness（或依赖 HMR 自动重组），浏览器 Ctrl+F5。卸载用 `dsh plugin --profile web remove <包名>`。

## 打包注意

- 改动插件源码后运行包内 `npm run build` 重新产出 `lib/`；`link:` 安装的插件重启 Harness 后生效，浏览器侧资源改动需硬刷新。
- `package.json` 声明 `dsh.bundle.patch` 时，`exports` 需暴露 `./cordis.patch.yml`、`./locale/*.json`、`./icon`，否则插件页读不到元数据。
