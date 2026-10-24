# dsh-login-gate — 远程访问登录门

dsh 官方 WebUI 的准入是「进程 launch token 换签名 cookie」：入口 URL 带进程级 token（只打印在服务器控制台，重启即换），首次访问换发绑定 Host 的 HMAC 签名 cookie（HttpOnly、SameSite=Strict，默认 30 天）。放在服务器上时，其他设备拿不到这条入口 URL，就无法访问。

本插件在 Web profile 里注册一个**无需认证的登录页**（默认 `/login`）：验证密码后把浏览器 303 重定向到 `connection.authenticatedUrl('/')`，由**官方 token→cookie 交换**发 cookie。不自建会话、不接触签名密钥、不修改官方任何行为；卸载插件后只剩官方 token 入口。

## 前提：服务器要先对局域网可达

dsh 默认只绑 `127.0.0.1`。0.2.0-rc.2 的两道限制：CLI `--host` 明确拒绝 `0.0.0.0`；而 webserver 的配置 schema 只接受 `127.0.0.1 | 0.0.0.0`（传具体 IP 会被 schema 拒绝）。可行做法是在 profile 用户层（`~/.dsh/profiles/web/cordis.patch.yml`）覆盖 webserver 行——**用户层 config 是整体替换，必须带上 bundle 行的其余字段**：

```yaml
- id: webserver
  name: "@deepseek-ai/dsh-host-webserver"
  config:
    # 对局域网开放；仅限内网使用，本插件不提供 TLS
    host: "0.0.0.0"
    port: 3080
    compression: gzip
    compressionLevel: 1
    compressionThresholdBytes: 1024
```

同时在启动命令加 `--trusted-host <当前 LAN IP>`（不带端口的条目匹配任意端口；否则远端 `/api` 请求被信任栅栏 403）。IP 会变的环境用启动脚本动态取当前 IP，参考 GM800 的 `/usr/local/bin/gm800-dsh-web.sh`。

## 配置

bundle 自带的挂载行无密码。密码在 profile 用户层 `~/.dsh/profiles/web/cordis.patch.yml` 配置（文件 0600，不入本仓库）：

```yaml
- id: login-gate
  name: dsh-login-gate
  config:
    password: "你的访问密码"
```

三种凭据方式（优先级从高到低）：

| 字段 | 说明 |
|---|---|
| `passwordHash` | `scrypt$<salt>$<hash>`（base64url），不想落明文时用 |
| `password` | 明文，直接写在 0600 的 profile patch 里 |
| `passwordEnv` | 环境变量名，启动时读取（配合 systemd `Environment=`） |

生成 hash：

```sh
node -e "const{scryptSync,randomBytes}=require('node:crypto');const s=randomBytes(16);console.log('scrypt$'+s.toString('base64url')+'$'+scryptSync(process.argv[1],s,32).toString('base64url'))" '你的密码'
```

全部缺省时插件生成 12 位临时密码并**打印一次告警日志**（journal 里可见），应尽快改配。其余可选字段：`username`（同时校验用户名，默认只输密码）、`loginPath`（默认 `/login`）、`maxAttempts`（默认 5）、`attemptWindowMinutes`（默认 10）、`lockoutMinutes`（默认 10）。按来源 IP 限流，超限锁定。

## 安装与使用

```sh
# 服务器上
dsh plugin --profile web add link:<本目录绝对路径>
# 写好密码配置后重启 Harness
```

- 其他设备浏览器打开 `http://<服务器>:3080/login` → 输密码 → 自动进入 WebUI（地址栏落在干净的 `/`）。
- 已持有效 cookie 的设备再开 `/login` 会直接跳回 `/`。
- 登出不做：签名 cookie 由官方层管理，默认 30 天过期。需要立即失效时重启 Harness（launch token 换新，但 cookie 密钥是持久的——重启**不**使已发 cookie 失效；要彻底踢出需改官方 `cookieMaxAgeDays` 配置层配置）。
- 直接访问 `/` 未登录时，官方返回 401 纯文本，这是官方行为；告诉使用者 bookmark `/login` 即可。

## 安全边界

- 密码用 scrypt 派生 + 恒时比较；按 IP 限流防爆破；登录响应 `cache-control: no-store`、重定向带 `referrer-policy: no-referrer`（Location 含进程 token，不应外泄 Referer）。
- 登录路由自身应用轻量栅栏：`Sec-Fetch-Site: cross-site` 一律拒、带 Origin 时必须与 Host 同源（防 DNS 重绑定的跨站表单投递）。
- 本插件**不提供 TLS**。跨不受信网络（如公网）暴露端口时，请在前面放 HTTPS 反代；局域网内使用则 http 直连。
- 只适用 web profile；桌面端（Electron/file://）无鉴权也用不上。

## 验证过的版本

- dsh 0.2.0-rc.2（GM800，ARM64）：登录换 cookie、已登录跳转、限流锁定、远端访问均验证通过。
