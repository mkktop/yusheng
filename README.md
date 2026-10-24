# yusheng — dsh 语音后端插件库

围绕 [dsh（DeepSeek Harness）](https://www.npmjs.com/package/@deepseek-ai/dsh) 生态开发的独立插件包集合。每个子目录一个自包含的 dsh 插件（bundle），不依赖 harness 源码构建链，可直接 `link:` 安装进 profile。

## 插件清单

| 插件 | 说明 |
|---|---|
| [`plugins/voice/`](plugins/voice/)（dsh-yusheng-voice） | 语音交互系统后端：WebSocket 语音协议（PCM 进/PCM 出），minimax asr-1.0 语音识别 + minimax t2a_v2 流式合成，对话直接驱动宿主 dsh 会话（复用 web 配置的模型与凭据）。设置面板挂载在 dsh 网页左侧边栏「全局面板」（「语声语音」按钮，位于「自动化任务」上方） |
| [`plugins/login-gate/`](plugins/login-gate/)（dsh-login-gate） | 远程访问登录门：`/login` 密码验证后转入官方 token→cookie 交换（自 MinuSense 项目迁入） |

## 安装到 dsh

```sh
dsh plugin --profile web add "link:<插件包的绝对路径>"
```

安装后重启 Harness（或依赖 HMR 自动重组），浏览器 Ctrl+F5。卸载用 `dsh plugin --profile web remove <包名>`。

## 打包注意

- 改动插件源码后运行包内 `npm run build` 重新产出 `lib/`；`link:` 安装的插件重启 Harness 后生效，浏览器侧资源改动需硬刷新。
- `package.json` 声明 `dsh.bundle.patch` 时，`exports` 需暴露 `./cordis.patch.yml`、`./locale/*.json`、`./icon`，否则插件页读不到元数据。
