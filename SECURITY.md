# 安全说明（Security）

## 报告漏洞

本仓库是**个人开发的社区第三方客户端**（远程控制 DSH 的电脑插件）。安全相关漏洞请**私有**报告，勿公开披露细节：

- **首选**：GitHub 私有安全通告（Security → Advisories → New draft security advisory），或对该仓库开一个标记为敏感、不公开细节的 Issue。
- 若需邮件：请在 GitHub 资料中通过私有通告交流，避免把敏感细节写进公共渠道。

请包含：影响版本、复现步骤、预期行为 vs 实际行为、缓解建议。

## 本项目重点关注的安全面

- **配对与会话安全**（`dsh-remote-access`）：`pair/*` 豁免面收敛、配对码一次性/限次/过期、
  `verify` 常量时间比较、通道 token 的 /api 全量 Bearer 门禁、公网域名白名单（trustedHosts）校验。
- **端到端安全通道**：远程请求只在插件终结的 TLS 1.3 通道内被授权（内部标记 `SECURE_CHANNEL`，HTTP 头无法伪造）；
  明文远程请求返回 426。重点关注：标记能否被伪造、`/api/remote-access/secure` 的资源上限、证书生成与指纹计算。
- **远程访问边界**：仅向已配对设备签发 token；`pair/respond`、`pair/list`、`pair/revoke`、
  `pair/code/generate|current` 仅本机管理请求可达，手机设备 token 不授予管理权限。
