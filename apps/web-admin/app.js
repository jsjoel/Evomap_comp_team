const app = document.querySelector("#app");
const studyTitle = document.querySelector("#study-title");
const dialog = document.querySelector("#subject-dialog");
const detail = document.querySelector("#subject-detail");
const navItems = Array.from(document.querySelectorAll(".nav-item"));
const toast = document.querySelector("#toast");
const portalEyebrow = document.querySelector("#portal-eyebrow");

const state = {
  dashboard: null,
  subjects: [],
  documents: [],
  extractions: [],
  visits: [],
  medications: [],
  tasks: [],
  quality: null,
  doctorDashboard: null,
  familyHome: null,
  reminders: [],
  aiSuggestions: [],
  familyConversations: [],
  familyFeedback: [],
  evolutionEvents: [],
  evomapNode: null,
  portal: null,
  selectedDoctorSubjectId: null,
  doctorCreateMode: "upload",
  selectedFamilySubjectId: "SUBJ-001",
  activeFamilyCheckinDate: null,
  view: "dashboard"
};

async function getJson(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Request failed: ${path}`);
  }
  return response.json();
}

async function sendJson(path, method, body) {
  const response = await fetch(path, {
    method,
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${path}`);
  }

  return response.json();
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.setTimeout(() => toast.classList.remove("show"), 2600);
}

function runInteraction(trigger, action, busyLabel = "处理中...") {
  const button = trigger instanceof HTMLButtonElement ? trigger : null;
  const previousText = button?.textContent;
  if (button) {
    button.disabled = true;
    button.textContent = busyLabel;
  }
  Promise.resolve()
    .then(action)
    .catch((error) => {
      showToast(error instanceof Error ? error.message : "操作失败，请重试");
    })
    .finally(() => {
      if (button && button.isConnected) {
        button.disabled = false;
        button.textContent = previousText || "";
      }
    });
}

function runFormInteraction(form, action, busyLabel = "提交中...") {
  const submitButton = form.querySelector('button[type="submit"]');
  runInteraction(submitButton instanceof HTMLButtonElement ? submitButton : form, action, busyLabel);
}

function subjectName(subjectId) {
  return state.subjects.find((subject) => subject.id === subjectId)?.name ?? subjectId;
}

function riskClass(value) {
  if (value === "warning") return "warning";
  if (value === "attention") return "attention";
  return "normal";
}

function priorityClass(value) {
  return value === "high" ? "high" : "normal";
}

function renderMetric(label, value) {
  return `<article class="metric"><span>${label}</span><strong>${value}</strong></article>`;
}

function renderEmpty(text) {
  return `<p class="muted empty-state">${text}</p>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function reminderTypeLabel(type) {
  return {
    medication: "用药",
    visit: "复诊",
    rehab: "康复",
    family_followup: "家属随访"
  }[type] ?? type;
}

function suggestionStatusLabel(status) {
  return {
    candidate: "待确认",
    accepted: "已接受",
    dismissed: "已忽略",
    sent_to_family: "已发送家属",
    false_positive: "已标记误报"
  }[status] ?? status;
}

function doctorAiText(text) {
  return String(text || "")
    .replaceAll("进化后 AI", "AI")
    .replaceAll("进化后策略 v2：医生反馈强化组合风险", "历史医生处理偏好")
    .replaceAll("进化后策略 v2：医生反馈降低单一焦虑信号", "历史医生处理偏好")
    .replaceAll("进化后策略", "历史医生处理偏好");
}

const familyFeedbackTemplates = [
  {
    id: "hypertension",
    label: "高血压观察",
    hint: "记录血压、心率和头晕胸闷等变化",
    symptomPlaceholder: "描述头晕、胸闷、头痛、下肢水肿等变化",
    match: /高血压|血压|降压|收缩压|舒张压|心率|胸闷|头晕/,
    fields: [
      { name: "systolicBp", label: "收缩压", unit: "mmHg", type: "number", placeholder: "填写收缩压" },
      { name: "diastolicBp", label: "舒张压", unit: "mmHg", type: "number", placeholder: "填写舒张压" },
      { name: "heartRate", label: "心率", unit: "次/分", type: "number", placeholder: "填写心率" }
    ]
  },
  {
    id: "diabetes",
    label: "糖尿病观察",
    hint: "记录血糖、饮食和低血糖不适",
    symptomPlaceholder: "描述口渴、出汗、手抖、乏力、饮食变化等情况",
    match: /糖尿病|血糖|胰岛素|低血糖|餐后|空腹血糖/,
    fields: [
      { name: "fastingGlucose", label: "空腹血糖", unit: "mmol/L", type: "number", step: "0.1", placeholder: "填写空腹血糖" },
      { name: "postMealGlucose", label: "餐后血糖", unit: "mmol/L", type: "number", step: "0.1", placeholder: "填写餐后血糖" },
      { name: "dietStatus", label: "饮食情况", unit: "", type: "text", placeholder: "例如食欲、进食量、加餐情况" }
    ]
  },
  {
    id: "postoperative",
    label: "术后康复观察",
    hint: "记录伤口、体温、疼痛和活动耐受",
    symptomPlaceholder: "描述伤口红肿渗液、发热、疼痛、活动耐受等情况",
    match: /术后|出院|伤口|切口|引流|拆线/,
    fields: [
      { name: "woundStatus", label: "伤口情况", unit: "", type: "text", placeholder: "填写红肿、渗液或恢复情况" },
      { name: "temperatureC", label: "体温", unit: "℃", type: "number", step: "0.1", placeholder: "填写体温" },
      { name: "painScore", label: "疼痛评分", unit: "/10", type: "number", min: "0", max: "10", placeholder: "填写疼痛评分" }
    ]
  },
  {
    id: "oncology",
    label: "肿瘤治疗随访",
    hint: "记录体温、疼痛、食欲和治疗相关不适",
    symptomPlaceholder: "描述发热、腹泻、皮疹、持续疼痛、食欲变化等情况",
    match: /癌|肿瘤|化疗|放疗|免疫|靶向|ECOG|发热|腹泻|皮疹|持续疼痛/,
    fields: [
      { name: "temperatureC", label: "体温", unit: "℃", type: "number", step: "0.1", placeholder: "填写体温" },
      { name: "painScore", label: "疼痛评分", unit: "/10", type: "number", min: "0", max: "10", placeholder: "填写疼痛评分" },
      { name: "appetiteStatus", label: "食欲/饮食", unit: "", type: "text", placeholder: "填写食欲、进食量或腹泻情况" }
    ]
  },
  {
    id: "general",
    label: "通用康复观察",
    hint: "记录今天最主要的不适和活动耐受",
    symptomPlaceholder: "描述今天最明显的不适、活动耐受或需要医生知道的变化",
    match: /.*/,
    fields: [
      { name: "mainDiscomfort", label: "主要不适", unit: "", type: "text", placeholder: "填写主要不适" },
      { name: "activityTolerance", label: "活动耐受", unit: "", type: "text", placeholder: "填写活动后感受" }
    ]
  }
];

function familyFeedbackContext(home) {
  return [
    home?.subject?.diagnosis,
    home?.carePlan?.summary,
    home?.carePlan?.diet,
    home?.carePlan?.exercise,
    ...(home?.carePlan?.symptomWatch || []),
    ...(home?.doctorRehabAdvice || []).flatMap((item) => [item.title, item.advice, item.focus])
  ]
    .filter(Boolean)
    .join(" ");
}

function selectFamilyFeedbackTemplate(home) {
  const context = familyFeedbackContext(home);
  return familyFeedbackTemplates.find((template) => template.match.test(context)) || familyFeedbackTemplates.at(-1);
}

function renderFamilyFeedbackField(field) {
  const attrs = [
    `name="${escapeHtml(field.name)}"`,
    `type="${escapeHtml(field.type || "text")}"`,
    `placeholder="${escapeHtml(field.placeholder || field.label)}"`,
    `data-observation-field="true"`,
    `data-observation-label="${escapeHtml(field.label)}"`,
    `data-observation-unit="${escapeHtml(field.unit || "")}"`
  ];
  if (field.step) attrs.push(`step="${escapeHtml(field.step)}"`);
  if (field.min) attrs.push(`min="${escapeHtml(field.min)}"`);
  if (field.max) attrs.push(`max="${escapeHtml(field.max)}"`);

  return `
    <label class="feedback-field">
      <span>${escapeHtml(field.label)}${field.unit ? `<em>${escapeHtml(field.unit)}</em>` : ""}</span>
      <input ${attrs.join(" ")} />
    </label>
  `;
}

function feedbackObservationEntries(feedback) {
  const observations = Array.isArray(feedback?.observations)
    ? feedback.observations
        .map((item) => ({
          label: item.label || item.name || "观察项",
          value: item.value,
          unit: item.unit || ""
        }))
        .filter((item) => item.value !== "" && item.value != null)
    : [];

  if (observations.length) return observations;

  return [
    feedback?.temperatureC != null ? { label: "体温", value: feedback.temperatureC, unit: "℃" } : null,
    feedback?.painScore != null ? { label: "疼痛", value: feedback.painScore, unit: "/10" } : null
  ].filter(Boolean);
}

function feedbackMetricSummary(feedback) {
  const entries = feedbackObservationEntries(feedback);
  return entries.length ? entries.map((item) => `${item.label} ${item.value}${item.unit || ""}`).join(" / ") : "未填写结构化观察项";
}

function feedbackMetaMarkup(feedback) {
  const entries = feedbackObservationEntries(feedback).slice(0, 4);
  return `
    <span>${feedback.symptoms}</span>
    ${feedback.feedbackTemplateLabel ? `<span>${feedback.feedbackTemplateLabel}</span>` : ""}
    ${entries.map((item) => `<span>${item.label} ${item.value}${item.unit || ""}</span>`).join("")}
    <span>${feedback.medicationTaken ? "已用药" : "未确认用药"}</span>
  `;
}

function riskLevelClass(value) {
  if (value === "high" || value === "medium") return "warning";
  if (value === "low") return "normal";
  return "attention";
}

function renderSubjectsTable(subjects) {
  return `
    <table class="table">
      <thead>
        <tr>
          <th>编号</th>
          <th>姓名</th>
          <th>中心</th>
          <th>状态</th>
          <th>下次访视</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        ${subjects
          .map(
            (subject) => `
              <tr>
                <td>${subject.code}</td>
                <td>${subject.name}</td>
                <td>${subject.site}</td>
                <td><span class="status ${riskClass(subject.risk)}">${subject.status}</span></td>
                <td>${subject.nextVisitDate ?? "未生成"}</td>
                <td><button class="small-button" data-subject="${subject.id}">查看</button></td>
              </tr>
            `
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function renderEntry() {
  document.body.classList.add("entry-mode");
  document.body.classList.remove("family-mode");
  document.body.classList.remove("doctor-flow-mode");
  studyTitle.textContent = "ComfortHelper医疗康复助手";
  app.innerHTML = `
    <section class="entry-page">
      <div class="entry-brand">
        <span class="brand-mark">+</span>
        <div>
          <p class="eyebrow">ComfortHelper</p>
          <h1>医疗康复助手</h1>
        </div>
      </div>

      <div class="entry-grid">
        <article class="entry-card">
          <div>
            <span class="entry-label">医生管理者</span>
            <h2>医生管理端</h2>
            <p class="muted">先看患者卡片，进入患者后再处理 AI 建议、随访提醒和家属反馈。</p>
          </div>
          <div class="entry-metrics">
            <span>${state.subjects.length} 名患者</span>
            <span>${state.reminders.filter((item) => item.status === "open").length} 项提醒</span>
          </div>
          <button class="primary-button entry-button" data-entry-portal="doctor">进入医生管理端</button>
        </article>

        <article class="entry-card family-entry">
          <div>
            <span class="entry-label">病人家属</span>
            <h2>家属端 H5</h2>
            <p class="muted">每天完成打卡，有问题先问一句，异常情况再反馈给医生。</p>
          </div>
          <div class="entry-metrics">
            <span>${state.familyHome?.reminders?.filter((item) => item.status === "open").length ?? 0} 项今日事项</span>
            <span>${state.familyHome?.carePlan ? "已有康复计划" : "待生成计划"}</span>
          </div>
          <button class="primary-button entry-button" data-entry-portal="family">进入家属端</button>
        </article>
      </div>
    </section>
  `;
}

function enterPortal(portal) {
  state.portal = portal;
  state.selectedDoctorSubjectId = null;
  state.view = portal === "doctor" ? "doctor-flow" : "family-flow";
  render();
}

function renderDashboard() {
  const { study, metrics, recentTasks, auditLogs } = state.dashboard;
  studyTitle.textContent = study.title;
  app.innerHTML = `
    <section class="grid metrics">
      ${renderMetric("受试者", metrics.subjectsTotal)}
      ${renderMetric("筛选中", metrics.screening)}
      ${renderMetric("已入组", metrics.enrolled)}
      ${renderMetric("随访中", metrics.followUp)}
      ${renderMetric("开放任务", metrics.openTasks)}
      ${renderMetric("待复核文件", metrics.documentsPendingReview)}
      ${renderMetric("开放提醒", metrics.openReminders ?? 0)}
    </section>

    <section class="grid layout-2" style="margin-top: 18px;">
      <div class="panel">
        <div class="panel-header">
          <div>
            <h2>${study.code}</h2>
            <p class="muted">${study.phase} · ${study.sites} 个中心 · 目标入组 ${study.targetEnrollment} 例</p>
          </div>
          <div class="button-row">
            <span class="status normal">${study.status}</span>
            <a class="small-button link-button" href="/api/exports/subjects.csv" download="comforthelper-subjects.csv">导出CSV</a>
          </div>
        </div>
        ${renderSubjectsTable(state.subjects)}
      </div>

      <div class="stack">
        <div class="panel">
          <div class="panel-header">
            <h2>近期任务</h2>
            <span class="muted">${recentTasks.length} 项</span>
          </div>
          <div class="stack">
            ${recentTasks
              .map(
                (task) => `
                  <article class="item-card">
                    <p><strong>${task.title}</strong></p>
                    <div class="item-meta">
                      <span>${subjectName(task.subjectId)}</span>
                      <span>${task.owner}</span>
                      <span>${task.dueDate}</span>
                      <span class="priority ${priorityClass(task.priority)}">${task.priority}</span>
                    </div>
                  </article>
                `
              )
              .join("")}
          </div>
        </div>

        <div class="panel">
          <div class="panel-header">
            <h2>审计动态</h2>
          </div>
          <div class="stack">
            ${auditLogs
              .map(
                (log) => `
                  <article class="item-card">
                    <p><strong>${log.action}</strong></p>
                    <div class="item-meta">
                      <span>${log.actor}</span>
                      <span>${log.target}</span>
                      <span>${new Date(log.createdAt).toLocaleString("zh-CN")}</span>
                    </div>
                  </article>
                `
              )
              .join("")}
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderSubjects() {
  app.innerHTML = `
    <section class="panel">
      <div class="panel-header">
        <div>
          <h2>患者建档</h2>
          <p class="muted">可新增或批量导入测试受试者，并自动生成文档、AI抽取、筛选访视和任务</p>
        </div>
        <div class="button-row">
          <button class="ghost-button" data-action="import-subjects">批量导入测试患者</button>
          <button class="primary-button" data-action="quick-subject">一键生成测试患者</button>
        </div>
      </div>
      <form id="subject-form" class="inline-form">
        <div class="form-field">
          <label for="subject-name">姓名</label>
          <input id="subject-name" name="name" value="钱晓梅" />
        </div>
        <div class="form-field">
          <label for="subject-sex">性别</label>
          <select id="subject-sex" name="sex">
            <option>女</option>
            <option>男</option>
          </select>
        </div>
        <div class="form-field">
          <label for="subject-age">年龄</label>
          <input id="subject-age" name="age" type="number" value="55" min="18" max="90" />
        </div>
        <div class="form-field">
          <label for="subject-site">中心</label>
          <select id="subject-site" name="site">
            <option>上海第一中心</option>
            <option>苏州第二中心</option>
            <option>杭州第三中心</option>
          </select>
        </div>
        <div class="form-field">
          <label for="subject-diagnosis">诊断</label>
          <input id="subject-diagnosis" name="diagnosis" value="肺腺癌" />
        </div>
        <button class="primary-button" type="submit">新建并抽取</button>
      </form>
      ${renderSubjectsTable(state.subjects)}
    </section>
  `;
}

function renderAiReview() {
  app.innerHTML = `
    <section class="panel">
      <div class="panel-header">
        <div>
          <h2>AI 抽取复核</h2>
          <p class="muted">候选字段必须人工确认后才进入正式患者档案</p>
        </div>
      </div>
      <div class="stack">
        ${state.extractions
          .map(
            (extraction) => `
              <article class="item-card">
                <div class="panel-header">
                  <div>
                    <h3>${subjectName(extraction.subjectId)} · ${extraction.documentId}</h3>
                    <p class="muted">整体置信度 ${(extraction.confidence * 100).toFixed(0)}% · ${extraction.status}</p>
                  </div>
                  ${
                    extraction.status === "confirmed"
                      ? '<span class="status normal">已入档</span>'
                      : `<button class="small-button" data-confirm-extraction="${extraction.id}">确认入档</button>`
                  }
                </div>
                <div class="field-list">
                  ${extraction.fields
                    .map(
                      (field) => `
                        <div class="field-row">
                          <strong>${field.name}</strong>
                          <div>
                            <div>${field.value}</div>
                            <span>${field.source}</span>
                          </div>
                          <div>
                            <span>${(field.confidence * 100).toFixed(0)}%</span>
                            <div class="progress"><i style="width: ${field.confidence * 100}%"></i></div>
                          </div>
                        </div>
                      `
                    )
                    .join("")}
                </div>
              </article>
            `
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderLearningStatus() {
  const latest = state.evolutionEvents[0];
  const node = state.doctorDashboard?.evomapNode || state.evomapNode || {};
  return `
    <div class="panel learning-panel">
      <div class="panel-header">
        <h2>系统学习</h2>
        <span class="status normal">本地脱敏</span>
      </div>
      <div class="compact-list">
        <div><span>记录</span><strong>${state.evolutionEvents.length} 条改进</strong></div>
        <div><span>同步</span><strong>${node.hasSecret ? "待授权" : "未配置"}</strong></div>
        <div><span>最近</span><strong>${latest?.summary || "暂无学习记录"}</strong></div>
      </div>
    </div>
  `;
}

function renderDoctorFlow() {
  const dashboard = state.doctorDashboard;
  if (state.selectedDoctorSubjectId === "new") {
    renderDoctorCreatePatient();
    return;
  }

  const selectedSubject = state.selectedDoctorSubjectId
    ? state.subjects.find((subject) => subject.id === state.selectedDoctorSubjectId)
    : null;

  if (selectedSubject) {
    renderDoctorSubjectDetail(selectedSubject);
    return;
  }

  const patientCards = state.subjects.map((subject) => {
    const suggestion = dashboard.suggestions.find((item) => item.subjectId === subject.id && item.status === "candidate");
    const feedback = dashboard.pendingFeedback.find((item) => item.subjectId === subject.id);
    const reminder = dashboard.openReminders.find((item) => item.subjectId === subject.id);
    const reason = suggestion?.title || feedback?.symptoms || reminder?.title || "暂无待处理事项";
    const tags = [
      suggestion ? "AI建议" : null,
      feedback ? "家属反馈" : null,
      reminder ? "提醒" : null,
      subject.risk === "warning" ? "需关注" : null
    ].filter(Boolean);
    const priority = suggestion || feedback || reminder || subject.risk === "warning";
    const stateLabel = priority ? "待处理" : "稳定";
    return { subject, reason, tags, priority, stateLabel };
  });

  studyTitle.textContent = "医生患者卡片";
  app.innerHTML = `
    <section class="doctor-card-board">
      <div class="doctor-board-head">
        <div>
          <p class="eyebrow">医生管理端</p>
          <h2>患者卡片</h2>
          <p class="muted">先选患者，再查看具体建议和处理动作</p>
        </div>
        <div class="button-row">
          <button class="primary-button" data-action="add-doctor-patient">添加患者</button>
          <button class="small-button" data-action="run-doctor-analyze">重新分析</button>
        </div>
      </div>

      <div class="patient-card-grid">
        ${patientCards
          .map(
            ({ subject, reason, tags, priority, stateLabel }) => `
              <article class="patient-list-card ${priority ? "needs-action" : ""}" data-doctor-subject="${subject.id}">
                <div class="patient-card-top">
                  <span class="step-label">${subject.code}</span>
                  <span class="patient-card-state ${priority ? "warn" : ""}">${stateLabel}</span>
                </div>
                <div class="patient-card-main">
                  <h3>${subject.name}</h3>
                  <p>${reason}</p>
                </div>
                <div class="doctor-card-meta">
                  <span>${subject.status}</span>
                  ${tags.length ? tags.map((tag) => `<span>${tag}</span>`).join("") : "<span>稳定</span>"}
                </div>
                <button class="small-button" data-doctor-subject="${subject.id}">查看</button>
              </article>
            `
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderDoctorCreatePatient() {
  studyTitle.textContent = "添加患者";
  const isUpload = state.doctorCreateMode === "upload";
  app.innerHTML = `
    <section class="doctor-card-board">
      <div class="doctor-board-head">
        <div>
          <p class="eyebrow">添加患者</p>
          <h2>${isUpload ? "上传病例图片解析" : "手动填写患者信息"}</h2>
          <p class="muted">建档后会自动生成患者卡片、AI抽取候选、筛选访视和家属提醒。</p>
        </div>
        <button class="small-button" data-action="back-doctor-cards">返回患者卡片</button>
      </div>

      <div class="create-mode-row">
        <button class="mode-card ${isUpload ? "active" : ""}" data-create-mode="upload">
          <strong>病例图片上传</strong>
          <span>适合已有门诊病历、检查报告照片</span>
        </button>
        <button class="mode-card ${!isUpload ? "active" : ""}" data-create-mode="manual">
          <strong>手动填入</strong>
          <span>适合现场快速登记</span>
        </button>
      </div>

      <form id="doctor-create-patient-form" class="create-patient-card">
        ${
          isUpload
            ? `<label class="upload-drop">
                <input id="case-image-input" name="caseImage" type="file" accept="image/*,.pdf" />
                <strong>选择病例图片或 PDF</strong>
                <span id="case-file-name">上传后会模拟解析姓名、诊断、材料类型</span>
              </label>`
            : ""
        }

        <div class="create-form-grid">
          <div class="form-field">
            <label for="create-name">姓名</label>
            <input id="create-name" name="name" value="${isUpload ? "解析患者" : "钱晓梅"}" />
          </div>
          <div class="form-field">
            <label for="create-sex">性别</label>
            <select id="create-sex" name="sex">
              <option>女</option>
              <option>男</option>
            </select>
          </div>
          <div class="form-field">
            <label for="create-age">年龄</label>
            <input id="create-age" name="age" type="number" min="18" max="95" value="${isUpload ? "58" : "55"}" />
          </div>
          <div class="form-field">
            <label for="create-site">中心</label>
            <select id="create-site" name="site">
              <option>上海第一中心</option>
              <option>苏州第二中心</option>
              <option>杭州第三中心</option>
            </select>
          </div>
          <div class="form-field">
            <label for="create-diagnosis">诊断/主要问题</label>
            <input id="create-diagnosis" name="diagnosis" value="${isUpload ? "待解析诊断" : "肺腺癌"}" />
          </div>
          <div class="form-field">
            <label for="create-document-type">材料类型</label>
            <select id="create-document-type" name="documentType">
              <option>门诊病历</option>
              <option>检查报告</option>
              <option>出院小结</option>
              <option>知情同意书</option>
            </select>
          </div>
          <div class="form-field">
            <label for="create-next-visit">下次随访</label>
            <input id="create-next-visit" name="nextVisitDate" type="date" value="2026-06-25" />
          </div>
        </div>

        <input id="create-file-name" name="fileName" type="hidden" value="${isUpload ? "case_image_upload.jpg" : "manual_entry.pdf"}" />

        <div class="parsed-preview">
          <span>建档后生成</span>
          <strong>患者卡片、AI候选字段、筛选访视、家属提醒</strong>
        </div>

        <button class="primary-button" type="submit">${isUpload ? "确认解析并建档" : "保存患者"}</button>
      </form>
    </section>
  `;
}

function renderDoctorSubjectDetail(subject) {
  const dashboard = state.doctorDashboard;
  const candidate = dashboard.suggestions.find((item) => item.subjectId === subject.id && item.status === "candidate");
  const feedback = dashboard.pendingFeedback.find((item) => item.subjectId === subject.id);
  const reminder = dashboard.openReminders.find((item) => item.subjectId === subject.id);
  const subjectSuggestions = dashboard.suggestions.filter((item) => item.subjectId === subject.id).slice(0, 3);
  const currentSuggestion = candidate || subjectSuggestions[0] || null;
  const actionableSuggestion = currentSuggestion?.status === "candidate" ? currentSuggestion : null;
  const subjectFeedback = dashboard.pendingFeedback.filter((item) => item.subjectId === subject.id).slice(0, 3);
  const subjectReminders = dashboard.openReminders.filter((item) => item.subjectId === subject.id).slice(0, 3);
  const treatmentRecords = state.visits.filter((item) => item.subjectId === subject.id);
  const medicationRecords = state.medications.filter((item) => item.subjectId === subject.id);
  const issueTitle = currentSuggestion?.title || feedback?.symptoms || reminder?.title || "暂无待处理事项";
  const issueDetail =
    doctorAiText(currentSuggestion?.summary) ||
    (feedback ? `家属反馈：${feedback.symptoms}；${feedbackMetricSummary(feedback)}` : "") ||
    (reminder ? `${reminderTypeLabel(reminder.type)}提醒，截止 ${reminder.dueAt}` : "当前患者暂无需要立即处理的事项。");
  const evidence = currentSuggestion?.evidence || (reminder ? [reminderTypeLabel(reminder.type), reminder.dueAt] : []);
  const evidenceItems =
    currentSuggestion?.evidenceItems ||
    evidence.map((item) => ({
      label: "依据",
      value: item
    }));
  const riskLabel = currentSuggestion?.riskLevel === "medium" ? "中等关注" : subject.risk === "warning" ? "需关注" : "低风险";
  const nextAction = currentSuggestion?.recommendedAction || (actionableSuggestion ? "确认这条建议后，再决定是否同步给家属" : reminder ? "处理未完成提醒，必要时重新分析" : "保持随访观察");
  const actionTitle = actionableSuggestion ? "建议医生处理" : reminder ? "建议处理提醒" : "当前建议";
  const currentStatusLabel = currentSuggestion ? suggestionStatusLabel(currentSuggestion.status) : "无需立即处理";
  const confidenceLabel = currentSuggestion?.confidence ? `${Math.round(currentSuggestion.confidence * 100)}%` : "模拟判断";
  const strategySource = doctorAiText(currentSuggestion?.strategySource || "本地默认策略");
  const focusMeta = [
    `${subject.sex} · ${subject.age}岁`,
    subject.site,
    `下次访视 ${subject.nextVisitDate ?? "未生成"}`,
    riskLabel
  ];

  studyTitle.textContent = `${subject.name} · 患者详情`;
  app.innerHTML = `
    <section class="doctor-card-board">
      <div class="doctor-board-head">
        <div>
          <p class="eyebrow">患者详情</p>
          <h2>${subject.name}</h2>
          <p class="muted">${subject.code} · ${subject.status} · 下次访视 ${subject.nextVisitDate ?? "未生成"}</p>
        </div>
        <button class="small-button" data-action="back-doctor-cards">返回患者卡片</button>
      </div>

      <div class="doctor-detail-layout">
        <section class="patient-brief-card">
          <div>
            <span class="step-label">患者概况</span>
            <h3>${subject.name}</h3>
            <p>${subject.code} · ${subject.status}</p>
          </div>
          <div class="brief-meta">
            ${focusMeta.map((item) => `<span>${item}</span>`).join("")}
          </div>
        </section>

        <main class="doctor-workbench">
          <article class="doctor-card ai-decision-card">
            <div class="ai-card-head">
              <div class="ai-card-title">
                <span class="step-label">AI 分析</span>
                <h3>${issueTitle}</h3>
                <p class="muted">${doctorAiText(currentSuggestion?.reasoningSummary) || "AI 会结合提醒、家属反馈、打卡、用药和访视记录生成患者级判断。"}</p>
              </div>
              <div class="ai-side-status">
                <span class="status ${currentSuggestion?.riskLevel === "medium" || subject.risk === "warning" ? "warning" : "normal"}">${riskLabel}</span>
                <strong>${confidenceLabel}</strong>
              </div>
            </div>

            <div class="ai-decision-flow">
              <section>
                <span>发现的问题</span>
                <strong>${issueDetail}</strong>
              </section>
              <section>
                <span>绑定依据</span>
                <strong>${evidenceItems.length ? evidenceItems.map((item) => `${item.label}：${item.value}`).join(" / ") : "暂无新的家属反馈或未完成提醒"}</strong>
              </section>
              <section>
                <span>${actionTitle}</span>
                <strong>${nextAction}</strong>
              </section>
            </div>

            <div class="ai-action-bar">
              <div>
                <span>处理状态</span>
                <strong>${currentStatusLabel} · ${strategySource}</strong>
              </div>
              <div class="ai-action-buttons">
                ${
                  actionableSuggestion
                    ? `<button class="primary-button" data-suggestion-status="${actionableSuggestion.id}:accepted">确认建议</button>
                       <button class="small-button" data-suggestion-status="${actionableSuggestion.id}:sent_to_family">发送给家属</button>
                       <button class="small-button" data-suggestion-status="${actionableSuggestion.id}:dismissed">暂不处理</button>
                       <button class="small-button" data-suggestion-status="${actionableSuggestion.id}:false_positive">标记误报</button>`
                    : currentSuggestion
                      ? ""
                      : `<button class="primary-button" data-action="run-doctor-analyze">重新生成建议</button>`
                }
                ${reminder ? `<button class="small-button" data-complete-reminder="${reminder.id}">提醒已处理</button>` : ""}
              </div>
            </div>
          </article>

          <div class="doctor-workbench-grid">
            <article class="doctor-card compact-attention-card">
              <span class="step-label">家属反馈与提醒</span>
              <h3>${subjectFeedback.length + subjectReminders.length} 项待关注</h3>
              <div class="doctor-mini-list">
                ${
                  subjectFeedback.length
                    ? subjectFeedback.map((item) => `<p><strong>反馈</strong><span>${item.symptoms} · ${feedbackMetricSummary(item)}</span></p>`).join("")
                    : ""
                }
                ${
                  subjectReminders.length
                    ? subjectReminders.map((item) => `<p><strong>${reminderTypeLabel(item.type)}</strong><span>${item.title} · ${item.dueAt}</span></p>`).join("")
                    : ""
                }
                ${!subjectFeedback.length && !subjectReminders.length ? "<p><strong>当前</strong><span>没有新的反馈或提醒</span></p>" : ""}
              </div>
            </article>

            <article class="doctor-card compact-attention-card">
              <span class="step-label">医生处理</span>
              <h3>建议处置顺序</h3>
              <div class="doctor-mini-list">
                <p><strong>第一步</strong><span>确认症状趋势和今日用药是否完成</span></p>
                <p><strong>第二步</strong><span>根据反馈决定是否电话随访或发送家属提醒</span></p>
                <p><strong>第三步</strong><span>处理后可重新分析，刷新患者优先级</span></p>
              </div>
            </article>
          </div>

          <div class="record-accordion-grid">
            <details class="record-accordion" open>
              <summary>
                <span>治疗记录</span>
                <strong>${treatmentRecords.length} 条</strong>
              </summary>
              <div class="record-list">
                ${
                  treatmentRecords.length
                    ? treatmentRecords
                        .map(
                          (visit) => `
                            <article class="record-row">
                              <div>
                                <span>${visit.code} · ${visit.status}</span>
                                <strong>${visit.name}</strong>
                              </div>
                              <div>
                                <span>计划日期</span>
                                <strong>${visit.plannedDate}</strong>
                              </div>
                              <div>
                                <span>窗口</span>
                                <strong>${visit.window}</strong>
                              </div>
                              <p>${(visit.tasks || []).join(" / ")}</p>
                            </article>
                          `
                        )
                        .join("")
                    : renderEmpty("暂无治疗记录")
                }
              </div>
            </details>

            <details class="record-accordion">
              <summary>
                <span>用药记录</span>
                <strong>${medicationRecords.length} 条</strong>
              </summary>
              <div class="record-list">
                ${
                  medicationRecords.length
                    ? medicationRecords
                        .map(
                          (medication) => `
                            <article class="record-row medication-record">
                              <div>
                                <span>${medication.status}</span>
                                <strong>${medication.drug}</strong>
                              </div>
                              <div>
                                <span>剂量</span>
                                <strong>${medication.dose}</strong>
                              </div>
                              <div>
                                <span>周期 / 下次</span>
                                <strong>${medication.cycle} · ${medication.nextDoseDate}</strong>
                              </div>
                              <p>${medication.status}</p>
                            </article>
                          `
                        )
                        .join("")
                    : renderEmpty("暂无用药记录")
                }
              </div>
            </details>
          </div>

        </main>
      </div>
    </section>
  `;
}

function renderDoctorAi() {
  const dashboard = state.doctorDashboard;
  const visibleSuggestions = dashboard.suggestions.slice(0, 5);
  const visibleFeedback = dashboard.pendingFeedback.slice(0, 4);
  const visibleReminders = dashboard.openReminders.slice(0, 4);
  app.innerHTML = `
    <section class="grid metrics">
      ${renderMetric("待处理提醒", dashboard.openReminders.length)}
      ${renderMetric("家属反馈", dashboard.pendingFeedback.length)}
      ${renderMetric("AI候选建议", dashboard.suggestions.filter((item) => item.status === "candidate").length)}
      ${renderMetric("待确认抽取", dashboard.pendingExtractions.length)}
    </section>

    <section class="grid layout-2" style="margin-top: 18px;">
      <div class="panel">
        <div class="panel-header">
          <div>
            <h2>AI 分析建议</h2>
            <p class="muted">汇总患者状态、家属反馈、未完成提醒和待确认AI抽取</p>
          </div>
          <button class="primary-button" data-action="run-doctor-analyze">运行AI分析</button>
        </div>
        <div class="stack">
          ${
            dashboard.suggestions.length
              ? visibleSuggestions
                  .map(
                    (suggestion) => `
                      <article class="item-card">
                        <div class="panel-header">
                          <div>
                            <h3>${suggestion.subjectName} · ${suggestion.title}</h3>
                            <p class="muted">${suggestion.summary}</p>
                          </div>
                          <span class="status ${riskLevelClass(suggestion.riskLevel)}">${suggestionStatusLabel(suggestion.status)}</span>
                        </div>
                        <div class="item-meta">
                          ${(suggestion.evidence || []).map((item) => `<span>${item}</span>`).join("")}
                        </div>
                        ${
                          suggestion.status === "candidate"
                            ? `<div class="button-row card-actions">
                                <button class="small-button" data-suggestion-status="${suggestion.id}:accepted">接受</button>
                                <button class="small-button" data-suggestion-status="${suggestion.id}:sent_to_family">发送家属</button>
                                <button class="small-button" data-suggestion-status="${suggestion.id}:dismissed">忽略</button>
                              </div>`
                            : ""
                        }
                      </article>
                    `
                  )
                  .join("")
              : renderEmpty("暂无AI建议，点击运行AI分析生成候选卡片")
          }
        </div>
      </div>

      <div class="stack">
        ${renderLearningStatus()}
        <div class="panel">
          <div class="panel-header">
            <h2>家属反馈</h2>
            <span class="muted">${dashboard.pendingFeedback.length} 条</span>
          </div>
          <div class="stack">
            ${
              dashboard.pendingFeedback.length
                ? visibleFeedback
                    .map(
                      (feedback) => `
                        <article class="item-card">
                          <p><strong>${feedback.subjectName}</strong></p>
                          <div class="item-meta">
                            ${feedbackMetaMarkup(feedback)}
                          </div>
                        </article>
                      `
                    )
                    .join("")
                : renderEmpty("暂无新的家属反馈")
            }
          </div>
        </div>

        <div class="panel">
          <div class="panel-header">
            <h2>未完成提醒</h2>
            <span class="muted">${dashboard.openReminders.length} 项</span>
          </div>
          <div class="stack">
            ${
              dashboard.openReminders.length
                ? visibleReminders
                    .map(
                      (reminder) => `
                        <article class="item-card">
                          <div class="panel-header">
                            <div>
                              <p><strong>${reminder.subjectName} · ${reminder.title}</strong></p>
                              <div class="item-meta"><span>${reminderTypeLabel(reminder.type)}</span><span>${reminder.dueAt}</span></div>
                            </div>
                            <button class="small-button" data-complete-reminder="${reminder.id}">完成</button>
                          </div>
                        </article>
                      `
                    )
                    .join("")
                : renderEmpty("暂无开放提醒")
            }
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderCalendar() {
  app.innerHTML = `
    <section class="grid layout-2">
      <div class="panel">
        <div class="panel-header">
          <h2>访视计划</h2>
          <span class="muted">${state.visits.length} 个待执行节点</span>
        </div>
        <div class="stack">
          ${state.visits
            .map(
              (visit) => `
                <article class="item-card">
                  <div class="panel-header">
                    <div>
                      <h3>${subjectName(visit.subjectId)} · ${visit.name}</h3>
                      <p class="muted">${visit.window}</p>
                    </div>
                    <div class="button-row">
                      <span class="status normal">${visit.status}</span>
                      ${
                        visit.status === "已完成"
                          ? ""
                          : `<button class="small-button" data-complete-visit="${visit.id}">完成访视</button>`
                      }
                    </div>
                  </div>
                  <div class="item-meta">${visit.tasks.map((task) => `<span>${task}</span>`).join("")}</div>
                </article>
              `
            )
            .join("")}
        </div>
      </div>

      <div class="panel">
        <div class="panel-header">
          <h2>用药计划</h2>
        </div>
        <div class="stack">
          ${state.medications
            .map(
              (medication) => `
                <article class="item-card">
                  <div class="panel-header">
                    <p><strong>${subjectName(medication.subjectId)} · ${medication.drug}</strong></p>
                    <button class="small-button" data-adjust-medication="${medication.id}">体重调整</button>
                  </div>
                  <div class="item-meta">
                    <span>${medication.dose}</span>
                    <span>${medication.cycle}</span>
                    <span>${medication.nextDoseDate}</span>
                    <span>${medication.status}</span>
                    ${medication.adjustmentReason ? `<span>${medication.adjustmentReason}</span>` : ""}
                  </div>
                </article>
              `
            )
            .join("")}
        </div>
      </div>

      <div class="panel">
        <div class="panel-header">
          <h2>定时提醒</h2>
          <span class="muted">${state.reminders.filter((item) => item.status === "open").length} 项开放</span>
        </div>
        <div class="stack">
          ${state.reminders
            .map(
              (reminder) => `
                <article class="item-card">
                  <div class="panel-header">
                    <div>
                      <p><strong>${subjectName(reminder.subjectId)} · ${reminder.title}</strong></p>
                      <div class="item-meta">
                        <span>${reminderTypeLabel(reminder.type)}</span>
                        <span>${reminder.dueAt}</span>
                        <span>${reminder.channel}</span>
                        <span>${reminder.status === "done" ? "已完成" : "开放"}</span>
                      </div>
                    </div>
                    ${
                      reminder.status === "done"
                        ? '<span class="status normal">已完成</span>'
                        : `<button class="small-button" data-complete-reminder="${reminder.id}">完成</button>`
                    }
                  </div>
                </article>
              `
            )
            .join("")}
        </div>
      </div>
    </section>
  `;
}

function renderTasks() {
  const openTasks = state.tasks.filter((task) => task.status === "open");
  app.innerHTML = `
    <section class="panel">
      <div class="panel-header">
        <h2>任务队列</h2>
        <span class="muted">${openTasks.length} 项开放任务 / ${state.tasks.length} 项全部任务</span>
      </div>
      <table class="table">
        <thead>
          <tr>
            <th>任务</th>
            <th>类型</th>
            <th>患者</th>
            <th>负责人</th>
            <th>截止日期</th>
            <th>优先级</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          ${state.tasks
            .map(
              (task) => `
                <tr>
                  <td>${task.title}</td>
                  <td>${task.type}</td>
                  <td>${subjectName(task.subjectId)}</td>
                  <td>${task.owner}</td>
                  <td>${task.dueDate}</td>
                  <td><span class="priority ${priorityClass(task.priority)}">${task.priority}</span></td>
                  <td>${task.status === "done" ? "已完成" : "开放"}</td>
                  <td>
                    ${
                      task.status === "done"
                        ? '<span class="status normal">已处理</span>'
                        : `<button class="small-button" data-complete-task="${task.id}">完成任务</button>`
                    }
                  </td>
                </tr>
              `
            )
            .join("")}
        </tbody>
      </table>
    </section>
  `;
}

function renderQuality() {
  const quality = state.quality;
  app.innerHTML = `
    <section class="grid metrics">
      ${renderMetric("待确认文档", quality.counters.pendingDocuments)}
      ${renderMetric("待复核AI", quality.counters.pendingExtractions)}
      ${renderMetric("开放任务", quality.counters.openTasks)}
      ${renderMetric("审计记录", quality.counters.auditLogs)}
      ${renderMetric("家属反馈", quality.counters.familyFeedback ?? 0)}
      ${renderMetric("学习记录", quality.counters.evolutionEvents ?? 0)}
    </section>

    <section class="grid layout-2" style="margin-top: 18px;">
      <div class="panel">
        <div class="panel-header">
          <div>
            <h2>质控问题</h2>
            <p class="muted">聚合待确认文档、AI复核和开放任务</p>
          </div>
        </div>
        <div class="stack">
          ${quality.pendingDocuments
            .map(
              (document) => `
                <article class="item-card">
                  <p><strong>${document.subjectName} · ${document.type}</strong></p>
                  <div class="item-meta">
                    <span>${document.fileName}</span>
                    <span>${document.status}</span>
                    <span>${document.ocrStatus}</span>
                  </div>
                </article>
              `
            )
            .join("")}
          ${quality.pendingExtractions
            .map(
              (extraction) => `
                <article class="item-card">
                  <div class="panel-header">
                    <div>
                      <p><strong>${extraction.subjectName} · ${extraction.documentId}</strong></p>
                      <div class="item-meta"><span>置信度 ${(extraction.confidence * 100).toFixed(0)}%</span><span>${extraction.status}</span></div>
                    </div>
                    <button class="small-button" data-confirm-extraction="${extraction.id}">确认入档</button>
                  </div>
                </article>
              `
            )
            .join("")}
          ${quality.openTasks
            .map(
              (task) => `
                <article class="item-card">
                  <div class="panel-header">
                    <div>
                      <p><strong>${task.title}</strong></p>
                      <div class="item-meta"><span>${task.subjectName}</span><span>${task.owner}</span><span>${task.dueDate}</span></div>
                    </div>
                    <button class="small-button" data-complete-task="${task.id}">完成任务</button>
                  </div>
                </article>
              `
            )
            .join("")}
          ${(quality.familyFeedback || [])
            .map(
              (feedback) => `
                <article class="item-card">
                  <p><strong>${feedback.subjectName} · 家属反馈</strong></p>
                  <div class="item-meta">
                    ${feedbackMetaMarkup(feedback)}
                    <span>${feedback.status}</span>
                  </div>
                </article>
              `
            )
            .join("")}
          ${(quality.aiSuggestions || [])
            .map(
              (suggestion) => `
                <article class="item-card">
                  <p><strong>${suggestion.subjectName} · ${suggestion.title}</strong></p>
                  <div class="item-meta">
                    <span>${suggestionStatusLabel(suggestion.status)}</span>
                    <span>${suggestion.riskLevel}</span>
                    <span>${suggestion.type}</span>
                  </div>
                </article>
              `
            )
            .join("")}
        </div>
      </div>

      <div class="panel">
        <div class="panel-header">
          <h2>审计日志</h2>
        </div>
        <div class="stack">
          ${(quality.evolutionEvents || [])
            .map(
              (event) => `
                <article class="item-card">
                  <p><strong>系统学习 · ${event.summary}</strong></p>
                  <div class="item-meta">
                    <span>${event.type}</span>
                    <span>${event.status}</span>
                    <span>${event.deidentified ? "已脱敏" : "待检查"}</span>
                  </div>
                </article>
              `
            )
            .join("")}
          ${quality.auditLogs
            .map(
              (log) => `
                <article class="item-card">
                  <p><strong>${log.action}</strong></p>
                  <div class="item-meta">
                    <span>${log.actor}</span>
                    <span>${log.target}</span>
                    <span>${new Date(log.createdAt).toLocaleString("zh-CN")}</span>
                  </div>
                </article>
              `
            )
            .join("")}
        </div>
      </div>
    </section>
  `;
}

async function openSubject(subjectId) {
  const subject = await getJson(`/api/subjects/${subjectId}`);
  detail.innerHTML = `
    <section class="detail">
      <h2>${subject.name} · ${subject.code}</h2>
      <p class="muted">${subject.site} · ${subject.status}</p>
      <div class="detail-grid">
        <div class="detail-cell"><span>性别</span><strong>${subject.sex}</strong></div>
        <div class="detail-cell"><span>年龄</span><strong>${subject.age}</strong></div>
        <div class="detail-cell"><span>联系电话</span><strong>${subject.phone}</strong></div>
        <div class="detail-cell"><span>基线日期</span><strong>${subject.baselineDate ?? "待确认"}</strong></div>
        <div class="detail-cell"><span>下次访视</span><strong>${subject.nextVisitDate ?? "未生成"}</strong></div>
        <div class="detail-cell"><span>开放任务</span><strong>${subject.tasks.length}</strong></div>
      </div>

      <div class="grid layout-2">
        <div class="panel">
          <div class="panel-header"><h3>文档</h3></div>
          <form class="compact-form" data-upload-document="${subject.id}">
            <div class="form-field">
              <label for="doc-type-${subject.id}">材料类型</label>
              <select id="doc-type-${subject.id}" name="type">
                <option>门诊病历</option>
                <option>知情同意书</option>
                <option>检查报告</option>
                <option>身份证</option>
              </select>
            </div>
            <div class="form-field">
              <label for="doc-file-${subject.id}">文件名</label>
              <input id="doc-file-${subject.id}" name="fileName" value="${subject.code}_followup.pdf" />
            </div>
            <button class="small-button" type="submit">模拟上传</button>
          </form>
          <div class="stack">
            ${subject.documents
              .map(
                (document) => `
                  <article class="item-card">
                    <p><strong>${document.type}</strong></p>
                    <div class="item-meta">
                      <span>${document.fileName}</span>
                      <span>${document.status}</span>
                      <span>${document.ocrStatus}</span>
                    </div>
                  </article>
                `
              )
              .join("")}
          </div>
        </div>
        ${
          subject.extractions.length
            ? `<div class="panel">
                <div class="panel-header"><h3>AI候选字段</h3></div>
                <div class="stack">
                  ${subject.extractions
                    .map(
                      (extraction) => `
                        <article class="item-card">
                          <div class="panel-header">
                            <p><strong>${extraction.id}</strong></p>
                            ${
                              extraction.status === "confirmed"
                                ? '<span class="status normal">已入档</span>'
                                : `<button class="small-button" data-confirm-extraction="${extraction.id}">确认入档</button>`
                            }
                          </div>
                          <div class="field-list">
                            ${extraction.fields
                              .map(
                                (field) => `
                                  <div class="field-row">
                                    <strong>${field.name}</strong>
                                    <div>${field.value}<br /><span>${field.source}</span></div>
                                    <span>${(field.confidence * 100).toFixed(0)}%</span>
                                  </div>
                                `
                              )
                              .join("")}
                          </div>
                        </article>
                      `
                    )
                    .join("")}
                </div>
              </div>`
            : ""
        }
        <div class="panel">
          <div class="panel-header"><h3>访视与用药</h3></div>
          <div class="stack">
            ${subject.visits
              .map(
                (visit) => `
                  <article class="item-card">
                    <div class="panel-header">
                      <p><strong>${visit.name}</strong></p>
                      ${
                        visit.status === "已完成"
                          ? '<span class="status normal">已完成</span>'
                          : `<button class="small-button" data-complete-visit="${visit.id}">完成访视</button>`
                      }
                    </div>
                    <div class="item-meta"><span>${visit.plannedDate}</span><span>${visit.status}</span></div>
                  </article>
                `
              )
              .join("")}
            ${subject.medications
              .map(
                (medication) => `
                  <article class="item-card">
                    <p><strong>${medication.drug}</strong></p>
                    <div class="item-meta"><span>${medication.dose}</span><span>${medication.nextDoseDate}</span></div>
                  </article>
                `
              )
              .join("")}
          </div>
        </div>
      </div>
    </section>
  `;
  dialog.showModal();
}

function formatCheckinDate(date) {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return `${parsed.getMonth() + 1}月${parsed.getDate()}日`;
}

function uniqueText(items) {
  return Array.from(new Set(items.map((item) => String(item || "").trim()).filter(Boolean)));
}

function familyCheckinTaskOptions(home, rehabAdvice, day) {
  const doctorAdvice = (home?.doctorRehabAdvice || []).map((item) =>
    [item.title, item.advice].filter(Boolean).join("：")
  );
  return uniqueText([
    ...doctorAdvice,
    rehabAdvice?.task && rehabAdvice?.advice ? `${rehabAdvice.task}：${rehabAdvice.advice}` : rehabAdvice?.task,
    day?.task
  ]).slice(0, 5);
}

function completedCheckinTasks(day) {
  if (Array.isArray(day?.completedTasks) && day.completedTasks.length) return day.completedTasks;
  if (Array.isArray(day?.tasks) && day.tasks.length) return day.tasks;
  if (day?.task && day.activityCompleted !== false) return [day.task];
  return [];
}

function renderFamilyCheckinCard(home, rehabAdvice, monthCells) {
  if (!state.activeFamilyCheckinDate) return "";

  const day = monthCells.find((item) => item.date === state.activeFamilyCheckinDate);
  if (!day) return "";

  const dateLabel = formatCheckinDate(day.date);
  const isRecord = day.status === "done";
  const canFill = day.canCheckIn && !isRecord;
  const taskOptions = familyCheckinTaskOptions(home, rehabAdvice, day);
  const completedTasks = completedCheckinTasks(day);
  const completedSet = new Set(completedTasks);
  const title = canFill ? `${dateLabel}康复打卡` : `${dateLabel}康复记录`;

  return `
    <div class="family-checkin-overlay" data-close-family-checkin="backdrop">
      <article class="family-checkin-card" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
        <button class="dialog-close family-card-close" data-close-family-checkin="button" aria-label="关闭">×</button>
        <div class="family-card-head">
          <h2>${escapeHtml(title)}</h2>
        </div>
        ${
          canFill
            ? `<form id="family-checkin-form" class="family-checkin-form">
                <input type="hidden" name="date" value="${escapeHtml(day.date)}" />
                <input type="hidden" name="title" value="${escapeHtml(rehabAdvice.title)}" />
                <input type="hidden" name="task" value="${escapeHtml(taskOptions[0] || rehabAdvice.task)}" />
                <div class="checkin-task-list">
                  ${taskOptions
                    .map(
                      (task) => `
                        <label class="check-task-row">
                          <input name="completedTasks" type="checkbox" value="${escapeHtml(task)}" ${completedSet.has(task) ? "checked" : ""} />
                          <span>${escapeHtml(task)}</span>
                        </label>
                      `
                    )
                    .join("")}
                </div>
                <label class="note-field">
                  <span>记录</span>
                  <textarea name="note" rows="4" placeholder="填写今天的康复记录">${escapeHtml(day.note || "")}</textarea>
                </label>
                <button class="primary-button" type="submit">保存打卡</button>
              </form>`
            : `<div class="checkin-record-view">
                <div class="checkin-record-grid">
                  <div><span>心态</span><strong>${escapeHtml(day.mood || "未记录")}</strong></div>
                  <div><span>疲劳度</span><strong>${day.fatigueLevel == null ? "未记录" : `${escapeHtml(day.fatigueLevel)}/10`}</strong></div>
                  <div><span>体温</span><strong>${day.temperatureC == null ? "未记录" : `${escapeHtml(day.temperatureC)}℃`}</strong></div>
                  <div><span>疼痛</span><strong>${day.painScore == null ? "未记录" : `${escapeHtml(day.painScore)}分`}</strong></div>
                </div>
                <div class="checkin-daily-summary">
                  ${day.appetite ? `<span>食欲：${escapeHtml(day.appetite)}</span>` : ""}
                  ${day.sleepQuality ? `<span>睡眠：${escapeHtml(day.sleepQuality)}</span>` : ""}
                  ${day.hydration ? `<span>饮水：${escapeHtml(day.hydration)}</span>` : ""}
                  <span>${day.warningObserved ? "有异常观察" : "未见明显异常"}</span>
                </div>
                <div class="checkin-task-list">
                  ${
                    completedTasks.length
                      ? completedTasks
                          .map(
                            (task) => `
                              <label class="check-task-row">
                                <input type="checkbox" checked disabled />
                                <span>${escapeHtml(task)}</span>
                              </label>
                            `
                          )
                          .join("")
                      : `<p class="muted empty-state">未记录打卡内容</p>`
                  }
                </div>
                <label class="note-field">
                  <span>记录</span>
                  <textarea rows="4" readonly>${escapeHtml(day.note || day.vitalSummary || "未填写记录")}</textarea>
                </label>
              </div>`
        }
      </article>
    </div>
  `;
}

function renderFamilyPortal() {
  const home = state.familyHome;
  const subjectsOptions = state.subjects
    .map((subject) => `<option value="${subject.id}" ${subject.id === state.selectedFamilySubjectId ? "selected" : ""}>${subject.code}</option>`)
    .join("");
  const nextReminders = home.reminders.filter((reminder) => reminder.status === "open");
  const primaryReminder = nextReminders[0];
  const recentConversations = home.conversations.slice(0, 3);
  const qaPrompts = home.qaPrompts || ["复诊前需要记录什么？", "今天康复运动做到什么程度合适？", "哪些症状需要联系医生？"];
  const qaPromptValue = qaPrompts[0] || "复诊前需要记录什么？";
  const qaPromptMarkup = qaPrompts.length
    ? `<div class="prompt-carousel" aria-label="推荐问题轮播">
        ${qaPrompts
          .map(
            (prompt, index) => `
              <button class="prompt-chip" type="button" data-qa-prompt="${escapeHtml(prompt)}" style="--prompt-index: ${index}">
                ${escapeHtml(prompt)}
              </button>
            `
          )
          .join("")}
      </div>`
    : "";
  const doctorRehabAdvice = (home.doctorRehabAdvice || []).slice(0, 2);
  const doctorAdviceMarkup = doctorRehabAdvice.length
    ? `<details class="doctor-rehab-details" open>
        <summary>
          <span>医生康复建议</span>
          <strong>${doctorRehabAdvice.length}条</strong>
        </summary>
        <div class="doctor-rehab-list">
          ${doctorRehabAdvice
            .map(
              (item) => `
                <article class="doctor-rehab-item">
                  <span>${escapeHtml(item.source || "主管医生")}${item.focus ? ` · ${escapeHtml(item.focus)}` : ""}</span>
                  <strong>${escapeHtml(item.title || "今日康复建议")}</strong>
                  <p>${escapeHtml(item.advice || "按医生建议完成今日康复记录。")}</p>
                </article>
              `
            )
            .join("")}
        </div>
      </details>`
    : "";
  const rehabAdvice = home.rehabAdvice || {
    date: new Date().toISOString().slice(0, 10),
    title: "今日康复打卡",
    task: home.carePlan?.exercise || "完成一次轻量活动并记录身体状态",
    advice: home.carePlan ? `${home.carePlan.diet}；观察${home.carePlan.symptomWatch.slice(0, 2).join("、")}。` : "保持规律饮食，观察体温、疼痛和精神状态。",
    status: "open"
  };
  const monthCells =
    home.checkinMonth ||
    Array.from({ length: 30 }, (_, index) => ({
      date: `${rehabAdvice.date.slice(0, 8)}${String(index + 1).padStart(2, "0")}`,
      day: index + 1,
      status: index + 1 === Number(rehabAdvice.date.slice(-2)) ? rehabAdvice.status : index + 1 > Number(rehabAdvice.date.slice(-2)) ? "future" : "open",
      canCheckIn: index + 1 === Number(rehabAdvice.date.slice(-2)) && rehabAdvice.status !== "done",
      isToday: index + 1 === Number(rehabAdvice.date.slice(-2))
    }));
  const completedDays = monthCells.filter((day) => day.status === "done").length;
  const todayCell = monthCells.find((day) => day.date === rehabAdvice.date);
  const rehabProviderMarkup =
    rehabAdvice.provider === "evomap_llm" ? `<span class="status normal">ComfortHelper AI · ${rehabAdvice.model || "deepseek"}</span>` : "";
  const feedbackTemplate = selectFamilyFeedbackTemplate(home);
  studyTitle.textContent = "今天的康复提醒";
  app.innerHTML = `
    <section class="family-shell">
      <div class="family-toolbar">
        <div>
          <h2>${home.subject.displayName}</h2>
          <p class="muted">康复打卡 · ${home.subject.status}</p>
        </div>
        <select id="family-subject-select" aria-label="选择患者">${subjectsOptions}</select>
      </div>

      <div class="phone-frame">
        <section class="family-section family-focus">
          <span class="step-label">1 · 今天先做这件事</span>
          ${
            primaryReminder
              ? `<h2>${primaryReminder.title}</h2>
                 <p class="muted">${reminderTypeLabel(primaryReminder.type)} · ${primaryReminder.dueAt}</p>
                 <button class="primary-button" data-complete-reminder="${primaryReminder.id}">我已完成</button>`
              : doctorRehabAdvice.length
                ? `<h2>医生今日康复建议</h2><p class="muted">今天没有新的提醒，先完成医生建议的康复记录。</p>`
              : `<h2>今天没有新的提醒</h2><p class="muted">保持记录，有不舒服随时反馈。</p>`
          }
          ${doctorAdviceMarkup}
        </section>

        <section class="family-section">
          <div class="panel-header compact-header">
            <div>
              <span class="step-label">2 · 月度康复打卡</span>
              <h2>${rehabAdvice.title}</h2>
            </div>
            ${rehabProviderMarkup}
          </div>
          <div class="ai-advice-meta">
            <span>${completedDays}/${monthCells.length} 已打卡</span>
            ${rehabAdvice.focus ? `<span>${rehabAdvice.focus}</span>` : ""}
          </div>
          <p>${rehabAdvice.task}</p>
          <div class="item-meta"><span>${rehabAdvice.advice}</span></div>
          <div class="checkin-heatmap" aria-label="月度康复打卡">
            ${monthCells
              .map((day) => {
                const canOpen = day.canCheckIn || day.status === "done";
                const label = `${day.date}${day.status === "done" ? " 已打卡" : day.status === "future" ? " 未到日期" : day.isToday ? " 可打卡" : " 未打卡"}`;
                return `
                  <button
                    class="checkin-cell ${day.status === "done" ? "done" : ""} ${day.status === "future" ? "future" : ""} ${day.isPast && day.status !== "done" ? "missed" : ""} ${day.date === rehabAdvice.date ? "today" : ""}"
                    ${canOpen ? `data-family-checkin-card="${day.date}"` : "disabled"}
                    title="${escapeHtml(label)}"
                    aria-label="${escapeHtml(label)}"
                  >${day.day}</button>
                `;
              })
              .join("")}
          </div>
          <div class="checkin-legend">
            <span><i class="legend-box"></i>未打卡</span>
            <span><i class="legend-box done"></i>已打卡</span>
            <span>${todayCell?.status === "done" ? "今日已打卡" : "仅今天可打卡"}</span>
          </div>
        </section>

        <section class="family-section">
          <span class="step-label">3 · 有问题先问一句</span>
          ${qaPromptMarkup}
          <form id="family-qa-form" class="family-form">
            <input name="question" value="${escapeHtml(qaPromptValue)}" />
            <button class="primary-button" type="submit">提问</button>
          </form>
          ${
            recentConversations.length
              ? `<details class="qa-history-details">
                  <summary>
                    <span>以前多轮建议</span>
                    <strong>${recentConversations.length}条</strong>
                  </summary>
                  <div class="qa-thread">
                    ${recentConversations
                      .map(
                        (conversation) => `
                          <article class="answer-card">
                            <p><strong>${conversation.riskRoute === "doctor_contact" ? "建议联系医生" : `第${conversation.turnIndex || ""}轮 · 康复建议`}</strong></p>
                            <p class="muted">问：${escapeHtml(conversation.question)}</p>
                            <p>${escapeHtml(conversation.answer)}</p>
                          </article>
                        `
                      )
                      .join("")}
                  </div>
                </details>`
              : ""
          }
        </section>

        <section class="family-section">
          <span class="step-label">4 · 报告今天情况</span>
          <form id="family-feedback-form" class="family-form vertical">
            <input type="hidden" name="feedbackTemplate" value="${escapeHtml(feedbackTemplate.id)}" />
            <input type="hidden" name="feedbackTemplateLabel" value="${escapeHtml(feedbackTemplate.label)}" />
            <div class="feedback-template-head">
              <strong>${escapeHtml(feedbackTemplate.label)}</strong>
              <span>${escapeHtml(feedbackTemplate.hint)}</span>
            </div>
            <textarea name="symptoms" rows="3" placeholder="${escapeHtml(feedbackTemplate.symptomPlaceholder)}"></textarea>
            <div class="feedback-template-fields">
              ${feedbackTemplate.fields.map(renderFamilyFeedbackField).join("")}
            </div>
            <label class="check-row"><input name="medicationTaken" type="checkbox" /> 已按提醒完成用药</label>
            <input name="question" placeholder="想问医生或CRC的问题，可不填" />
            <button class="primary-button" type="submit">提交反馈</button>
          </form>
        </section>
      </div>
      ${renderFamilyCheckinCard(home, rehabAdvice, monthCells)}
    </section>
  `;
}

function render() {
  if (!state.portal) {
    renderEntry();
    return;
  }
  document.body.classList.remove("entry-mode");
  document.body.classList.toggle("doctor-flow-mode", state.portal === "doctor");
  portalEyebrow.textContent = state.portal === "family" ? "家属端 H5" : "医生管理端";
  document.querySelectorAll("[data-portal]").forEach((item) => {
    item.classList.toggle("active", item.dataset.portal === state.portal);
  });
  document.body.classList.toggle("family-mode", state.portal === "family");
  navItems.forEach((item) => item.classList.remove("active"));
  if (state.portal === "family") {
    renderFamilyPortal();
    return;
  }
  renderDoctorFlow();
}

async function loadData() {
  const [
    dashboard,
    subjects,
    documents,
    extractions,
    visits,
    medications,
    tasks,
    quality,
    doctorDashboard,
    reminders,
    aiSuggestions,
    familyConversations,
    familyFeedback,
    evolutionEvents,
    familyHome
  ] = await Promise.all([
    getJson("/api/dashboard"),
    getJson("/api/subjects"),
    getJson("/api/documents"),
    getJson("/api/extractions"),
    getJson("/api/visits"),
    getJson("/api/medications"),
    getJson("/api/tasks"),
    getJson("/api/quality"),
    getJson("/api/doctor/dashboard"),
    getJson("/api/reminders"),
    getJson("/api/aiSuggestions"),
    getJson("/api/familyConversations"),
    getJson("/api/familyFeedback"),
    getJson("/api/evolutionEvents"),
    getJson(`/api/family/home?subjectId=${state.selectedFamilySubjectId}`)
  ]);
  Object.assign(state, {
    dashboard,
    subjects,
    documents,
    extractions,
    visits,
    medications,
    tasks,
    quality,
    doctorDashboard,
    reminders,
    aiSuggestions,
    familyConversations,
    familyFeedback,
    evolutionEvents,
    familyHome,
    evomapNode: doctorDashboard.evomapNode
  });
}

async function refresh(message) {
  await loadData();
  render();
  if (dialog.open) {
    dialog.close();
  }
  if (message) {
    showToast(message);
  }
}

async function createSubjectFromForm(form) {
  const formData = new FormData(form);
  await sendJson("/api/subjects", "POST", Object.fromEntries(formData.entries()));
  state.view = "subjects";
  await refresh("已新建患者，并生成AI抽取与筛选访视");
}

function applyMockCaseImageParse(file) {
  const fileName = file?.name || "case_image_upload.jpg";
  const lowerName = fileName.toLowerCase();
  const inferred = lowerName.includes("lab")
    ? { documentType: "检查报告", diagnosis: "实验室检查异常" }
    : lowerName.includes("discharge")
      ? { documentType: "出院小结", diagnosis: "术后康复随访" }
      : { documentType: "门诊病历", diagnosis: "肺腺癌" };
  const nextIndex = state.subjects.length + 1;

  document.querySelector("#case-file-name").textContent = `已解析：${fileName}`;
  document.querySelector("#create-file-name").value = fileName;
  document.querySelector("#create-name").value = `图片解析患者${nextIndex}`;
  document.querySelector("#create-age").value = String(50 + (nextIndex % 12));
  document.querySelector("#create-diagnosis").value = inferred.diagnosis;
  document.querySelector("#create-document-type").value = inferred.documentType;
}

async function createDoctorPatientFromForm(form) {
  const formData = new FormData(form);
  const payload = {
    name: String(formData.get("name") || "").trim(),
    sex: formData.get("sex"),
    age: Number(formData.get("age") || 50),
    site: formData.get("site"),
    diagnosis: formData.get("diagnosis"),
    documentType: formData.get("documentType"),
    nextVisitDate: formData.get("nextVisitDate"),
    fileName: formData.get("fileName") || "case_image_upload.jpg"
  };
  const created = await sendJson("/api/subjects", "POST", payload);
  state.selectedDoctorSubjectId = created.subject.id;
  await refresh("患者已建档，并生成AI候选信息");
}

async function createQuickSubject() {
  await sendJson("/api/subjects", "POST", {
    name: `测试患者${state.subjects.length + 1}`,
    sex: state.subjects.length % 2 === 0 ? "女" : "男",
    age: 45 + state.subjects.length,
    site: "上海第一中心",
    diagnosis: "肺腺癌",
    documentType: "门诊病历"
  });
  state.view = "subjects";
  await refresh("已生成一名测试患者");
}

async function importSubjects() {
  await sendJson("/api/imports/subjects", "POST", {});
  state.view = "subjects";
  await refresh("已批量导入测试患者");
}

async function confirmExtraction(extractionId) {
  await sendJson(`/api/extractions/${extractionId}/confirm`, "POST", {});
  await refresh("AI候选字段已确认入档");
}

async function completeVisit(visitId) {
  await sendJson(`/api/visits/${visitId}`, "PATCH", { status: "已完成" });
  await refresh("访视状态已更新为已完成");
}

async function completeTask(taskId) {
  await sendJson(`/api/tasks/${taskId}`, "PATCH", { status: "done" });
  await refresh("任务已完成");
}

async function adjustMedication(medicationId) {
  await sendJson(`/api/medications/${medicationId}`, "PATCH", {
    weightKg: 68,
    reason: "体重变化至68kg，系统模拟重算剂量"
  });
  state.view = "calendar";
  await refresh("用药剂量已按体重变化调整");
}

async function runDoctorAnalyze() {
  await sendJson("/api/doctor/ai/analyze", "POST", {});
  state.view = "doctor-ai";
  await refresh("AI分析已生成医生端候选建议");
}

async function updateSuggestionStatus(token) {
  const [suggestionId, status] = token.split(":");
  const reasonByStatus = {
    accepted: "医生确认该建议有处理价值。",
    sent_to_family: "医生认为该建议适合同步给家属执行。",
    dismissed: "医生暂不处理，保持观察。",
    false_positive: "医生标记为误报，后续降低相似信号权重。"
  };
  await sendJson(`/api/doctor/suggestions/${suggestionId}`, "PATCH", {
    status,
    doctorDecisionReason: reasonByStatus[status] || ""
  });
  await refresh("AI建议状态已更新");
}

async function completeReminder(reminderId) {
  await sendJson(`/api/reminders/${reminderId}`, "PATCH", {
    status: "done",
    actor: state.portal === "family" ? "家属端H5" : "医生管理者"
  });
  await refresh("提醒已完成");
}

async function askFamilyQuestion(form) {
  const formData = new FormData(form);
  await sendJson("/api/family/qa", "POST", {
    subjectId: state.selectedFamilySubjectId,
    question: formData.get("question")
  });
  await refresh("已返回问答建议");
}

async function submitFamilyFeedback(form) {
  const formData = new FormData(form);
  const observations = Array.from(form.querySelectorAll("[data-observation-field]"))
    .map((field) => ({
      name: field.name,
      label: field.dataset.observationLabel || field.name,
      unit: field.dataset.observationUnit || "",
      value: String(field.value || "").trim()
    }))
    .filter((item) => item.value);
  const payload = {
    subjectId: state.selectedFamilySubjectId,
    symptoms: formData.get("symptoms"),
    feedbackTemplate: formData.get("feedbackTemplate"),
    feedbackTemplateLabel: formData.get("feedbackTemplateLabel"),
    observations,
    temperatureC: formData.get("temperatureC"),
    painScore: formData.get("painScore"),
    medicationTaken: formData.get("medicationTaken") === "on",
    question: formData.get("question")
  };
  await sendJson("/api/family/feedback", "POST", payload);
  await refresh("家属反馈已提交到医生端");
}

async function submitFamilyCheckinRecord(form) {
  const formData = new FormData(form);
  const advice = state.familyHome?.rehabAdvice;
  const date = String(formData.get("date") || advice?.date || new Date().toISOString().slice(0, 10));
  const today = advice?.date || new Date().toISOString().slice(0, 10);
  if (date > today) {
    showToast("未来日期不能提前打卡");
    return;
  }
  if (date < today) {
    showToast("过去日期不能补打");
    return;
  }
  const day = state.familyHome?.checkinMonth?.find((item) => item.date === date);
  if (day?.status === "done") {
    showToast("这一天已经完成打卡");
    return;
  }
  const completedTasks = formData.getAll("completedTasks").map((task) => String(task));
  const checkin = await sendJson("/api/family/checkin", "POST", {
    subjectId: state.selectedFamilySubjectId,
    date,
    title: formData.get("title") || advice?.title,
    task: formData.get("task") || advice?.task,
    completedTasks,
    activityCompleted: completedTasks.length > 0,
    note: formData.get("note")
  });
  const home = state.familyHome;
  if (home) {
    const day = home.checkinMonth?.find((item) => item.date === checkin.date);
    if (day) {
      Object.assign(day, {
        ...checkin,
        day: day.day,
        canCheckIn: false,
        isToday: day.isToday,
        isPast: day.isPast
      });
    }
    if (home.rehabAdvice?.date === checkin.date) {
      home.rehabAdvice = {
        ...home.rehabAdvice,
        status: "done",
        completedAt: checkin.completedAt
      };
    }
  }
  state.activeFamilyCheckinDate = null;
  render();
  showToast("康复打卡已保存");
}

async function uploadSubjectDocument(form) {
  const subjectId = form.dataset.uploadDocument;
  const formData = new FormData(form);
  await sendJson(`/api/subjects/${subjectId}/documents`, "POST", Object.fromEntries(formData.entries()));
  state.view = "ai";
  await refresh("材料已上传，并生成AI复核任务");
}

async function resetSeedData() {
  await sendJson("/api/admin/reset", "POST", {});
  state.view = "dashboard";
  await refresh("测试数据已重置");
}

document.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;

  const view = target.dataset.view;
  if (view) {
    state.portal = "doctor";
    state.view = view;
    render();
    return;
  }

  const entryPortal = target.dataset.entryPortal;
  if (entryPortal) {
    state.activeFamilyCheckinDate = null;
    enterPortal(entryPortal);
    return;
  }

  const portal = target.dataset.portal;
  if (portal) {
    state.activeFamilyCheckinDate = null;
    enterPortal(portal);
    return;
  }

  const closeFamilyCheckin = target.dataset.closeFamilyCheckin;
  if (closeFamilyCheckin === "button" || target.classList.contains("family-checkin-overlay")) {
    state.activeFamilyCheckinDate = null;
    render();
    return;
  }

  const doctorSubjectId = target.dataset.doctorSubject;
  if (doctorSubjectId) {
    state.selectedDoctorSubjectId = doctorSubjectId;
    render();
    return;
  }

  const subjectId = target.dataset.subject;
  if (subjectId) {
    openSubject(subjectId);
    return;
  }

  const action = target.dataset.action;
  if (action === "quick-subject") {
    createQuickSubject();
    return;
  }

  if (action === "import-subjects") {
    importSubjects();
    return;
  }

  if (action === "run-doctor-analyze") {
    runInteraction(target, runDoctorAnalyze, "分析中...");
    return;
  }

  if (action === "add-doctor-patient") {
    state.selectedDoctorSubjectId = "new";
    state.doctorCreateMode = "upload";
    render();
    return;
  }

  if (action === "back-doctor-cards") {
    state.selectedDoctorSubjectId = null;
    render();
    return;
  }

  const createMode = target.dataset.createMode;
  if (createMode) {
    state.doctorCreateMode = createMode;
    render();
    return;
  }

  const suggestionStatus = target.dataset.suggestionStatus;
  if (suggestionStatus) {
    runInteraction(target, () => updateSuggestionStatus(suggestionStatus), "更新中...");
    return;
  }

  const reminderId = target.dataset.completeReminder;
  if (reminderId) {
    runInteraction(target, () => completeReminder(reminderId), "完成中...");
    return;
  }

  const checkinDate = target.dataset.familyCheckinCard;
  if (checkinDate) {
    state.activeFamilyCheckinDate = checkinDate;
    render();
    return;
  }

  const qaPrompt = target.dataset.qaPrompt;
  if (qaPrompt) {
    const input = document.querySelector('#family-qa-form input[name="question"]');
    if (input instanceof HTMLInputElement) {
      input.value = qaPrompt;
      input.focus();
    }
    return;
  }

  const extractionId = target.dataset.confirmExtraction;
  if (extractionId) {
    runInteraction(target, () => confirmExtraction(extractionId), "确认中...");
    return;
  }

  const visitId = target.dataset.completeVisit;
  if (visitId) {
    runInteraction(target, () => completeVisit(visitId), "完成中...");
    return;
  }

  const taskId = target.dataset.completeTask;
  if (taskId) {
    runInteraction(target, () => completeTask(taskId), "完成中...");
    return;
  }

  const medicationId = target.dataset.adjustMedication;
  if (medicationId) {
    runInteraction(target, () => adjustMedication(medicationId), "调整中...");
  }
});

document.addEventListener("submit", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLFormElement)) return;

  if (target.id === "subject-form") {
    event.preventDefault();
    runFormInteraction(target, () => createSubjectFromForm(target), "保存中...");
    return;
  }

  if (target.id === "doctor-create-patient-form") {
    event.preventDefault();
    runFormInteraction(target, () => createDoctorPatientFromForm(target), "建档中...");
    return;
  }

  if (target.dataset.uploadDocument) {
    event.preventDefault();
    runFormInteraction(target, () => uploadSubjectDocument(target), "上传中...");
    return;
  }

  if (target.id === "family-qa-form") {
    event.preventDefault();
    runFormInteraction(target, () => askFamilyQuestion(target), "生成中...");
    return;
  }

  if (target.id === "family-checkin-form") {
    event.preventDefault();
    runFormInteraction(target, () => submitFamilyCheckinRecord(target), "保存中...");
    return;
  }

  if (target.id === "family-feedback-form") {
    event.preventDefault();
    runFormInteraction(target, () => submitFamilyFeedback(target), "提交中...");
  }
});

document.addEventListener("change", (event) => {
  const target = event.target;

  if (target instanceof HTMLInputElement && target.id === "case-image-input") {
    applyMockCaseImageParse(target.files?.[0]);
    return;
  }

  if (!(target instanceof HTMLSelectElement)) return;

  if (target.id === "family-subject-select") {
    state.selectedFamilySubjectId = target.value;
    state.activeFamilyCheckinDate = null;
    refresh();
  }
});

document.querySelector("#dialog-close").addEventListener("click", () => dialog.close());
document.querySelector("#new-subject-button").addEventListener("click", () => {
  state.portal = "doctor";
  state.view = "subjects";
  render();
  document.querySelector("#subject-name")?.focus();
});
document.querySelector("#seed-button").addEventListener("click", () => {
  runInteraction(document.querySelector("#seed-button"), resetSeedData, "重置中...");
});

loadData()
  .then(render)
  .catch((error) => {
    app.innerHTML = `<section class="panel"><h2>加载失败</h2><p>${error.message}</p></section>`;
  });
