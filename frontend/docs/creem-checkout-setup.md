# Creem 支付与结账配置（避免 `productId is required`）

结账接口会调用 Creem `POST /v1/checkouts`，**必须**携带 Creem 侧的 **`product_id`**（即你在 Creem 控制台创建的 Product 的 ID）。若未配置映射，会报错 **`productId is required`**（或前端 toast 显示 `checkout failed: ...`）。

## 本仓库里 `product_id` 从哪来

1. 用户点击定价页购买时，前端请求 **`POST /api/payment/checkout`**，body 里带定价项的 **`product_id`**（来自 next-intl 文案，不是 Creem ID）。
2. 服务端在 [`src/app/api/payment/checkout/route.ts`](../src/app/api/payment/checkout/route.ts) 中解析 **`paymentProductId`**（发给 Creem 的真实 Product ID），顺序为：
   - 若选了非默认币种：该币种上的 **`payment_product_id`**
   - 否则定价项上的 **`payment_product_id`**
   - 否则：后台 **`creem_product_ids`** JSON 里，用定价 **`product_id`**（及可选 `_币种`）做键查找

当前 [`en/pages/pricing.json`](../src/config/locale/messages/en/pages/pricing.json) / `zh` 中各售卖项的 **`product_id`** 为：

| 套餐 | `product_id`（映射键） | 定价 JSON 中 `credits`（服务端发放） | Creem 计费周期（示例） |
|------|------------------------|--------------------------------------|-------------------------|
| 一次性 $5 / 500 积分 | `translate-credits-topup` | 500 | `once` |
| 月付 $5 / 550 积分/周期 | `translate-credits-monthly` | 550 | `every-month` |
| 季付 $13 / 1600 积分/周期 | `translate-credits-quarterly` | 1600 | `every-three-months` |
| 半年付 $25 / 3300 积分/周期 | `translate-credits-semiannual` | 3300 | `every-six-months` |
| 年付 $45 / 6500 积分/年 | `translate-credits-yearly` | 6500 | `every-year` |

这些条目**默认没有** `payment_product_id` 字段，因此**必须**在后台配置 **`creem_product_ids`**，或在定价 JSON 里为每项增加 **`payment_product_id`**。

## 积分发放以谁为准（安全）

- **发放多少积分**：以**服务端**为准。结账时 [`checkout/route.ts`](../src/app/api/payment/checkout/route.ts) 从定价 JSON 读取 **`credits`** 写入订单 **`creditsAmount`**；支付成功后 [`handleCheckoutSuccess`](../src/shared/services/payment.ts) 按 **`order.creditsAmount`** 入账，**不**从 Creem 回包里解析任意“积分数”字段作为唯一依据。
- **积分过期**：订阅类发放使用 Webhook 回包中的 **`current_period_end`** 作为该笔 grant 的 `expires_at`；一次性加购（无订阅周期）为 **永久有效**（`expires_at` 为空）。消耗顺序见 `credit` 表 FIFO 逻辑（优先消耗即将过期的额度）。
- **Creem 的职责**：证明用户完成支付、且对应哪个 **Product**（`payment_product_id`）；Webhook 经 **`creem_signing_secret`** 验签后与本地 **`order_no` / metadata** 关联订单。
- **每页消耗**：由环境变量 **`TRANSLATE_CREDITS_PER_PAGE`**（默认 10）控制，与 Creem 无关；见 [environment-variables.md §5.1](./environment-variables.md)。

不建议把“积分数”完全交给支付网关回包决定；若将来在 Creem 元数据里带自定义字段，也应在服务端用 **`product_id` → 允许发放量** 做校验，避免展示与入账不一致。

## 免费试用（策略 A：月付 `trial_subscription`）

1. **定价**：在 `pages/pricing.json` 的月付条目上设置 **`"trial_subscription": true`**（当前 `translate-credits-monthly` 已开启）。Creem 侧同一商品需开启 **Trial**（天数与 `TRIAL_CREDITS_DAYS` 一致，如 3 天）。
2. **环境变量**（`frontend/.env.example`）：**`TRIAL_CREDITS_AMOUNT`**（试用发放积分，默认 50）、**`TRIAL_CREDITS_DAYS`**（与产品试用天数对齐，供文档/快照；**试用积分过期时间以 Webhook 里订阅周期结束为准**）。
3. **结账订单**：带试用的订阅 **`order.credits_amount = 0`**，不在 `checkout.completed` 发放周期包；**`subscription_cycle_credits`** 写入 checkout **metadata**（及合并后的 `checkout_info`），供 `subscription` 表记录 **首期扣款后**应发的周期积分（如 550）。
4. **Webhook**：务必订阅 **`subscription.trialing`**。到达时 [`handleCreemTrialFlow`](../src/shared/services/payment.ts) 按 `TRIAL_CREDITS_AMOUNT` 发放一笔 **幂等** grant（`transaction_no = creem-trial:<subscription_id>`），并在缺少本地行时根据 **`order_no` / `user_id` metadata** 补写 `subscription` 行。其余 Creem 事件（如 `refund.created`、`subscription.expired` 等）映射为 **noop**，返回 200，避免 Creem 重试风暴。
5. **用户回站**：`checkout.completed` 且订阅为 **trialing** 时，[`mapCreemStatus`](../src/extensions/payment/creem.ts) 视为成功，便于 [`handleCheckoutSuccess`](../src/shared/services/payment.ts) 落库订阅（**不发**周期积分，因 `credits_amount` 为 0）。

## 订阅改权益与存量用户

- **新购/新订**：始终使用当前 **`en`/`zh` `pages/pricing.json`** 里的 **`credits`**。
- **已在库的订阅**：续费发积分使用表 **`subscription.creditsAmount`**（首次订阅成功时写入的快照）。若你调整套餐积分（例如月付 600→550），**老订阅续费仍按旧快照发积分**，直到你在数据库中更新对应订阅行的 `credits_amount`（或提供迁移脚本），或用户取消后重新订阅。
- **Creem 侧**：若涨价/改权益，请同时更新定价 JSON、并确认 Creem Product 价格与 **`amount`（美分）** 一致，避免用户看到的价格与扣款不一致。

## 配置步骤

### 1. Creem 控制台

1. 登录 [Creem](https://www.creem.io/)，环境与密钥一致（Sandbox / Production）。
2. 为每个售卖项创建 **Product**：
   - **一次性**：计费周期与定价里 `interval: "one-time"` 一致。
   - **订阅**：与 [`pricing.json`](../src/config/locale/messages/en/pages/pricing.json) 中 `interval` 一致：`month` / `quarter` / `six-months` / `year`；Creem 侧分别对应 `every-month`、`every-three-months`、`every-six-months`、`every-year`。
3. 复制每个 Product 的 **ID**（界面展示的 ID，常见形如 `prod_...`，以 Creem 实际为准）。

### 2. 站点后台（Admin → Settings → Payment）

| 项 | 说明 |
|----|------|
| **Creem Enabled** | 开启 |
| **Creem Environment** | `sandbox` 或 `production`，与 API Key 环境一致 |
| **Creem API Key** | 控制台 API Key（测试环境用测试 Key） |
| **Creem Signing Secret** | Webhook 验签用；与 Creem 里 Webhook 配置一致 |
| **Default Payment Provider** | 选 `Creem`，或确保仅 Creem 可用且结账能解析到 `creem`（服务端会回退到已启用的渠道） |
| **Creem Product IDs Mapping** | 见下文 JSON |

### 3. Creem Product IDs Mapping（`creem_product_ids`）

填写**合法 JSON**（注意引号、逗号、无注释）。**键**必须与定价里的 **`product_id` 完全一致**；**值**为 Creem Product ID。

示例（把 `prod_xxx` 换成你在 Creem 控制台复制的真实 ID）：

```json
{
  "translate-credits-topup": "prod_xxxxxxxx",
  "translate-credits-monthly": "prod_yyyyyyyy",
  "translate-credits-quarterly": "prod_qqqqqqqq",
  "translate-credits-semiannual": "prod_ssssssss",
  "translate-credits-yearly": "prod_zzzzzzzz"
}
```

**多币种**：若某币种在定价 `currencies` 里单独配置了金额，可用键 **`{product_id}_{currency}`**（小写），例如：

```json
{
  "translate-credits-topup": "prod_default_usd",
  "translate-credits-topup_cny": "prod_cny_pack"
}
```

逻辑见 `getPaymentProductId`（[`checkout/route.ts`](../src/app/api/payment/checkout/route.ts)）。

### 4. 替代：在定价 JSON 写死 Creem Product ID

在 **`en/pages/pricing.json`** 与 **`zh/pages/pricing.json`** 的对应 `items[]` 中增加字段 **`payment_product_id`**（与 Creem Product ID 一致）。服务端会优先使用该字段，**可不填**后台 `creem_product_ids`。

### 5. Webhook（订阅续费 / 事件）

- **URL**：`https://<你的线上域名>/api/payment/notify/creem`
- **Signing Secret**：与后台 **Creem Signing Secret** 一致，用于校验 `creem-signature` 头。

本地 `localhost` 无法被 Creem 服务器访问时，Webhook 需在部署域名上测试或使用隧道。

## 常见错误排查

| 现象 | 可能原因 |
|------|----------|
| `productId is required` | `paymentProductId` 全程为空：未配 `creem_product_ids`、JSON 非法、键名与定价 `product_id` 不一致、或定价里未写 `payment_product_id` |
| JSON 配了仍失败 | 键名错误（例如写成 `translate-credits-month` 少了 `ly`）；尾随逗号、中文引号导致 `JSON.parse` 失败（解析失败时映射为空） |
| `no payment provider configured` | 未启用 Creem / 未设置默认可用支付渠道（参见 checkout 对 `resolveCheckoutPaymentProviderName` 的逻辑） |
| Sandbox / Production 混用 | API Key 与环境选择不一致 |
| `request creem api failed with status: 403` | Creem 文档：**403 = API Key 无效或权限不足**。核对后台 **Creem API Key** 是否与 **Creem Environment**（Sandbox / Production）为同一套；从控制台 [Developers](https://creem.io/dashboard/developers) 重新复制 Key（避免首尾空格）；线上 DB 配置是否与本地一致 |

## 相关代码路径

- 结账：`src/app/api/payment/checkout/route.ts`
- Creem 客户端：`src/extensions/payment/creem.ts`
- 支付成功回跳：`src/app/api/payment/callback/route.ts`
- 积分发放：`src/shared/services/payment.ts` 中 `handleCheckoutSuccess`

## 翻译积分与页数（`TRANSLATE_CREDITS_ENABLED`）

开启积分后，整本翻译需要已知页数。数据库字段 **`documents.page_count`** 会在预览解析成功时写回；**`GET /api/documents/{id}`** 会返回 **`page_count`** 供前端在预览未就绪时做积分预检。详见 [environment-variables.md §5.1 / 5.2](./environment-variables.md)。
