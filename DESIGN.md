# dsh-plugin-stats — 设计文档（DESIGN）

> 取代 `dsh-plugin-tokspeed` 的通用 stats 插件。tokspeed 是它的子集。
> 本文档是需求与设计的唯一事实来源；改需求先改这里。

## 1. 目标

记录 DeepSeek Harness 全 Host 的模型使用统计并在 Web UI 面板展示：

| # | Collector | 事件来源 | 说明 |
|---|---|---|---|
| 1 | Throughput（吞吐） | `session/event` → `assistant/message` | 完整 replicate tokspeed：`tps`、`ttftMs`、`decodeMs`、measurability 规则（window < 250ms 或 rate > `maxPlausibleTps` 记 `unmeasurable`） |
| 2 | Verbosity（啰嗦度） | 同上 | replicate：`reasoningTokens` / `textChars` / `reasoningChars`、think%（无 reasoningTokens 时按字符估算并标注 `*`）、out/in |
| 3 | Token / Cost（token 与费用） | 同上 + pricing | 按 model/provider 累计 input/output/reasoning tokens；换算 USD（单价来源见 §4） |
| 4 | Tool calls（工具调用） | `tools/result`（emit，只读观察） | 每个工具调用次数 / 成功率 / 耗时（durationMs）/ 错误分类 |
| 5 | Sessions & activity（会话与活跃） | `session/event`（turn/step）、`session/created`、`session/disposed` | 会话数、turn/step 分布、每模型 busy 时长（Σ(ttft+decode)，近似值）、一天 24 小时活跃分布 |

不做兼容：包名 `dsh-plugin-stats`，路由 `/dsh-stats/*`，数据目录 `<dsh home>/stats/`，
全局注入 `window.__DSH_STATS__`。旧 tokspeed 归档，README 指向本仓。

## 2. Monorepo 布局（pnpm workspace）

```text
dsh-plugin-stats/
├── DESIGN.md                      # 本文件
├── packages/
│   ├── core/                      # @dsh-stats/core —— 纯逻辑，可被任何项目复用（无 DSH 依赖）
│   │   └── src/
│   │       ├── schemas.ts         # zod：Config / StepSample / ToolSample / SessionSample（discriminated union）
│   │       ├── sampling.ts        # streamWindow / streamTextShares / sampleOf / measurability
│   │       ├── aggregate.ts       # quantile/mean/std/summarize/verbosity/activity fold
│   │       ├── store.ts           # JSONL file store：append / rotate（75% hysteresis）/ sweep / 串行队列
│   │       ├── csv.ts             # CSV 投影
│   │       └── index.ts           # 公开 API
│   ├── pricing/                   # @dsh-stats/pricing —— 模型单价，可被任何项目复用（无 DSH 依赖）
│   │   └── src/
│   │       ├── schema.ts          # zod：PriceEntry / PricingSnapshot / CustomPricing
│   │       ├── lookup.ts          # 查价：custom > exact(id) > provider/model > unknown；返回 costSource
│   │       ├── cost.ts            # tokens → USD
│   │       ├── index.ts
│   │       └── data/pricing.json  # 构建期从 models.dev 压缩的快照（含 version/updatedAt）
│   └── plugin/                    # dsh-plugin-stats —— DSH bundle（唯一依赖 Harness 的包）
│       │   ├── src/host.ts        # Host half：apply(ctx, entryConfig)，路由 /dsh-stats/*
│       │   ├── src/client.ts      # Client panel（TS，React.createElement，手写最小 React 类型）
│       │   ├── cordis.patch.yml
│       │   └── scripts/           # dsh-stats CLI：recompute（重算 tps/cost）、export
├── .github/workflows/{ci,publish}.yml
└── references/ (gitignored)       # 本地参考：旧 tokspeed checkout
```

依赖方向：`plugin → core, pricing`；`core`、`pricing` 零 DSH 依赖，可独立发布给别的项目用。

## 3. 类型安全策略（零 `any`）

- `tsconfig`：`strict` + `noUncheckedIndexedAccess`。
- Harness 没有官方插件 TS 包（只有 `@deepseek-ai/schemastery`，是 zod 的 fork；
  本项目业务逻辑用标准 `zod` v4）。`ctx/session/event` 等边界类型在 `plugin/src/harness.ts`
  手写最小结构接口，**运行时一律用 zod 收窄**（`safeParse`，失败即丢弃并计数）。
- **Loader 互操作（实测结论，真机验证过）**：bundle export 的 `Config` 必须是真正的
  schemastery schema（可调用 function + 原型方法）。标准 zod schema 是普通对象，
  会导致 `resolveConfig` 阶段 activation 失败（先是 `expected object, received undefined`，
  手写 wrapper function 则缺 `.validate` 相关原型面而失败）。因此 `plugin/src/loader-config.ts`
  是 workspace 唯一的 schemastery import，与 core 的 zod `ConfigSchema` 字段一一镜像，
  由 `test/config-schema.test.ts` 锁一致；`apply` 入口立即用 zod 重 parse 回 canonical 类型。
- CI 强制：`tsc --noEmit` + `no-any` grep 门禁（`: any` / `as any` 零容忍，
  含 `.ts` 测试与 client）。
- `unknown` + 类型谓词是唯一允许的“动态”手段；`JSON.parse` 结果必须过 zod。

## 4. 定价（Cost）

- 主来源：**models.dev**（`https://models.dev/api.json`，$/Mtok：input/output/reasoning/cache_read/cache_write）。
  构建期脚本压缩为 `pricing.json` 快照随包发布（含 `source/version/updatedAt`）。
- 兜底链（agentsview 同款思路：LiteLLM 主 + OpenRouter 备 + 本地快照 + 自定义覆盖）：
  `config.customPricing`（最高优）> 快照 exact（大小写不敏感）> provider 限定匹配 > unknown。
- 查不到价：`costUsd: null` + `costSource: 'unknown'`，tokens 照记；summary 列出 unknownModels。
- 定价刷新：`pnpm -F @dsh-stats/pricing update` 重拉 models.dev；也支持 `pricingUrl` 自托管。
- 计费字段：`inputTokens/outputTokens/reasoningTokens`（cache* 若 usage 里有则另计，无则忽略并文档注明）。

## 5. 存储与路由

- 单文件 `samples.jsonl`，每行一个 zod discriminated union（`kind: step|tool|sessionJoin|sessionLeave`），
  坏行跳过并计数（读时 `safeParse`）。
- Retention：`maxFileBytes`（默认 5MB，超限从旧往新删到 75%）+ `maxAgeDays`（默认 30 天，`sweepIntervalMinutes` 周期清扫）。
  `sampleMinIntervalMs` 沿用（只限制 step 采样）。
- 只读路由（same-origin）：
  - `GET /dsh-stats/samples.jsonl`、`GET /dsh-stats/samples.csv`
  - `GET /dsh-stats/summary.json`（§6 的聚合 + retention + pricing 快照信息）
  - `GET/POST /dsh-stats/config`（沿用 tokspeed 三级优先级：schema 默认 < entry config < user config.json；`dataDir` 改动需 reload）
- 维护 CLI：`dsh-stats recompute [--dry-run]`（按当前规则重算 `tps`/`costUsd`，先备份），
  `dsh-stats export --format csv`。

## 6. summary.json / 面板视图

- `models[]`：每模型 `n · tokens{in,out,reasoning} · costUsd · tps{mean,median,q1,q3,min,max,p10,p90} · busyMs · verbosity{medOut,medThinkShare(+estimated),medOutIn}`。
- `tools[]`：每工具 `calls · ok · err · errRate · meanMs/p50Ms`。
- `activity`：`sessions · turns · steps · byHour[24]（step 计数）· oldest/newest`。
- `pricing`：`{source, version, updatedAt, unknownModels[]}`；`retention` 快照；`counts{measurable,unmeasurable}`。
- 面板（沿用 tokspeed 6 卡片 + 新增）：Overview（cost/tokens/busy 卡片）、Throughput（散点/直方图+正态/箱线/小时中位/统计表）、
  Costs（模型费用表 + 每日费用条）、Tools（调用表）、Activity（24 小时活跃 + 会话计数）、Verbosity。
  中英双语（`en`/`zh`沿用旧 key 命名习惯）。

## 7. 构建 / CI / 发布

- 构建：`tsdown`（host ESM + client IIFE-ish ESM + `cli` bin；`dts` 只给 core/pricing）。
  plugin 的 `files` 只含 `dist/{index,client}.js + cordis.patch.yml + LICENSE + README`。
- CI（`ci.yml`）：pnpm install → typecheck → no-any 门禁 → test（vitest，core/pricing 全覆盖 + host behavior test 复刻旧 14 断言+新增）→ build。
- 发布（`publish.yml`）：GitHub Release published / 手动触发 → npm Trusted Publishing（OIDC，无 token）
  + `NPM_CONFIG_PROVENANCE=true`（provenance 必备）。先发 `@dsh-stats/core`、`@dsh-stats/pricing`，再发 `dsh-plugin-stats`。
- 版本：0.1.0 起；旧 tokspeed 的 `0.1.4` 不延续（不同包名）。

## 8. 里程碑

- [x] M0 调研：旧插件 inventory、agentsview 定价、models.dev 可用性（226 providers / 8383 models）
- [ ] M1 骨架：workspace + core（schemas/sampling/aggregate/store/csv）+ vitest 全过
- [ ] M2 pricing：snapshot 脚本 + lookup/cost + 测试
- [ ] M3 plugin host：apply + collectors + routes + behavior test
- [ ] M4 plugin client：面板（11 卡片）+ 中英
- [ ] M5 CLI + CI/publish + README(EN+ZH) + 本地验证（`dsh bundle install` + 面板截图）
- [ ] M6 发布：建 `HuakunShen/dsh-plugin-stats` 公开仓并 push；旧 `dsh-plugin-tokspeed` archive + README 指向新仓
