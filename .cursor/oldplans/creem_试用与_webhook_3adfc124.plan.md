---
name: Creem 试用与 Webhook
overview: 已选定策略 A（Creem 试用期内不扣款 + 本地试用订单不写全额周期积分）；环境变量 TRIAL_CREDITS_AMOUNT / TRIAL_CREDITS_DAYS 已在本地与 Cloudflare 配置。实现时映射 subscription.trialing（并保留对 update/active 中 trialing 状态的兜底），仅在该路径发放试用积分；首期扣款后按订单发放正常周期积分。
todos:
  - id: env-read
    content: 代码读取 TRIAL_CREDITS_AMOUNT、TRIAL_CREDITS_DAYS（与 Creem 产品试用天数保持一致，当前为 3 天 / 50 积分）
    status: completed
  - id: checkout-trial-order
    content: 结账创建订单时：若产品/元数据标记为试用订阅，order.creditsAmount 写 0（或不触发周期积分），避免 checkout.completed 发 550
    status: completed
  - id: map-trialing
    content: creem.ts 映射 subscription.trialing（及必要时 no-op 未知事件避免重试风暴）；getPaymentEvent 构建含 TRIALING 的 PaymentSession
    status: completed
  - id: notify-trial-grant
    content: notify：subscription.trialing 时发放 env 指定试用积分，expires_at 用 payload 试用结束时间；按 creem subscription id 幂等
    status: completed
  - id: first-paid-grant
    content: 试用结束首扣：subscription.paid 等现有路径按 subscription 快照发放 550（与定价一致），与试用 grant 分离
    status: completed
  - id: docs-trial
    content: 更新 creem-checkout-setup.md：环境变量、策略 A、Creem 产品与 Webhook 勾选清单
    status: completed
isProject: false
---

# Creem 3 天试用 + 50 积分与 Webhook（策略 A + 环境变量）

## 已确定的配置（你方已完成）

- **环境变量**（本地 `[frontend/.env.development](frontend/.env.development)` 与 **Cloudflare** 均已配置，实现时统一读取）：
  - `TRIAL_CREDITS_AMOUNT=50` — 试用开始发放的积分数量。
  - `TRIAL_CREDITS_DAYS=3` — 与 Creem 产品上设置的**试用天数**保持一致（便于文档与校验；**过期时间以 Webhook payload 为准**，不以该变量推算为主）。
- **策略 A（已选定）**：
  - Creem 侧：订阅产品开启**免费试用**，试用期内**不收款**（首单有效扣款发生在试用结束后）。
  - 本地：对「带试用」的订阅，`checkout` 创建的订单 **不把全额周期积分**（如 550）写入 `order.creditsAmount`（或通过 **metadata / 产品维度** 标记 `trial: true`，服务端创建订单时 `creditsAmount=0`），避免 `checkout.completed` → `handleCheckoutSuccess` 误发周期包。
  - **试用 50 积分**：主要由 `**subscription.trialing`** Webhook 发放（见下文 Creem 勾选）；实现需 **幂等**（同一 Creem `subscription.id` 只发一次试用包）。

---

## Creem 控制台配置（详细步骤）

以下与 [Creem 文档：Free Trials](https://docs.creem.io/features/trials) 一致；界面文案以你当前后台为准，若有微调以实际为准。

### 1. 环境与密钥

1. 打开 [Creem Dashboard](https://creem.io/dashboard)（或文档中的 Products 入口）。
2. 确认右上角或设置中为 **Sandbox（测试）** 或 **Production（生产）**，与站点环境一致。
3. 进入 **Developers**（或 **API**）区域：
  - 复制 **API Key**，写入站点后台 / 环境变量（与现有 Creem 集成一致）。
  - 后续配置 Webhook 后复制 **Signing Secret**（Webhook 验签用，与 `[creem_signing_secret](frontend/docs/creem-checkout-setup.md)` 一致）。

### 2. 创建「带试用」的订阅商品（与月付 $5 等业务一致）

1. 进入 **Products** → **Create Product**（创建产品）。
2. 填写名称、描述（可与定价页 `product_name` 一致）。
3. 将计费类型设为 **订阅 / Recurring**（例如 **every-month**，与 `[pricing.json](frontend/src/config/locale/messages/en/pages/pricing.json)` 月付一致）。
4. 设置**正式价**（例如 **$5 / 月**）— 该价格在**试用结束后**首次扣款时使用。
5. **启用试用**（文档步骤）：
  - 找到 **Trial Period** / **Enable Trial Period** 类开关并**打开**。
  - **Days of Trial** 填 **3**（与 `TRIAL_CREDITS_DAYS=3` 一致）。
6. 保存产品，复制该产品在 Creem 侧的 **Product ID**（形如 `prod_...`），填入本站 **Admin → Creem Product IDs Mapping**（`creem_product_ids`）或定价 JSON 的 `payment_product_id`，键仍为本地 `product_id`（如 `translate-credits-monthly`）。

> 文档说明：试用期内不向客户收款；试用结束后订阅开始并扣款。这与策略 A 一致。

### 3. Webhook（支付通知）

1. 进入 **Developers → Webhooks** → **Create webhook**。
2. **Webhook Name**：自定（如 `translatepdf-sandbox`）。
3. **Webhook URL**（ShipAny 约定，与本项目一致）：
  - `https://{你的域名}/api/payment/notify/creem`
  - 测试环境填 Cloudflare 预览/测试域名；生产填正式域名；须 **HTTPS** 且公网可达。
4. **Event Types**：
  - **策略 A + 仅由 `subscription.trialing` 发试用积分**：务必勾选 `**subscription.trialing`**（若列表中有该项）。
  - 同时保留 ShipAny 已支持、业务仍依赖的事件，至少包括：
    - `checkout.completed`
    - `subscription.paid`
    - `subscription.update`
    - `subscription.active`
    - `subscription.paused`
    - `subscription.canceled`
  - 测试阶段可选 **Select All**，便于对照日志；上线后可收紧，但**不要去掉**会导致无法发试用或无法续费的事件。
5. **Save**，保存后复制该 Endpoint 的 **Signing Secret** 到本站后台 **Creem Signing Secret**。

### 4. 与本地 `order` / 结账的衔接（实现侧，执行计划时做）

- Checkout 时继续在 `metadata` 中传 `order_no`、`user_id`（与现网一致），以便 Webhook 关联用户。
- 对「本产品是带 3 天试用的月付」在服务端打标（推荐二选一或组合）：
  - **产品维度**：维护「带试用的 Creem Product ID」列表，命中则创建订单时 `creditsAmount=0`；
  - 或 **checkout 请求体 / metadata** 增加 `trial: true`（仅服务端可信字段），创建订单时 `creditsAmount=0`。
- `**subscription.trialing`** 到达时：读 `TRIAL_CREDITS_AMOUNT` 发放 grant，`expires_at` 使用 payload 中试用周期结束时间；幂等键 = Creem `subscription.id` + 场景 `trial`。

### 5. Sandbox 与 Production 各做一遍

- **Sandbox**：Sandbox API Key + Sandbox Webhook URL（指向测试站）+ Sandbox Product（同样开启 3 天试用）。
- **Production**：生产 Key + 生产 Webhook + 生产 Product；**不要混用** Signing Secret。

---

## 与 ShipAny 文档的关系

- Webhook URL 与 ShipAny 说明一致：`/api/payment/notify/creem`。
- ShipAny 列举的 6 类事件需保留；**策略 A 要求额外保证 `subscription.trialing` 被勾选且代码已映射**，否则会 throw 或永远不发 50 积分。

---

## 实现要点摘要（待执行）

1. 读取 `TRIAL_CREDITS_AMOUNT`、`TRIAL_CREDITS_DAYS`（校验日志与文档；发放数量以前者为准）。
2. `mapCreemEventType` 增加 `subscription.trialing`；`getPaymentEvent` 构建 `PaymentSession`（含 `subscriptionInfo.status === TRIALING`）。
3. `notify`：`subscription.trialing` → 发放试用积分 + 幂等；`checkout.completed` 对试用订单不因 `creditsAmount` 发周期积分。
4. 试用结束首次扣款：沿用 `subscription.paid` 等路径，按订阅/订单发放 **550**（或定价表当前值）。

---

## Sandbox 仍建议核对的两点

1. 试用开始后，`**subscription.trialing` 是否一定出现**；若 Creem 只发 `subscription.active` 且 `status=trialing`，则 notify 里需对 **SUBSCRIBE_UPDATED / 等价分支** 同样判断 `TRIALING` 并走同一套发放逻辑（与计划 overview 一致）。
2. `checkout.completed` 在试用开始时的 `order.status` / 金额；若仍为「未 paid」，则当前 `mapCreemStatus` 可能非 SUCCESS — 策略 A 下依赖 `**creditsAmount=0` + trialing 发积分**，不依赖该路径发试用包。

---

**说明**：策略 A 与试用 Webhook 已在仓库实现（`checkout`、`creem.ts`、`notify`、`payment.ts`、定价 `trial_subscription`、文档）。