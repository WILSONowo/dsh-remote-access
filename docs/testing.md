# 测试

默认测试使用合成设备、随机临时凭证和隔离临时目录；网络测试只启动本机回环服务并使用随机端口。
不会探测局域网设备、读取实际安装的用户数据或调用模型。测试里的域名、路径和地址是合成输入，不是部署配置。

```sh
npm ci --legacy-peer-deps
npm run build
npm test
```

## 可选 SDK 与后端联调

这些测试默认跳过，不自动查找本机安装。显式设置以下环境变量后运行 `npm test`：

- `DSH_TEST_RUNTIME`：独立准备的 DeepSeek Harness `0.2.1-rc.5` SDK 的 `node_modules/@deepseek-ai` 目录。只包含包，不包含用户配置、会话或凭据。
- `DSH_RELAY_BACKEND`：已运行 `npm ci` 和 `npm run build` 的 `dsh-remote-backend` 仓库绝对路径。
- `OPENSSL_BIN`：OpenSSL 可执行文件路径；不设置时使用 PATH 中的 `openssl`。TLS 测试现场生成一天有效的临时证书并在结束后清理。

SDK 测试使用实际协议类和合成业务服务；后端联调仅使用本机临时服务器。环境变量指向无效目录时测试失败。
发布前可同时启用两项，验证 HTTP、WebSocket、SSE、设备隔离、证书验证和断线重连。

远程请求在测试中一律经过真实的端到端安全通道（`test/secure-client.mjs`：WebSocket → 固定指纹的 TLS 1.3 → HTTP），并断言明文令牌被拒绝（426/401）。修改二维码格式或证书生成后，重新生成 `test/fixtures/pairing-compact.json`，并同步到 App 仓库的 `app/src/test/resources/`（另需同步 `secure-channel-vector.json`）。

实际部署或外部网络的测试必须单独显式配置目标和凭证，不能加入默认测试或提交真实数据。

## 插件设置页

中英文词条及语言切换测试随 `npm test` 运行；设置 `DSH_TEST_RUNTIME` 后会使用真实宿主的 LocaleRuntime。

使用同一个 SDK 路径可启动隔离的界面预览：

```sh
node scripts/preview-settings.mjs
```

该预览要求 SDK 中包含 `dsh-web-frontend`、`dsh-client-locale` 和 `dsh-client-ui-theme`，目前适配 `0.2.1-rc.5`。它复用宿主控件和主题，仅在回环地址监听，接口使用合成数据，不加载真实电脑配置或连接服务器。
检查中英文切换、深浅色、窄窗口、保存、二维码、配对确认、电脑和手机重命名、撤销和域名增删；预览工具栏只属于测试环境，不进入插件包。

## 连接开关与电源请求

默认测试使用合成配对、回环 HTTP/WebSocket/SSE 和模拟电源进程，覆盖总开关、凭证保留、待配对失效、活动时间持久化及电源进程清理。

Windows 可显式设置 `DSH_TEST_POWER=1` 后运行 `npm test`，短暂启动隐藏电源辅助进程验证系统 API 与退出清理。测试结束释放请求，不修改电源计划；未设置时跳过真实电源测试。

界面检查包括“添加”中的服务器/直连分支、六位码/电脑确认、总开关、最近连接时间、唤醒开关和可信域名管理。用预览中的 `Toggle missing settings` 模拟旧后台缺少接口，检查提示与开关禁用；再次切换并点击重试，检查设置恢复。

## 局域网发现

默认测试不发送局域网组播：插件使用模拟发布器验证临时发现会话、过期、关闭、锁定、独立凭证及管理权限。

真实网络验收必须先显式指定测试电脑、设备及局域网，再打开电脑配对页面进行。检查：单电脑及多电脑、IPv4/IPv6与多网卡、动态端口、两台设备分别配对及独立撤销、旧码或旧发现缓存、关闭配对窗口、权限拒绝、网络切换、后台返回和组播被阻止时的 IP/扫码退路。未完成真机验收不能将编译或单元测试视为自动发现成功。
