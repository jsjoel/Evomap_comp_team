import { createServer as createHttpServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "../..");
const webDir = path.join(rootDir, "apps/web-admin");
const seedPath = path.join(rootDir, "data/seed.json");
const runtimePath = path.join(rootDir, "data/runtime.json");
let runtimeStore;

const EVOMAP_PROTOCOL = "gep-a2a";
const EVOMAP_VERSION = "1.0.0";
const EVOMAP_BASE_URL = "https://evomap.ai";
const LLM_CHAT_COMPLETIONS_URL = process.env.EVOMAP_LLM_URL || "https://api.evomap.ai/v1/chat/completions";
const LLM_MODEL = process.env.EVOMAP_LLM_MODEL || "evomap-deepseek-v4-flash";

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

async function readSeed() {
  const raw = await readFile(seedPath, "utf8");
  return JSON.parse(raw);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export async function createTestStore() {
  return clone(await readSeed());
}

async function getRuntimeStore() {
  if (!runtimeStore) {
    try {
      const raw = await readFile(runtimePath, "utf8");
      runtimeStore = JSON.parse(raw);
    } catch {
      runtimeStore = await readSeed();
      await persistRuntimeStore(runtimeStore);
    }
  }
  return runtimeStore;
}

async function persistRuntimeStore(store) {
  await writeFile(runtimePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

async function resetRuntimeStore() {
  runtimeStore = await readSeed();
  await persistRuntimeStore(runtimeStore);
  return runtimeStore;
}

function nowIso() {
  return new Date().toISOString();
}

function nextNumber(items, prefix) {
  return (
    items.reduce((max, item) => {
      const value = Number(String(item.id).replace(`${prefix}-`, ""));
      return Number.isFinite(value) ? Math.max(max, value) : max;
    }, 0) + 1
  );
}

function nextId(items, prefix) {
  return `${prefix}-${String(nextNumber(items, prefix)).padStart(3, "0")}`;
}

function ensureStoreShape(seed) {
  seed.roles ??= ["doctor_admin", "family_member", "system_agent", "evomap_operator"];
  seed.carePlans ??= [];
  seed.reminders ??= [];
  seed.aiSuggestions ??= [];
  seed.familyConversations ??= [];
  seed.familyMemories ??= [];
  seed.familyFeedback ??= [];
  seed.familyCheckins ??= [];
  seed.evolutionEvents ??= [];
  seed.evomapNode ??= {
    nodeId: process.env.EVOMAP_NODE_ID || process.env.A2A_NODE_ID || null,
    status: "not_connected",
    hasSecret: Boolean(process.env.EVOMAP_NODE_SECRET || process.env.A2A_NODE_SECRET),
    lastSyncAt: null,
    lastError: null,
    lastValidationId: null
  };
}

function getSubject(seed, subjectId) {
  return seed.subjects.find((subject) => subject.id === subjectId);
}

function getSubjectName(seed, subjectId) {
  return getSubject(seed, subjectId)?.name ?? subjectId;
}

function addLocalLearningEvent(seed, summary, sourceType, targetId) {
  ensureStoreShape(seed);
  const event = {
    id: nextId(seed.evolutionEvents, "EVO"),
    type: "local_learning",
    summary,
    geneId: sourceType === "family_qa" ? "family-qa-risk-routing" : "doctor-ai-action-learning",
    capsuleId: sourceType === "family_qa" ? "capsule-family-qa-risk-routing" : "capsule-doctor-ai-action-learning",
    sourceType,
    targetId,
    status: "local_recorded",
    deidentified: true,
    createdAt: nowIso()
  };
  seed.evolutionEvents.unshift(event);
  return event;
}

function buildFamilyQaPrompts(seed, subject, carePlan) {
  const openReminder = seed.reminders.find((reminder) => reminder.subjectId === subject.id && reminder.status === "open");
  const basePrompts = [
    "复诊前需要记录什么？",
    "今天康复运动做到什么程度合适？",
    "饮食上家属要注意什么？",
    "哪些症状需要联系医生？",
    "用药后怎么观察不舒服？"
  ];
  const contextual = [
    openReminder ? `${openReminder.title}要怎么准备？` : null,
    carePlan?.symptomWatch?.length ? `出现${carePlan.symptomWatch[0]}要怎么记录？` : null,
    subject.nextVisitDate ? `${subject.nextVisitDate}复诊前要带什么？` : null
  ].filter(Boolean);
  const prompts = [...contextual, ...basePrompts];
  const offset = new Date().getMinutes() % prompts.length;
  return Array.from({ length: 3 }, (_, index) => prompts[(offset + index) % prompts.length]);
}

function getFamilyMemory(seed, subjectId) {
  return seed.familyMemories.find((memory) => memory.subjectId === subjectId) || null;
}

function updateFamilyMemory(seed, subjectId, route, provider) {
  let memory = getFamilyMemory(seed, subjectId);
  if (!memory) {
    memory = {
      id: nextId(seed.familyMemories, "MEM"),
      subjectId,
      summary: "家属关注康复记录、复诊准备和日常症状观察。",
      topics: [],
      highRiskCount: 0,
      lowRiskCount: 0,
      turnCount: 0,
      updatedAt: nowIso()
    };
    seed.familyMemories.unshift(memory);
  }

  memory.turnCount += 1;
  memory.highRiskCount += route === "doctor_contact" ? 1 : 0;
  memory.lowRiskCount += route === "rehab_education" ? 1 : 0;
  memory.topics = Array.from(new Set([...memory.topics, route === "doctor_contact" ? "高风险分流" : "康复教育", provider])).slice(0, 6);
  memory.summary =
    memory.highRiskCount > 0
      ? "家属既有康复教育问题，也出现过需要医生确认的高风险问题。"
      : "家属主要关注康复记录、饮食运动、复诊准备和日常观察。";
  memory.updatedAt = nowIso();
  return memory;
}

function getLlmApiKey() {
  return process.env.EVOMAP_LLM_API_KEY || process.env.OPENAI_API_KEY || "";
}

async function callChatCompletion(messages, fallback) {
  const apiKey = getLlmApiKey();
  if (!apiKey) {
    return {
      content: fallback,
      provider: "local_fallback",
      model: null
    };
  }

  try {
    const response = await fetch(LLM_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages,
        temperature: 0.2,
        max_tokens: 360
      })
    });

    if (!response.ok) {
      throw new Error(`LLM request failed with ${response.status}`);
    }

    const payload = await response.json();
    return {
      content: payload.choices?.[0]?.message?.content?.trim() || fallback,
      provider: "evomap_llm",
      model: LLM_MODEL
    };
  } catch {
    return {
      content: fallback,
      provider: "local_fallback",
      model: null
    };
  }
}

function recalculateMetrics(seed) {
  ensureStoreShape(seed);
  const subjectsTotal = seed.subjects.length;
  seed.metrics = {
    subjectsTotal,
    screening: seed.subjects.filter((subject) => subject.status === "待筛选").length,
    enrolled: seed.subjects.filter((subject) => subject.status === "已入组").length,
    followUp: seed.subjects.filter((subject) => subject.status === "随访中").length,
    openTasks: seed.tasks.filter((task) => task.status === "open").length,
    documentsPendingReview: seed.documents.filter((document) => ["待复核", "待确认", "处理中"].includes(document.status)).length,
    openReminders: seed.reminders.filter((reminder) => reminder.status === "open").length,
    candidateSuggestions: seed.aiSuggestions.filter((suggestion) => suggestion.status === "candidate").length
  };
}

function addAudit(seed, actor, action, target) {
  const log = {
    id: nextId(seed.auditLogs, "AUD"),
    actor,
    action,
    target,
    createdAt: nowIso()
  };
  seed.auditLogs.unshift(log);
  return log;
}

function createSubject(seed, body) {
  const subjectNumber = seed.subjects.length + 1;
  const subject = {
    id: nextId(seed.subjects, "SUBJ"),
    code: `S${String(subjectNumber).padStart(3, "0")}`,
    name: body.name?.trim() || `测试受试者${subjectNumber}`,
    sex: body.sex || "女",
    age: Number(body.age || 50),
    phone: body.phone || `1380000${String(2000 + subjectNumber).slice(-4)}`,
    site: body.site || "上海第一中心",
    status: "待筛选",
    risk: "attention",
    baselineDate: null,
    nextVisitDate: body.nextVisitDate || "2026-06-25",
    updatedAt: nowIso()
  };

  const document = {
    id: nextId(seed.documents, "DOC"),
    subjectId: subject.id,
    type: body.documentType || "门诊病历",
    fileName: body.fileName || `${subject.code}_medical_record.jpg`,
    status: "待确认",
    ocrStatus: "done",
    reviewer: null
  };

  const extraction = {
    id: nextId(seed.extractions, "EXT"),
    subjectId: subject.id,
    documentId: document.id,
    confidence: 0.83,
    status: "needs_review",
    fields: [
      {
        name: "诊断",
        value: body.diagnosis || "肺腺癌",
        confidence: 0.86,
        source: `${document.type}诊断段落`
      },
      {
        name: "ECOG评分",
        value: String(body.ecog || 1),
        confidence: 0.79,
        source: `${document.type}体格检查`
      },
      {
        name: "既往治疗",
        value: body.priorTreatment || "化疗1周期",
        confidence: 0.74,
        source: `${document.type}现病史`
      }
    ]
  };

  const visit = {
    id: nextId(seed.visits, "VIS"),
    subjectId: subject.id,
    code: "SCREEN",
    name: "筛选访视",
    plannedDate: subject.nextVisitDate,
    window: `${subject.nextVisitDate} ~ ${subject.nextVisitDate}`,
    status: "待执行",
    tasks: ["入排标准确认", "知情同意", "基线资料补全"]
  };

  const task = {
    id: nextId(seed.tasks, "TASK"),
    title: `确认${subject.name}${document.type}结构化结果`,
    type: "建档",
    subjectId: subject.id,
    owner: body.owner || "CRC 张琳",
    dueDate: body.dueDate || subject.nextVisitDate,
    priority: "high",
    status: "open"
  };

  const carePlan = {
    id: nextId(seed.carePlans, "PLAN"),
    subjectId: subject.id,
    summary: "筛选期基础康复教育与用药依从性观察",
    diet: "清淡高蛋白饮食，记录食欲和体重变化",
    exercise: "每日短时步行，避免疲劳后继续增加强度",
    symptomWatch: ["发热", "持续疼痛", "呼吸困难", "严重腹泻"],
    visitPreparation: ["携带既往检查报告", "记录近7天用药与症状"]
  };

  const reminder = {
    id: nextId(seed.reminders, "REM"),
    subjectId: subject.id,
    type: "visit",
    title: `${subject.name}筛选访视提醒`,
    dueAt: subject.nextVisitDate,
    channel: "family_h5",
    status: "open",
    source: "system"
  };

  seed.subjects.unshift(subject);
  seed.documents.unshift(document);
  seed.extractions.unshift(extraction);
  seed.visits.unshift(visit);
  seed.tasks.unshift(task);
  seed.carePlans.unshift(carePlan);
  seed.reminders.unshift(reminder);
  addAudit(seed, "CRC 张琳", "新建患者并生成AI抽取任务", subject.id);
  recalculateMetrics(seed);

  return {
    subject,
    document,
    extraction,
    visit,
    task,
    carePlan,
    reminder
  };
}

function importSubjects(seed, body) {
  const rows =
    body.rows?.length > 0
      ? body.rows
      : [
          { name: "孙丽", sex: "女", age: 49, site: "上海第一中心", diagnosis: "乳腺癌", documentType: "门诊病历" },
          { name: "吴鹏", sex: "男", age: 63, site: "苏州第二中心", diagnosis: "胃癌", documentType: "检查报告" },
          { name: "郑雨", sex: "女", age: 44, site: "杭州第三中心", diagnosis: "肺腺癌", documentType: "知情同意书" }
        ];
  const imported = rows.map((row) => createSubject(seed, row));

  addAudit(seed, "项目管理员", `批量导入${imported.length}名测试患者`, seed.study.id);
  recalculateMetrics(seed);

  return {
    statusCode: 201,
    payload: {
      importedCount: imported.length,
      subjects: imported.map((item) => item.subject),
      tasks: imported.map((item) => item.task)
    }
  };
}

function createExtractionForDocument(seed, subject, document, body = {}) {
  return {
    id: nextId(seed.extractions, "EXT"),
    subjectId: subject.id,
    documentId: document.id,
    confidence: Number(body.confidence || 0.83),
    status: "needs_review",
    fields: [
      {
        name: body.primaryFieldName || "诊断",
        value: body.primaryFieldValue || body.diagnosis || "肺腺癌",
        confidence: 0.86,
        source: `${document.type}诊断段落`
      },
      {
        name: "ECOG评分",
        value: String(body.ecog || 1),
        confidence: 0.79,
        source: `${document.type}体格检查`
      },
      {
        name: "既往治疗",
        value: body.priorTreatment || "化疗1周期",
        confidence: 0.74,
        source: `${document.type}现病史`
      }
    ]
  };
}

function addSubjectDocument(seed, subjectId, body) {
  const subject = seed.subjects.find((item) => item.id === subjectId);
  if (!subject) {
    return { statusCode: 404, payload: { error: "Subject not found" } };
  }

  const documentType = body.type || "门诊病历";
  const document = {
    id: nextId(seed.documents, "DOC"),
    subjectId: subject.id,
    type: documentType,
    fileName: body.fileName || `${subject.code}_${documentType}.pdf`,
    status: "待确认",
    ocrStatus: "done",
    reviewer: null
  };
  const extraction = createExtractionForDocument(seed, subject, document, body);
  const task = {
    id: nextId(seed.tasks, "TASK"),
    title: `复核${subject.name}${document.type}AI抽取字段`,
    type: "AI复核",
    subjectId: subject.id,
    owner: body.owner || "CRC 张琳",
    dueDate: body.dueDate || subject.nextVisitDate || "2026-06-25",
    priority: "high",
    status: "open"
  };

  subject.risk = "attention";
  subject.updatedAt = nowIso();
  seed.documents.unshift(document);
  seed.extractions.unshift(extraction);
  seed.tasks.unshift(task);
  addAudit(seed, "CRC 张琳", `上传${document.type}并生成AI复核任务`, subject.id);
  recalculateMetrics(seed);

  return {
    statusCode: 201,
    payload: {
      subject,
      document,
      extraction,
      task
    }
  };
}

function confirmExtraction(seed, id) {
  const extraction = seed.extractions.find((item) => item.id === id);
  if (!extraction) {
    return { statusCode: 404, payload: { error: "Extraction not found" } };
  }

  extraction.status = "confirmed";
  extraction.confirmedAt = nowIso();
  extraction.confirmedBy = "CRC 张琳";

  const document = seed.documents.find((item) => item.id === extraction.documentId);
  if (document) {
    document.status = "已确认";
    document.reviewer = "CRC 张琳";
  }

  const subject = seed.subjects.find((item) => item.id === extraction.subjectId);
  if (subject) {
    subject.status = subject.status === "待筛选" ? "已入组" : subject.status;
    subject.risk = "normal";
    subject.updatedAt = nowIso();
    subject.extractedFields = Object.fromEntries(extraction.fields.map((field) => [field.name, field.value]));
  }

  seed.tasks
    .filter((task) => task.subjectId === extraction.subjectId && ["AI复核", "建档"].includes(task.type))
    .forEach((task) => {
      task.status = "done";
      task.completedAt = nowIso();
    });

  addAudit(seed, "CRC 张琳", "确认AI抽取字段入档", extraction.subjectId);
  recalculateMetrics(seed);
  return { statusCode: 200, payload: extraction };
}

function updateVisit(seed, id, body) {
  const visit = seed.visits.find((item) => item.id === id);
  if (!visit) {
    return { statusCode: 404, payload: { error: "Visit not found" } };
  }

  visit.status = body.status || visit.status;
  visit.completedAt = visit.status === "已完成" ? nowIso() : visit.completedAt;

  const subject = seed.subjects.find((item) => item.id === visit.subjectId);
  if (subject) {
    subject.status = "随访中";
    subject.risk = "normal";
    subject.updatedAt = nowIso();
  }

  seed.tasks
    .filter((task) => task.subjectId === visit.subjectId && task.type === "访视")
    .forEach((task) => {
      task.status = visit.status === "已完成" ? "done" : task.status;
      task.completedAt = visit.status === "已完成" ? nowIso() : task.completedAt;
    });

  addAudit(seed, "CRC 张琳", `更新访视状态为${visit.status}`, visit.subjectId);
  recalculateMetrics(seed);
  return { statusCode: 200, payload: visit };
}

function updateTask(seed, id, body) {
  const task = seed.tasks.find((item) => item.id === id);
  if (!task) {
    return { statusCode: 404, payload: { error: "Task not found" } };
  }

  task.status = body.status || task.status;
  task.completedAt = task.status === "done" ? nowIso() : task.completedAt;
  addAudit(seed, "CRC 张琳", `更新任务状态为${task.status}`, task.id);
  recalculateMetrics(seed);
  return { statusCode: 200, payload: task };
}

function updateMedication(seed, id, body) {
  const medication = seed.medications.find((item) => item.id === id);
  if (!medication) {
    return { statusCode: 404, payload: { error: "Medication not found" } };
  }

  const previousDose = medication.dose;
  const weightKg = Number(body.weightKg || 60);
  const newDose = body.dose || (medication.dose.includes("mg/kg") ? `${(weightKg * 0.5).toFixed(1)}mg` : medication.dose);
  medication.dose = newDose;
  medication.status = body.status || "已调整";
  medication.adjustedAt = nowIso();
  medication.adjustmentReason = body.reason || `体重变化至${weightKg}kg`;
  medication.previousDose = previousDose;

  const subject = seed.subjects.find((item) => item.id === medication.subjectId);
  if (subject) {
    subject.risk = "warning";
    subject.updatedAt = nowIso();
  }

  const task = {
    id: nextId(seed.tasks, "TASK"),
    title: `复核${subject?.name ?? medication.subjectId}${medication.drug}用药调整`,
    type: "用药",
    subjectId: medication.subjectId,
    owner: body.owner || "研究护士 刘敏",
    dueDate: medication.nextDoseDate,
    priority: "normal",
    status: "open"
  };

  seed.tasks.unshift(task);
  addAudit(seed, "研究护士 刘敏", `调整用药剂量 ${previousDose} -> ${newDose}`, medication.subjectId);
  recalculateMetrics(seed);

  return {
    statusCode: 200,
    payload: {
      medication,
      task
    }
  };
}

function csvEscape(value) {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function exportSubjectsCsv(seed) {
  const headers = ["编号", "姓名", "性别", "年龄", "中心", "状态", "基线日期", "下次访视"];
  const rows = seed.subjects.map((subject) => [
    subject.code,
    subject.name,
    subject.sex,
    subject.age,
    subject.site,
    subject.status,
    subject.baselineDate ?? "",
    subject.nextVisitDate ?? ""
  ]);

  return [headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n");
}

function decorateBySubject(seed, items) {
  return items.map((item) => ({
    ...item,
    subjectName: item.subjectId ? getSubjectName(seed, item.subjectId) : item.subjectName
  }));
}

function buildDoctorDashboard(seed) {
  ensureStoreShape(seed);
  recalculateMetrics(seed);
  const openReminders = decorateBySubject(
    seed,
    seed.reminders.filter((reminder) => reminder.status === "open")
  );
  const pendingFeedback = decorateBySubject(
    seed,
    seed.familyFeedback.filter((feedback) => feedback.status !== "reviewed")
  );
  const pendingExtractions = decorateBySubject(
    seed,
    seed.extractions.filter((extraction) => extraction.status !== "confirmed")
  );
  const suggestions = decorateBySubject(seed, seed.aiSuggestions.slice(0, 12));

  return {
    tenant: seed.tenant,
    study: seed.study,
    metrics: seed.metrics,
    openReminders,
    pendingFeedback,
    pendingExtractions,
    suggestions,
    evomapNode: publicEvomapNode(seed)
  };
}

function suggestionExists(seed, subjectId, type) {
  return seed.aiSuggestions.some(
    (suggestion) => suggestion.subjectId === subjectId && suggestion.type === type && suggestion.status === "candidate"
  );
}

function generateDoctorSuggestions(seed) {
  ensureStoreShape(seed);
  const created = [];

  for (const reminder of seed.reminders.filter((item) => item.status === "open")) {
    if (suggestionExists(seed, reminder.subjectId, `reminder_${reminder.type}`)) continue;
    const suggestion = {
      id: nextId(seed.aiSuggestions, "AIS"),
      subjectId: reminder.subjectId,
      type: `reminder_${reminder.type}`,
      title: reminder.type === "medication" ? "用药依从性提醒" : reminder.type === "visit" ? "复诊风险提醒" : "康复跟进建议",
      summary: `${getSubjectName(seed, reminder.subjectId)}存在未完成${reminder.title}，建议医生确认后同步给家属。`,
      riskLevel: reminder.type === "medication" ? "medium" : "low",
      evidence: [`提醒 ${reminder.id}`, `截止 ${reminder.dueAt}`],
      status: "candidate",
      createdAt: nowIso(),
      createdBy: "system_agent"
    };
    seed.aiSuggestions.unshift(suggestion);
    created.push(suggestion);
  }

  for (const feedback of seed.familyFeedback.filter((item) => item.status !== "reviewed")) {
    if (suggestionExists(seed, feedback.subjectId, "family_feedback_followup")) continue;
    const suggestion = {
      id: nextId(seed.aiSuggestions, "AIS"),
      subjectId: feedback.subjectId,
      type: "family_feedback_followup",
      title: "家属反馈跟进建议",
      summary: `${getSubjectName(seed, feedback.subjectId)}有新的家属反馈，建议医生端查看依从性和症状变化。`,
      riskLevel: feedback.painScore >= 7 || Number(feedback.temperatureC) >= 38 ? "medium" : "low",
      evidence: [`反馈 ${feedback.id}`, `症状等级 ${feedback.painScore ?? "未填"}`],
      status: "candidate",
      createdAt: nowIso(),
      createdBy: "system_agent"
    };
    seed.aiSuggestions.unshift(suggestion);
    created.push(suggestion);
  }

  addAudit(seed, "AI分析服务", `生成${created.length}条医生端候选建议`, seed.study.id);
  recalculateMetrics(seed);
  return created;
}

function updateSuggestion(seed, id, body) {
  ensureStoreShape(seed);
  const suggestion = seed.aiSuggestions.find((item) => item.id === id);
  if (!suggestion) {
    return { statusCode: 404, payload: { error: "Suggestion not found" } };
  }

  const allowedStatuses = ["candidate", "accepted", "dismissed", "sent_to_family"];
  if (body.status && !allowedStatuses.includes(body.status)) {
    return { statusCode: 400, payload: { error: "Invalid suggestion status" } };
  }

  suggestion.status = body.status || suggestion.status;
  suggestion.updatedAt = nowIso();
  suggestion.reviewedBy = body.reviewedBy || "医生管理者";
  if (["accepted", "sent_to_family"].includes(suggestion.status)) {
    addLocalLearningEvent(seed, `Doctor action improved ${suggestion.type} workflow`, "doctor_ai", suggestion.id);
  }
  addAudit(seed, "医生管理者", `AI建议状态更新为${suggestion.status}`, suggestion.id);
  recalculateMetrics(seed);
  return { statusCode: 200, payload: suggestion };
}

function buildFamilyHome(seed, subjectId) {
  ensureStoreShape(seed);
  const subject = getSubject(seed, subjectId) ?? seed.subjects[0];
  if (!subject) {
    return { statusCode: 404, payload: { error: "Subject not found" } };
  }

  const carePlan = seed.carePlans.find((plan) => plan.subjectId === subject.id);
  const reminders = seed.reminders
    .filter((reminder) => reminder.subjectId === subject.id)
    .sort((a, b) => String(a.dueAt).localeCompare(String(b.dueAt)));
  const conversations = seed.familyConversations.filter((conversation) => conversation.subjectId === subject.id).slice(0, 8);
  const feedback = seed.familyFeedback.filter((item) => item.subjectId === subject.id).slice(0, 8);
  const familyMemory = getFamilyMemory(seed, subject.id);
  const qaPrompts = buildFamilyQaPrompts(seed, subject, carePlan);
  const today = new Date().toISOString().slice(0, 10);
  const checkin = seed.familyCheckins.find((item) => item.subjectId === subject.id && item.date === today);
  const monthStart = new Date(`${today.slice(0, 7)}-01T00:00:00.000Z`);
  const nextMonth = new Date(monthStart);
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  const monthDays = Math.round((nextMonth - monthStart) / 86400000);
  const checkinMonth = Array.from({ length: monthDays }, (_, index) => {
    const date = new Date(monthStart);
    date.setUTCDate(index + 1);
    const day = date.toISOString().slice(0, 10);
    const item = seed.familyCheckins.find((entry) => entry.subjectId === subject.id && entry.date === day);
    const isFuture = day > today;
    const isPast = day < today;
    return {
      date: day,
      day: index + 1,
      status: item?.status || (isFuture ? "future" : "open"),
      completedAt: item?.completedAt || null,
      note: item?.note || "",
      canCheckIn: day === today && item?.status !== "done",
      isPast,
      isToday: day === today
    };
  });
  const rehabAdvice = carePlan
    ? {
        date: today,
        title: "今日康复打卡",
        task: carePlan.exercise,
        advice: `${carePlan.diet}；观察${carePlan.symptomWatch.slice(0, 2).join("、")}。`,
        status: checkin?.status || "open",
        completedAt: checkin?.completedAt || null
      }
    : {
        date: today,
        title: "今日康复打卡",
        task: "完成一次轻量活动并记录身体状态",
        advice: "保持规律饮食，观察体温、疼痛和精神状态。",
        status: checkin?.status || "open",
        completedAt: checkin?.completedAt || null
      };

  return {
    statusCode: 200,
    payload: {
      subject: {
        id: subject.id,
        code: subject.code,
        displayName: `${subject.name.slice(0, 1)}女士/先生`,
        nextVisitDate: subject.nextVisitDate,
        status: subject.status
      },
      carePlan,
      rehabAdvice,
      checkinMonth,
      qaPrompts,
      familyMemory,
      reminders,
      conversations,
      feedback
    }
  };
}

function createFamilyCheckin(seed, body) {
  ensureStoreShape(seed);
  const subjectId = body.subjectId || seed.subjects[0]?.id;
  const subject = getSubject(seed, subjectId);
  if (!subject) {
    return { statusCode: 404, payload: { error: "Subject not found" } };
  }

  const today = new Date().toISOString().slice(0, 10);
  const date = String(body.date || today);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { statusCode: 400, payload: { error: "Invalid checkin date" } };
  }
  if (date !== today) {
    return { statusCode: 400, payload: { error: "Only today's checkin is allowed" } };
  }
  let checkin = seed.familyCheckins.find((item) => item.subjectId === subjectId && item.date === date);
  if (!checkin) {
    checkin = {
      id: nextId(seed.familyCheckins, "CHK"),
      subjectId,
      date,
      title: body.title || "今日康复打卡",
      task: body.task || "完成今日康复任务",
      note: String(body.note || "").slice(0, 160),
      status: "done",
      completedAt: nowIso()
    };
    seed.familyCheckins.unshift(checkin);
  } else {
    if (checkin.status === "done") {
      return { statusCode: 200, payload: { ...checkin, alreadyCompleted: true } };
    }
    checkin.status = "done";
    checkin.note = String(body.note || checkin.note || "").slice(0, 160);
    checkin.completedAt = nowIso();
  }

  addAudit(seed, "家属端H5", date === today ? "完成今日康复打卡" : "补记康复打卡", subjectId);
  return { statusCode: 201, payload: checkin };
}

function isHighRiskQuestion(question) {
  return /停药|换药|加量|减量|诊断|是不是癌|急救|胸痛|呼吸困难|昏迷|大出血|严重|抽搐|高烧|持续发热|处方|能不能吃药/.test(question);
}

async function answerFamilyQuestion(seed, body) {
  ensureStoreShape(seed);
  const subjectId = body.subjectId || seed.subjects[0]?.id;
  const subject = getSubject(seed, subjectId);
  if (!subject) {
    return { statusCode: 404, payload: { error: "Subject not found" } };
  }

  const question = String(body.question || "").trim();
  if (!question) {
    return { statusCode: 400, payload: { error: "Question is required" } };
  }

  const highRisk = isHighRiskQuestion(question);
  const fallbackAnswer = highRisk
    ? "这个问题可能涉及诊断、处方调整或急性风险，请联系主管医生；如出现呼吸困难、胸痛、意识异常、持续高热等情况，请及时就医。仅作康复教育与提醒，不替代医生诊疗。"
    : "可以优先记录症状变化、体温、疼痛评分和用药完成情况，并按康复计划保持规律饮食、轻量活动与复诊准备。仅作康复教育与提醒，不替代医生诊疗。";
  const carePlan = seed.carePlans.find((plan) => plan.subjectId === subjectId);
  const previousTurns = seed.familyConversations
    .filter((conversation) => conversation.subjectId === subjectId)
    .slice(0, 4)
    .reverse();
  const familyMemory = getFamilyMemory(seed, subjectId);
  const llmResult = highRisk
    ? { content: fallbackAnswer, provider: "local_safety_guard", model: null }
    : await callChatCompletion(
        [
          {
            role: "system",
            content:
              "你是家属端康复教育助手。只回答低风险康复教育、提醒和复诊准备。不要诊断，不要调整处方，不替代医生。回答要简短、具体、中文，并以免责声明结尾。"
          },
          {
            role: "user",
            content: JSON.stringify({
              question,
              patientStatus: subject.status,
              nextVisitDate: subject.nextVisitDate,
              memorySummary: familyMemory?.summary || "暂无历史记忆",
              recentTurns: previousTurns.map((turn) => ({
                question: turn.question,
                answer: turn.answer,
                route: turn.riskRoute
              })),
              carePlan: carePlan
                ? {
                    diet: carePlan.diet,
                    exercise: carePlan.exercise,
                    symptomWatch: carePlan.symptomWatch,
                    visitPreparation: carePlan.visitPreparation
                  }
                : null
            })
          }
        ],
        fallbackAnswer
      );
  const answer = llmResult.content.includes("不替代医生") ? llmResult.content : `${llmResult.content} 仅作康复教育与提醒，不替代医生诊疗。`;
  const memory = updateFamilyMemory(seed, subjectId, highRisk ? "doctor_contact" : "rehab_education", llmResult.provider);

  const conversation = {
    id: nextId(seed.familyConversations, "FQA"),
    subjectId,
    threadId: body.threadId || `family-${subjectId}`,
    turnIndex: memory.turnCount,
    question,
    answer,
    riskRoute: highRisk ? "doctor_contact" : "rehab_education",
    answerProvider: llmResult.provider,
    model: llmResult.model,
    memoryId: memory.id,
    memorySummary: memory.summary,
    createdAt: nowIso(),
    storedLocally: true
  };
  seed.familyConversations.unshift(conversation);
  addLocalLearningEvent(
    seed,
    highRisk ? "Family QA high-risk route triggered doctor guidance" : "Family QA rehab education turn updated memory",
    "family_qa",
    conversation.id
  );
  addAudit(seed, "家属端H5", highRisk ? "家属问答触发高风险分流" : "家属问答返回康复教育", subjectId);

  return {
    statusCode: 201,
    payload: {
      ...conversation,
      familyMemory: memory
    }
  };
}

function createFamilyFeedback(seed, body) {
  ensureStoreShape(seed);
  const subjectId = body.subjectId || seed.subjects[0]?.id;
  const subject = getSubject(seed, subjectId);
  if (!subject) {
    return { statusCode: 404, payload: { error: "Subject not found" } };
  }

  const feedback = {
    id: nextId(seed.familyFeedback, "FBK"),
    subjectId,
    symptoms: String(body.symptoms || "无特殊不适").slice(0, 160),
    temperatureC: body.temperatureC === "" || body.temperatureC == null ? null : Number(body.temperatureC),
    painScore: body.painScore === "" || body.painScore == null ? null : Number(body.painScore),
    medicationTaken: body.medicationTaken === true || body.medicationTaken === "true",
    question: String(body.question || "").slice(0, 160),
    status: "new",
    createdAt: nowIso()
  };
  seed.familyFeedback.unshift(feedback);
  addAudit(seed, "家属端H5", "提交症状与依从性反馈", subjectId);
  recalculateMetrics(seed);
  return { statusCode: 201, payload: feedback };
}

function updateReminder(seed, id, body) {
  ensureStoreShape(seed);
  const reminder = seed.reminders.find((item) => item.id === id);
  if (!reminder) {
    return { statusCode: 404, payload: { error: "Reminder not found" } };
  }

  reminder.status = body.status || reminder.status;
  reminder.completedAt = reminder.status === "done" ? nowIso() : reminder.completedAt;
  reminder.updatedAt = nowIso();
  addAudit(seed, body.actor || "系统", `更新提醒状态为${reminder.status}`, reminder.id);
  recalculateMetrics(seed);
  return { statusCode: 200, payload: reminder };
}

function publicEvomapNode(seed) {
  ensureStoreShape(seed);
  const hasSecret = Boolean(process.env.EVOMAP_NODE_SECRET || process.env.A2A_NODE_SECRET || seed.evomapNode.hasSecret);
  return {
    nodeId: seed.evomapNode.nodeId || process.env.EVOMAP_NODE_ID || process.env.A2A_NODE_ID || null,
    status: seed.evomapNode.status || "not_connected",
    hasSecret,
    lastSyncAt: seed.evomapNode.lastSyncAt || null,
    lastError: seed.evomapNode.lastError || null,
    lastValidationId: seed.evomapNode.lastValidationId || null
  };
}

function buildA2AEnvelope(messageType, payload, senderId = "local-evomap-mvp") {
  return {
    protocol: EVOMAP_PROTOCOL,
    version: EVOMAP_VERSION,
    message_type: messageType,
    sender: {
      node_id: senderId
    },
    trace_id: `trace-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    timestamp: nowIso(),
    payload
  };
}

function stringifyPayload(value) {
  return JSON.stringify(value ?? {});
}

function findPrivacyViolations(seed, payload) {
  const text = stringifyPayload(payload);
  const subjectTerms = seed.subjects.flatMap((subject) => [subject.name, subject.phone, subject.code]).filter(Boolean);
  const patterns = [
    { label: "手机号", pattern: /1[3-9]\d{9}/ },
    { label: "身份证号", pattern: /\d{17}[\dXx]/ },
    { label: "病历文件名", pattern: /\bS\d{3}_[A-Za-z0-9_-]+\.(?:jpg|jpeg|png|pdf)\b/i }
  ];
  const violations = [];
  for (const term of subjectTerms) {
    if (text.includes(term)) {
      violations.push(`包含患者标识：${term}`);
    }
  }
  for (const item of patterns) {
    if (item.pattern.test(text)) {
      violations.push(`包含${item.label}`);
    }
  }
  if (payload?.rawQuestion || payload?.question || payload?.conversationText || payload?.medicalRecordText) {
    violations.push("包含自由文本问答或病历原文");
  }
  return violations;
}

function sanitizeEvolutionBundle(seed, body) {
  const bundle = {
    bundleId: body.bundleId || `EVB-${Date.now()}`,
    gene: {
      id: body.gene?.id || "family-qa-risk-routing",
      summary: body.gene?.summary || "Route high-risk family QA to doctor contact guidance",
      tags: body.gene?.tags || ["family-h5", "risk-routing", "deidentified"]
    },
    capsule: {
      id: body.capsule?.id || "capsule-family-qa-risk-routing",
      summary: body.capsule?.summary || "Added high-risk keyword routing and local API tests",
      evidence: body.capsule?.evidence || ["family QA high-risk question now routes to doctor"],
      deidentified: true
    },
    evolutionEvent: {
      id: body.evolutionEvent?.id || nextId(seed.evolutionEvents, "EVO"),
      summary: body.evolutionEvent?.summary || "family QA high-risk question now routes to doctor",
      result: body.evolutionEvent?.result || "local_validation_ready",
      createdAt: nowIso()
    }
  };
  const violations = findPrivacyViolations(seed, bundle);
  if (violations.length) {
    return { ok: false, violations };
  }
  return { ok: true, bundle };
}

function evomapHello(seed, body) {
  ensureStoreShape(seed);
  const node = publicEvomapNode(seed);
  const nodeId = body.nodeId || node.nodeId || "local-evomap-mvp";
  const envelope = buildA2AEnvelope("hello", {
    node_id: nodeId,
    client: "evomap-medical-rehab-mvp",
    capabilities: ["memory.record", "memory.recall", "validate", "publish"],
    safety: {
      phi_upload: false,
      heartbeat_auto: false,
      claim_task_auto: false,
      credit_spending_auto: false
    }
  }, nodeId);

  seed.evomapNode.nodeId = nodeId;
  seed.evomapNode.status = node.hasSecret ? "prepared" : "secret_missing";
  seed.evomapNode.hasSecret = node.hasSecret;
  seed.evomapNode.lastSyncAt = nowIso();
  seed.evomapNode.lastError = node.hasSecret ? null : "secret missing; request prepared locally only";
  addAudit(seed, "EvoMap操作员", "准备EvoMap hello envelope", seed.evomapNode.nodeId);

  return {
    statusCode: 200,
    payload: {
      endpoint: `${EVOMAP_BASE_URL}/a2a/hello`,
      envelope,
      node: publicEvomapNode(seed)
    }
  };
}

function recordEvolutionMemory(seed, body) {
  ensureStoreShape(seed);
  const { ok, bundle, violations } = sanitizeEvolutionBundle(seed, body);
  if (!ok) {
    return { statusCode: 400, payload: { error: "Payload contains prohibited PHI", violations } };
  }
  const event = {
    id: nextId(seed.evolutionEvents, "EVO"),
    type: "memory_record",
    summary: bundle.evolutionEvent.summary,
    geneId: bundle.gene.id,
    capsuleId: bundle.capsule.id,
    status: "local_recorded",
    deidentified: true,
    createdAt: nowIso()
  };
  seed.evolutionEvents.unshift(event);
  addAudit(seed, "EvoMap操作员", "记录本地脱敏自进化经验", event.id);
  return {
    statusCode: 201,
    payload: {
      event,
      endpoint: `${EVOMAP_BASE_URL}/a2a/memory/record`,
      envelope: buildA2AEnvelope("memory.record", bundle, publicEvomapNode(seed).nodeId || "local-evomap-mvp")
    }
  };
}

function recallEvolutionMemory(seed, body) {
  ensureStoreShape(seed);
  const query = String(body.query || "family qa risk routing").toLowerCase();
  const matches = seed.evolutionEvents
    .filter((event) => stringifyPayload(event).toLowerCase().includes(query.split(/\s+/)[0]))
    .slice(0, 5);
  return {
    statusCode: 200,
    payload: {
      matches,
      endpoint: `${EVOMAP_BASE_URL}/a2a/memory/recall`,
      envelope: buildA2AEnvelope("memory.recall", { query, phi_upload: false }, publicEvomapNode(seed).nodeId || "local-evomap-mvp")
    }
  };
}

function validateEvolutionBundle(seed, body) {
  ensureStoreShape(seed);
  const { ok, bundle, violations } = sanitizeEvolutionBundle(seed, body);
  if (!ok) {
    seed.evomapNode.lastValidationId = null;
    seed.evomapNode.lastError = violations.join("; ");
    return { statusCode: 400, payload: { error: "Payload contains prohibited PHI", violations } };
  }
  seed.evomapNode.lastValidationId = bundle.bundleId;
  seed.evomapNode.lastError = null;
  const event = {
    id: nextId(seed.evolutionEvents, "EVO"),
    type: "validate",
    summary: `Validated deidentified capsule ${bundle.capsule.id}`,
    geneId: bundle.gene.id,
    capsuleId: bundle.capsule.id,
    bundleId: bundle.bundleId,
    status: "validated",
    deidentified: true,
    createdAt: nowIso()
  };
  seed.evolutionEvents.unshift(event);
  addAudit(seed, "EvoMap操作员", "验证脱敏Gene/Capsule", event.id);
  return {
    statusCode: 200,
    payload: {
      ok: true,
      event,
      endpoint: `${EVOMAP_BASE_URL}/a2a/validate`,
      envelope: buildA2AEnvelope("validate", bundle, publicEvomapNode(seed).nodeId || "local-evomap-mvp")
    }
  };
}

function publishEvolutionBundle(seed, body) {
  ensureStoreShape(seed);
  const { ok, bundle, violations } = sanitizeEvolutionBundle(seed, body);
  if (!ok) {
    return { statusCode: 400, payload: { error: "Payload contains prohibited PHI", violations } };
  }
  if (seed.evomapNode.lastValidationId !== bundle.bundleId) {
    return {
      statusCode: 409,
      payload: {
        error: "Publish requires successful validate first",
        requiredBundleId: bundle.bundleId,
        lastValidationId: seed.evomapNode.lastValidationId || null
      }
    };
  }
  const event = {
    id: nextId(seed.evolutionEvents, "EVO"),
    type: "publish",
    summary: `Prepared deidentified capsule publish ${bundle.capsule.id}`,
    geneId: bundle.gene.id,
    capsuleId: bundle.capsule.id,
    bundleId: bundle.bundleId,
    status: "publish_ready",
    deidentified: true,
    createdAt: nowIso()
  };
  seed.evolutionEvents.unshift(event);
  addAudit(seed, "EvoMap操作员", "发布前准备脱敏Capsule", event.id);
  return {
    statusCode: 200,
    payload: {
      ok: true,
      event,
      endpoint: `${EVOMAP_BASE_URL}/a2a/publish`,
      envelope: buildA2AEnvelope("publish", bundle, publicEvomapNode(seed).nodeId || "local-evomap-mvp")
    }
  };
}

function buildQualitySummary(seed) {
  ensureStoreShape(seed);
  const pendingDocuments = seed.documents
    .filter((document) => ["待复核", "待确认", "处理中"].includes(document.status))
    .map((document) => ({
      ...document,
      subjectName: getSubjectName(seed, document.subjectId)
    }));
  const pendingExtractions = seed.extractions
    .filter((extraction) => extraction.status !== "confirmed")
    .map((extraction) => ({
      ...extraction,
      subjectName: getSubjectName(seed, extraction.subjectId)
    }));
  const openTasks = seed.tasks
    .filter((task) => task.status === "open")
    .map((task) => ({
      ...task,
      subjectName: getSubjectName(seed, task.subjectId)
    }));
  const familyFeedback = decorateBySubject(seed, seed.familyFeedback.slice(0, 20));
  const aiSuggestions = decorateBySubject(seed, seed.aiSuggestions.slice(0, 20));

  return {
    counters: {
      pendingDocuments: pendingDocuments.length,
      pendingExtractions: pendingExtractions.length,
      openTasks: openTasks.length,
      auditLogs: seed.auditLogs.length,
      familyFeedback: seed.familyFeedback.length,
      aiSuggestions: seed.aiSuggestions.length,
      evolutionEvents: seed.evolutionEvents.length
    },
    pendingDocuments,
    pendingExtractions,
    openTasks,
    familyFeedback,
    aiSuggestions,
    evolutionEvents: seed.evolutionEvents.slice(0, 20),
    auditLogs: seed.auditLogs.slice(0, 30)
  };
}

export async function resolveApi(pathname, options = {}) {
  const seed = options.store ?? (await readSeed());
  ensureStoreShape(seed);
  const method = options.method ?? "GET";
  const body = options.body ?? {};
  const url = new URL(pathname, "http://localhost");
  const segments = url.pathname.split("/").filter(Boolean);
  const resource = segments[1];
  const id = segments[2];
  const action = segments[3];

  if (url.pathname === "/api/health") {
    return { statusCode: 200, payload: { ok: true, service: "evomap-mvp-api" } };
  }

  if (method === "POST" && url.pathname === "/api/admin/reset") {
    const nextStore = options.persist ? await resetRuntimeStore() : await readSeed();
    if (options.store) {
      Object.keys(options.store).forEach((key) => delete options.store[key]);
      Object.assign(options.store, clone(nextStore));
    }
    return { statusCode: 200, payload: { ok: true } };
  }

  if (method === "GET" && url.pathname === "/api/exports/subjects.csv") {
    return {
      statusCode: 200,
      payload: exportSubjectsCsv(seed),
      contentType: "text/csv; charset=utf-8"
    };
  }

  if (method === "GET" && url.pathname === "/api/quality") {
    recalculateMetrics(seed);
    return { statusCode: 200, payload: buildQualitySummary(seed) };
  }

  if (method === "GET" && url.pathname === "/api/doctor/dashboard") {
    return { statusCode: 200, payload: buildDoctorDashboard(seed) };
  }

  if (method === "POST" && url.pathname === "/api/doctor/ai/analyze") {
    const suggestions = generateDoctorSuggestions(seed);
    return {
      statusCode: 201,
      payload: {
        createdCount: suggestions.length,
        suggestions: decorateBySubject(seed, suggestions),
        dashboard: buildDoctorDashboard(seed)
      }
    };
  }

  if (method === "PATCH" && resource === "doctor" && id === "suggestions" && action) {
    return updateSuggestion(seed, action, body);
  }

  if (method === "GET" && url.pathname === "/api/family/home") {
    return buildFamilyHome(seed, url.searchParams.get("subjectId"));
  }

  if (method === "POST" && url.pathname === "/api/family/qa") {
    return answerFamilyQuestion(seed, body);
  }

  if (method === "POST" && url.pathname === "/api/family/feedback") {
    return createFamilyFeedback(seed, body);
  }

  if (method === "POST" && url.pathname === "/api/family/checkin") {
    return createFamilyCheckin(seed, body);
  }

  if (method === "PATCH" && resource === "reminders" && id) {
    return updateReminder(seed, id, body);
  }

  if (method === "POST" && url.pathname === "/api/evomap/hello") {
    return evomapHello(seed, body);
  }

  if (method === "POST" && url.pathname === "/api/evomap/memory/record") {
    return recordEvolutionMemory(seed, body);
  }

  if (method === "POST" && url.pathname === "/api/evomap/memory/recall") {
    return recallEvolutionMemory(seed, body);
  }

  if (method === "POST" && url.pathname === "/api/evomap/validate") {
    return validateEvolutionBundle(seed, body);
  }

  if (method === "POST" && url.pathname === "/api/evomap/publish") {
    return publishEvolutionBundle(seed, body);
  }

  if (method === "POST" && resource === "subjects" && !id) {
    return { statusCode: 201, payload: createSubject(seed, body) };
  }

  if (method === "POST" && resource === "imports" && id === "subjects") {
    return importSubjects(seed, body);
  }

  if (method === "POST" && resource === "subjects" && id && action === "documents") {
    return addSubjectDocument(seed, id, body);
  }

  if (method === "POST" && resource === "extractions" && id && action === "confirm") {
    return confirmExtraction(seed, id);
  }

  if (method === "PATCH" && resource === "visits" && id) {
    return updateVisit(seed, id, body);
  }

  if (method === "PATCH" && resource === "tasks" && id) {
    return updateTask(seed, id, body);
  }

  if (method === "PATCH" && resource === "medications" && id) {
    return updateMedication(seed, id, body);
  }

  if (url.pathname === "/api/dashboard") {
    recalculateMetrics(seed);
    return {
      statusCode: 200,
      payload: {
        tenant: seed.tenant,
        study: seed.study,
        metrics: seed.metrics,
        recentTasks: seed.tasks.slice(0, 4),
        auditLogs: seed.auditLogs
      }
    };
  }

  if (resource === "subjects" && !id) {
    return { statusCode: 200, payload: seed.subjects };
  }

  if (resource === "subjects" && id) {
    const subject = seed.subjects.find((item) => item.id === id);
    if (!subject) {
      return { statusCode: 404, payload: { error: "Not found" } };
    }

    return {
      statusCode: 200,
      payload: {
        ...subject,
        documents: seed.documents.filter((item) => item.subjectId === id),
        extractions: seed.extractions.filter((item) => item.subjectId === id),
        visits: seed.visits.filter((item) => item.subjectId === id),
        medications: seed.medications.filter((item) => item.subjectId === id),
        tasks: seed.tasks.filter((item) => item.subjectId === id),
        carePlan: seed.carePlans.find((item) => item.subjectId === id) ?? null,
        reminders: seed.reminders.filter((item) => item.subjectId === id),
        familyFeedback: seed.familyFeedback.filter((item) => item.subjectId === id),
        aiSuggestions: seed.aiSuggestions.filter((item) => item.subjectId === id)
      }
    };
  }

  if (
    [
      "documents",
      "extractions",
      "visits",
      "medications",
      "tasks",
      "auditLogs",
      "carePlans",
      "reminders",
      "aiSuggestions",
      "familyConversations",
      "familyMemories",
      "familyFeedback",
      "familyCheckins",
      "evolutionEvents"
    ].includes(resource)
  ) {
    return { statusCode: 200, payload: seed[resource] ?? [] };
  }

  return { statusCode: 404, payload: { error: "Not found" } };
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function notFound(res) {
  sendJson(res, 404, { error: "Not found" });
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  if (!chunks.length) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function handleApi(req, res, url) {
  const store = await getRuntimeStore();
  const body = ["POST", "PATCH", "PUT"].includes(req.method ?? "") ? await readJsonBody(req) : {};
  const result = await resolveApi(`${url.pathname}${url.search}`, {
    method: req.method,
    body,
    store,
    persist: true
  });
  if (["POST", "PATCH", "PUT"].includes(req.method ?? "") && result.statusCode < 400 && url.pathname !== "/api/admin/reset") {
    await persistRuntimeStore(store);
  }

  if (result.contentType) {
    res.writeHead(result.statusCode, {
      "content-type": result.contentType,
      "cache-control": "no-store"
    });
    res.end(result.payload);
    return;
  }
  sendJson(res, result.statusCode, result.payload);
}

async function handleStatic(req, res, url) {
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const requested = path.normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(webDir, requested);

  if (!filePath.startsWith(webDir)) {
    notFound(res);
    return;
  }

  try {
    const body = await readFile(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, {
      "content-type": contentTypes[ext] ?? "application/octet-stream"
    });
    res.end(body);
  } catch {
    notFound(res);
  }
}

export function createServer() {
  return createHttpServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    try {
      if (url.pathname.startsWith("/api/")) {
        await handleApi(req, res, url);
        return;
      }
      await handleStatic(req, res, url);
    } catch (error) {
      sendJson(res, 500, {
        error: "Internal server error",
        detail: error instanceof Error ? error.message : String(error)
      });
    }
  });
}

if (process.argv[1] === __filename) {
  const port = Number(process.env.PORT ?? 4173);
  createServer().listen(port, "127.0.0.1", () => {
    console.log(`EvoMap MVP is running at http://localhost:${port}`);
  });
}
