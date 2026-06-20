# EvoMap 技术架构草案与技术选型

> 版本：v0.1 草案  
> 日期：2026-06-19  
> 来源：基于 `/Users/zhangxiaojiang/Desktop/1.pages` 中的项目描述整理。当前仓库尚无业务代码，以下内容包含合理技术假设，后续需结合正式 PRD、合规要求、医院接口条件继续修订。

## 一句话定义

EvoMap 是面向临床研究/IIT 项目的研究管理平台，围绕患者建档、资料结构化、用药/访视计划、研究数据沉淀与合规审计，提供移动端优先、Web 管理后台配套的 SaaS 系统。

## 建设目标

1. 让 CRC/研究者可以快速为受试者建立电子档案，减少重复录入。
2. 通过 OCR + NLP/LLM 将身份证、知情同意书、病历、检查报告等材料转成可校验的结构化数据。
3. 根据方案规则自动生成患者访视、用药和提醒计划，并支持因实际情况动态调整。
4. 形成可追溯、可审计、可导出的研究数据底座，逐步对接 HIS/EDC/RAG 文献解读等能力。

## 用户与场景

### 主要用户

| 用户 | 主要诉求 | 关键任务 |
| --- | --- | --- |
| CRC/研究护士 | 快速建档、少录错、按时跟进患者 | 上传材料、确认字段、维护访视/用药状态 |
| 研究医生/PI | 了解入组、用药、访视和异常情况 | 审核患者资料、查看项目进展、处理偏差 |
| 项目管理员 | 管理项目、模板、权限、数据导出 | 配置项目方案、建档模板、访视规则、团队权限 |
| 数据管理员 | 保证数据质量和可追溯 | 数据质控、导出、审计、对接外部系统 |

### 主链路

```text
创建研究项目
  -> 配置患者建档模板和访视/用药规则
  -> CRC 上传患者材料
  -> OCR/NLP 抽取结构化信息
  -> 人工校验并提交患者档案
  -> 系统生成访视/用药日历
  -> 执行提醒、状态更新、异常处理
  -> 数据导出、审计追溯、项目统计
```

## 核心对象

| 对象 | 说明 |
| --- | --- |
| Tenant 租户 | SaaS 隔离单元，可以是医院、研究中心、SMO 或项目组织 |
| Study 研究项目 | 临床研究/IIT 项目，承载方案、团队、模板、患者和数据 |
| Site 研究中心 | 多中心项目中的医院/中心 |
| Subject 受试者/患者 | 平台的中心业务对象 |
| SubjectProfile 患者档案 | 患者基础信息、知情同意、入排标准、基线数据等 |
| Document 原始材料 | 身份证、知情同意书、病历、检查报告、PDF/JPG 等 |
| ExtractionResult 抽取结果 | OCR/NLP/LLM 输出的结构化字段、置信度和来源定位 |
| CRF/Form 表单 | 按模板定义的数据采集表单 |
| Visit 访视 | 方案定义或动态生成的访视节点 |
| MedicationPlan 用药计划 | 药物、剂量、周期、调整记录 |
| Task/Reminder 任务提醒 | 待确认、待随访、待审核、异常处理等工作项 |
| AuditLog 审计日志 | 人、时间、动作、前后值、原因、签名等可追溯记录 |

## 模块边界

### 1. 租户与权限模块

职责：

- 租户、组织、项目、中心、用户、角色管理。
- 支持 RBAC，后续可扩展到按项目/中心/患者维度的数据权限。
- 管理登录、会话、操作权限和审计身份。

边界：

- 不处理业务数据抽取和访视规则。
- 为所有业务模块提供统一身份和权限判断。

### 2. 患者建档模块

职责：

- 建档模板配置。
- 患者基础信息录入、编辑、校验。
- 材料上传、AI 抽取结果确认、人工补录。
- 患者状态维护：待筛选、已入组、随访中、已完成、已脱落等。

边界：

- 只负责患者档案形成和状态变化。
- 访视和用药计划由计划引擎生成。

### 3. 文档与 AI 抽取模块

职责：

- 管理上传文件和解析状态。
- 调用 OCR 服务识别图片/PDF 文本。
- 调用 NLP/LLM 将文本映射到 JSON Schema。
- 记录字段来源、置信度、模型版本、人工修订历史。

边界：

- AI 输出只作为候选结果，不直接覆盖已确认数据。
- 所有关键字段进入正式档案前必须经过用户确认或规则校验。

### 4. 表单与模板引擎

职责：

- 通过 JSON Schema 或类似结构定义患者档案、CRF、入排标准、基线数据字段。
- 支持字段类型、必填、校验规则、枚举、单位、字段权限。
- 支持同一研究项目内的模板版本管理。

边界：

- 负责“字段长什么样、如何校验”。
- 不负责 AI 抽取，也不负责计划排程。

### 5. 访视与用药计划引擎

职责：

- 根据项目方案配置访视窗口、用药周期、剂量规则和调整条件。
- 自动生成患者级访视/用药日历。
- 支持因患者未按计划来访、体重变化、异常事件等因素重新计算计划。
- 生成提醒任务和偏差提示。

边界：

- 规则引擎输出计划和变更建议。
- 具体执行状态由任务/随访模块维护。

### 6. 任务、提醒与工作流模块

职责：

- 生成待办事项：待确认抽取结果、待访视、待用药、待审核、待补资料。
- 触达提醒：站内通知、短信、企业微信/钉钉、邮件。
- 支持状态流转、负责人、截止时间、处理记录。

边界：

- 不重新计算医学规则，只消费计划引擎和业务事件。

### 7. 数据导出与外部系统集成

职责：

- Excel/CSV 导入导出。
- 后续对接 HIS、EDC、OHDSI-CDM、RAG 文献库等系统。
- 提供标准 API、Webhook、异步任务和集成日志。

边界：

- 外部系统适配器独立封装，避免污染核心业务模型。

### 8. 审计与合规模块

职责：

- 记录关键操作审计日志。
- 支持数据变更前后值、操作者、时间、原因、来源 IP。
- 为 GCP、EDC、21 CFR Part 11 等合规要求预留电子签名、锁库、数据冻结能力。

边界：

- 审计是平台级能力，业务模块只发出审计事件。

## 推荐技术选型

### 总体架构

建议第一阶段采用“模块化单体 + 异步任务队列”的架构，而不是一开始拆成大量微服务。

原因：

- 当前核心风险在业务建模、表单模板、AI 抽取闭环和计划规则，不在服务拆分。
- 临床研究规则变化多，模块化单体更容易快速调整。
- 保留清晰模块边界，后续可以把 AI 抽取、通知、外部集成拆成独立服务。

```text
移动端 / Web 管理后台
        |
API Gateway / BFF
        |
模块化业务后端
  |-- 租户权限
  |-- 患者建档
  |-- 表单模板
  |-- 文档抽取
  |-- 访视用药计划
  |-- 任务提醒
  |-- 审计合规
        |
PostgreSQL + Redis + 对象存储 + 队列
        |
OCR / LLM / HIS / EDC / 通知渠道
```

### 前端

| 场景 | 推荐选型 | 说明 |
| --- | --- | --- |
| Web 管理后台 | React + TypeScript + Vite | 生态成熟，适合复杂后台和表单系统 |
| UI 组件 | Ant Design / Arco Design | 偏企业后台，表格、表单、权限、弹窗能力完整 |
| 状态管理 | TanStack Query + Zustand | 服务端数据和局部交互状态分离 |
| 表单 | React Hook Form 或 Ant Design Form | 与动态 JSON Schema 表单结合 |
| 图表 | ECharts | 项目进展、入组、访视、用药统计 |
| 移动端 | Taro / React Native / Flutter 三选一 | 若需微信生态优先，选 Taro；若 App 优先，选 React Native 或 Flutter |

移动端建议：

- 第一阶段如果主要是上传材料、建档、随访确认，建议优先做微信小程序/H5，选 Taro。
- 如果已有原生 App 交付要求，再考虑 React Native 或 Flutter。

### 后端

| 场景 | 推荐选型 | 说明 |
| --- | --- | --- |
| 后端框架 | NestJS + TypeScript | 与前端同语言栈，适合模块化单体、权限、队列、OpenAPI |
| ORM | Prisma | 类型安全、迁移清晰，适合快速迭代 |
| API | REST + OpenAPI，关键复杂查询可补 GraphQL | 第一阶段 REST 更简单稳定 |
| 鉴权 | JWT + Refresh Token + RBAC | 后续扩展 SSO、LDAP、企业微信登录 |
| 异步任务 | BullMQ + Redis | OCR、LLM 抽取、导入导出、通知、集成同步 |
| 定时任务 | BullMQ Repeatable Jobs / Cron | 访视提醒、计划重算、过期任务 |
| 审计日志 | 数据库审计表 + 事件拦截器 | 每个关键命令统一记录 |

如果团队更熟 Java：

- 可替代为 Spring Boot + PostgreSQL + MyBatis/JPA + Redis + Flowable/Temporal。
- 但对早期全栈效率和动态表单协作而言，TypeScript 全栈更轻。

### 数据与存储

| 能力 | 推荐选型 | 说明 |
| --- | --- | --- |
| 主数据库 | PostgreSQL | 事务能力强，JSONB 适合动态表单和抽取结果 |
| 缓存/队列 | Redis | 会话、短期缓存、BullMQ 队列 |
| 对象存储 | S3 兼容存储 / 阿里云 OSS / 腾讯云 COS | 存身份证、病历、PDF、图片、导出文件 |
| 搜索 | PostgreSQL Full Text 起步，后续 Elasticsearch/OpenSearch | 第一阶段不必过早引入 ES |
| 向量检索 | pgvector 起步，后续 Milvus/Qdrant | 用于 RAG 文献/指南/项目资料检索 |
| 数据分析 | PostgreSQL 视图 + Metabase/Superset | 早期统计和运营报表 |

### AI 与文档处理

| 能力 | 推荐选型 | 说明 |
| --- | --- | --- |
| OCR | 腾讯云 OCR / 阿里云 OCR / 百度智能云 OCR | 国内证件、票据、病历识别支持较好 |
| PDF/图片预处理 | 后端任务服务 + Poppler/ImageMagick | PDF 转图、图片压缩、旋转纠正 |
| 结构化抽取 | LLM + JSON Schema 约束输出 | 把 OCR 文本映射到患者档案/CRF 字段 |
| 字段校验 | 规则校验 + 人工确认 | 身份证、日期、单位、范围、必填等 |
| RAG | pgvector + 文档切片 + 引用溯源 | 后续用于方案、文献、指南、报告解读 |

AI 结果必须保存：

- 原始文件 ID。
- OCR 原文。
- 抽取字段。
- 字段置信度。
- 字段来源位置。
- 模型供应商、模型版本、Prompt 版本。
- 人工确认/修改记录。

### 规则与工作流

第一阶段建议不要直接上重型 BPMN。

推荐：

- 访视/用药规则：自定义规则配置 + 后端规则解释器。
- 简单状态流转：显式状态机。
- 复杂审批或跨部门流程出现后，再引入 Temporal、Flowable 或 Camunda。

规则配置示例：

```json
{
  "visitCode": "V2",
  "baseEvent": "first_medication_date",
  "offsetDays": 14,
  "window": {
    "beforeDays": 3,
    "afterDays": 3
  },
  "tasks": ["lab_test", "medication_review", "ae_check"]
}
```

### 部署与运维

| 阶段 | 推荐方案 |
| --- | --- |
| 开发/测试 | Docker Compose：API、Web、PostgreSQL、Redis、MinIO |
| 生产初期 | 单区域云服务器或 Kubernetes，小规模可先用 Docker Compose/云托管 |
| 生产成熟 | Kubernetes + Helm + GitHub Actions/GitLab CI |
| 日志 | Pino/Winston + Loki 或云日志 |
| 监控 | Prometheus + Grafana 或云监控 |
| 错误追踪 | Sentry |
| 密钥管理 | 云 KMS / Vault / 环境变量托管 |

## 数据流

### 患者建档与 AI 抽取

```text
用户上传文件
  -> 对象存储保存原件
  -> Document 记录状态为 uploaded
  -> 队列触发 OCR 任务
  -> OCR 文本入库
  -> 队列触发结构化抽取任务
  -> LLM 按模板 JSON Schema 输出字段
  -> 系统执行字段校验
  -> 用户在界面确认/修订
  -> 写入 SubjectProfile / FormResponse
  -> 记录 AuditLog
```

### 访视与用药计划

```text
项目管理员配置方案规则
  -> 患者完成入组/基线日期确认
  -> 计划引擎生成患者级 Visit 和 MedicationPlan
  -> 任务模块生成提醒
  -> CRC 更新执行状态
  -> 若出现延期、体重变化、异常事件
  -> 计划引擎重算受影响节点
  -> 用户确认变更
  -> 审计日志记录前后计划
```

## 数据模型草案

```text
tenants
users
roles
permissions
studies
sites
study_members

subjects
subject_profiles
subject_status_histories

documents
ocr_results
extraction_jobs
extraction_results

form_templates
form_template_versions
form_responses
form_response_items

visit_templates
visit_instances
medication_rules
medication_plans
medication_events

tasks
notifications
imports
exports
integration_logs
audit_logs
```

关键设计建议：

- `form_templates` 保存模板元数据，`form_template_versions` 保存不可变版本。
- 动态表单答案可用 `JSONB` 保存，同时对常用筛选字段做冗余列或物化视图。
- 受试者状态变更必须有独立历史表，避免只看当前状态。
- AI 抽取结果不要直接写死到患者档案，先落在候选结果表。
- 审计日志独立追加写，不允许业务更新覆盖。

## API 分层

建议采用 BFF + 模块 API：

```text
/api/auth/*
/api/tenants/*
/api/studies/*
/api/subjects/*
/api/documents/*
/api/extractions/*
/api/forms/*
/api/visits/*
/api/medications/*
/api/tasks/*
/api/audit-logs/*
/api/imports/*
/api/exports/*
/api/integrations/*
```

移动端和 Web 后台可以共享后端服务，但 BFF 层可按端做聚合：

- 移动端关注“我的任务、上传、确认、随访执行”。
- Web 后台关注“配置、审核、统计、导入导出、权限和审计”。

## 最小可运行闭环

第一版 MVP 不建议一次性覆盖 HIS、EDC、完整 RAG 和复杂电子签名。建议先完成一个真实研究项目能跑通的闭环：

1. 创建租户、项目、用户和角色。
2. 配置患者建档模板。
3. 上传身份证/病历/知情同意书图片或 PDF。
4. OCR 识别并由 LLM 抽取字段。
5. 用户确认字段后形成患者档案。
6. 配置一个访视规则并生成患者访视计划。
7. 系统生成待办提醒，用户更新访视状态。
8. 导出患者档案和访视计划。
9. 全链路记录审计日志。

## 阶段计划

### Phase 0：项目骨架与基础设施

交付：

- Monorepo 或前后端仓库结构。
- Web 管理后台基础框架。
- NestJS API 服务。
- PostgreSQL、Redis、对象存储本地开发环境。
- 登录、租户、用户、角色、审计基础能力。

验收：

- 本地一条命令启动开发环境。
- 用户可登录并看到按权限过滤的项目列表。

### Phase 1：患者建档闭环

交付：

- 患者列表、患者详情、建档表单。
- 文件上传和对象存储。
- OCR 任务队列。
- AI 抽取候选字段。
- 人工确认和修订。
- Excel 导入/导出。

验收：

- CRC 能上传资料并在 1 个页面完成字段确认。
- 系统能追溯每个字段的来源和修改记录。

### Phase 2：访视与用药计划

交付：

- 访视模板配置。
- 用药规则配置。
- 患者级日历生成。
- 待办任务和提醒。
- 延期/体重变化等触发计划调整。

验收：

- 一个真实项目方案可以生成患者访视/用药日历。
- 用户能看到计划变更原因和审计记录。

### Phase 3：合规与集成增强

交付：

- 电子签名、数据冻结、锁库能力。
- HIS/EDC 接口适配。
- RAG 文献/方案解读。
- 更完整的数据质控和监控。

验收：

- 满足试点项目的数据追溯和审计要求。
- 外部系统同步失败可重试、可查询、可人工处理。

## 主要风险与应对

| 风险 | 表现 | 应对 |
| --- | --- | --- |
| AI 抽取不稳定 | 字段错填、漏填、无法解释 | 保留人工确认；字段置信度；来源定位；Prompt/模型版本追踪 |
| 动态表单失控 | 字段越来越多，查询和导出困难 | 模板版本化；核心字段结构化；答案 JSONB + 视图/索引 |
| 访视规则复杂 | 不同方案差异大，重算难 | 先做规则 DSL 和测试用例；复杂流程后续引入工作流引擎 |
| 合规后补成本高 | 审计、签名、锁库难补 | 从第一版就做追加式审计日志和数据版本 |
| HIS/EDC 对接不确定 | 各医院接口差异大 | 适配器模式；异步同步；集成日志；先支持文件导入导出 |
| SaaS 数据隔离 | 跨租户数据泄露 | 所有核心表带 tenant_id；后端统一租户过滤；自动化测试覆盖 |

## 推荐仓库结构

如果采用 TypeScript 全栈，建议使用 monorepo：

```text
evomap/
  apps/
    web-admin/
    mobile/
    api/
  packages/
    shared-types/
    form-schema/
    rules-engine/
    ui/
  infra/
    docker-compose.yml
    migrations/
  docs/
    technical-architecture-draft.md
```

## 当前建议结论

1. 架构路线：模块化单体优先，异步任务队列支撑 AI、导入导出和提醒。
2. 技术栈：React + TypeScript + NestJS + PostgreSQL + Redis + 对象存储。
3. 数据策略：核心业务结构化，动态表单用版本化模板 + JSONB，审计日志追加写。
4. AI 策略：OCR/LLM 只产出候选结构化结果，必须经过规则校验和人工确认。
5. MVP 边界：先跑通患者建档、AI 抽取、访视/用药计划、任务提醒、导出和审计。

