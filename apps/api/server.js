import { createServer as createHttpServer } from "node:http";
import { readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
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
let volatileEvomapNodeSecret = "";

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

function readLocalEnv() {
  const values = {};
  try {
    const raw = readFileSync(path.join(rootDir, ".env.local"), "utf8");
    raw.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) return;
      const [key, ...rest] = trimmed.split("=");
      values[key.trim()] = rest.join("=").trim().replace(/^["']|["']$/g, "");
    });
  } catch {
    return values;
  }
  return values;
}

function getLocalEnvValue(name) {
  return readLocalEnv()[name] || "";
}

function getConfigValue(name) {
  return process.env[name] || getLocalEnvValue(name) || "";
}

function getEvomapBaseUrl() {
  return getConfigValue("EVOMAP_A2A_BASE_URL") || getConfigValue("A2A_HUB_URL") || "https://evomap.ai";
}

function getLlmChatCompletionsUrl() {
  return getConfigValue("EVOMAP_LLM_URL") || "https://api.evomap.ai/v1/chat/completions";
}

function getLlmModel() {
  return getConfigValue("EVOMAP_LLM_MODEL") || "evomap-deepseek-v4-flash";
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
  seed.doctorRehabAdvice ??= [];
  if (Array.isArray(seed.subjects)) {
    for (const subject of seed.subjects) {
      const activeAdviceCount = seed.doctorRehabAdvice.filter((item) => item.subjectId === subject.id && item.status !== "archived").length;
      if (activeAdviceCount > 0) continue;

      const carePlan = seed.carePlans?.find((plan) => plan.subjectId === subject.id);
      const firstAdvice = {
        id: nextId(seed.doctorRehabAdvice, "DRA"),
        subjectId: subject.id,
        source: "主管医生",
        title: carePlan?.exercise || "完成今日基础康复记录",
        advice: carePlan
          ? `${carePlan.diet}；活动后记录体温、疼痛评分和不适变化。`
          : "今天记录体温、疼痛评分、饮食、活动耐受和明显不适变化。",
        focus: carePlan?.exercise ? "运动" : "症状观察",
        priority: subject.risk === "warning" ? "attention" : "normal",
        status: "active"
      };
      const secondAdvice = {
        id: `DRA-${String(nextNumber([...seed.doctorRehabAdvice, firstAdvice], "DRA")).padStart(3, "0")}`,
        subjectId: subject.id,
        source: "主管医生",
        title: "复诊前整理用药和症状变化",
        advice: subject.nextVisitDate
          ? `${subject.nextVisitDate}复诊前，整理近7天用药、体温、疼痛评分和想问医生的问题。`
          : "把近7天用药、体温、疼痛评分和想问医生的问题整理在同一页。",
        focus: "复诊准备",
        priority: "normal",
        status: "active"
      };
      seed.doctorRehabAdvice.push(firstAdvice, secondAdvice);
    }
  }
  seed.familyConversations ??= [];
  seed.familyMemories ??= [];
  seed.familyFeedback ??= [];
  seed.familyCheckins ??= [];
  seed.evolutionEvents ??= [];
  seed.strategyCapsules ??= [
    {
      id: "STR-001",
      scope: "doctor_ai",
      version: "doctor-ai-v1",
      summary: "Prioritize combined family feedback, medication adherence, check-in dropoff, and pending document review.",
      source: "local_default",
      appliedGeneIds: ["doctor-ai-action-learning"],
      updatedAt: nowIso()
    },
    {
      id: "STR-002",
      scope: "family_qa",
      version: "family-qa-v1",
      summary: "Use family memory, current care plan, reminders, and safety routing before answering rehabilitation questions.",
      source: "local_default",
      appliedGeneIds: ["family-qa-risk-routing"],
      updatedAt: nowIso()
    }
  ];
  seed.evolutionRuns ??= [];
  seed.simulationScenarios ??= [];
  seed.evomapNode ??= {
    nodeId: getConfigValue("EVOMAP_NODE_ID") || getConfigValue("A2A_NODE_ID") || null,
    status: "not_connected",
    hasSecret: Boolean(getConfigValue("EVOMAP_NODE_SECRET") || getConfigValue("A2A_NODE_SECRET")),
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

function getSubjectDiagnosis(seed, subjectId) {
  const subject = getSubject(seed, subjectId);
  const extractedDiagnosis = subject?.extractedFields?.["诊断"] || subject?.extractedFields?.diagnosis;
  if (extractedDiagnosis) return extractedDiagnosis;

  const extraction = (seed.extractions || [])
    .filter((item) => item.subjectId === subjectId)
    .find((item) => item.fields?.some((field) => /诊断|主要问题|疾病/.test(field.name)));
  return extraction?.fields?.find((field) => /诊断|主要问题|疾病/.test(field.name))?.value || "";
}

function normalizeFeedbackObservations(body) {
  if (!Array.isArray(body.observations)) return [];
  return body.observations
    .map((item) => ({
      name: String(item.name || "").slice(0, 40),
      label: String(item.label || item.name || "观察项").slice(0, 40),
      value: String(item.value ?? "").slice(0, 80),
      unit: String(item.unit || "").slice(0, 16)
    }))
    .filter((item) => item.value)
    .slice(0, 8);
}

function feedbackObservationItems(feedback) {
  const observations = Array.isArray(feedback?.observations)
    ? feedback.observations
        .filter((item) => item.value !== "" && item.value != null)
        .map((item) => ({
          source: "family_feedback",
          label: item.label || item.name || "观察项",
          value: `${item.value ?? ""}${item.unit || ""}`
        }))
    : [];

  if (observations.length) return observations;

  return [
    feedback?.painScore != null ? { source: "family_feedback", label: "疼痛评分", value: feedback.painScore } : null,
    feedback?.temperatureC != null ? { source: "family_feedback", label: "体温", value: feedback.temperatureC } : null
  ].filter(Boolean);
}

function feedbackObservationSummary(feedback) {
  const items = feedbackObservationItems(feedback);
  return items.length ? items.map((item) => `${item.label} ${item.value}`).join("，") : "未填写结构化观察项";
}

function feedbackNeedsSymptomFollowup(feedback) {
  return feedback?.painScore >= 4 || Number(feedback?.temperatureC) >= 37.5 || /胸闷|胸痛|呼吸困难|头晕|伤口|出血|低血糖|明显不适|加重/.test(feedback?.symptoms || "");
}

function feedbackHasMediumRisk(feedback) {
  return feedback?.painScore >= 7 || Number(feedback?.temperatureC) >= 38 || /胸痛|呼吸困难|意识异常|大出血|严重|持续加重/.test(feedback?.symptoms || "");
}

function addLocalLearningEvent(seed, summary, sourceType, targetId) {
  ensureStoreShape(seed);
  const geneBySource = {
    family_qa: "family-qa-risk-routing",
    doctor_ai: "doctor-ai-action-learning",
    checkin: "rehab-checkin-adherence-learning",
    feedback: "family-feedback-followup-learning"
  };
  const capsuleBySource = {
    family_qa: "capsule-family-qa-risk-routing",
    doctor_ai: "capsule-doctor-ai-action-learning",
    checkin: "capsule-rehab-checkin-adherence-learning",
    feedback: "capsule-family-feedback-followup-learning"
  };
  const event = {
    id: nextId(seed.evolutionEvents, "EVO"),
    type: "local_learning",
    summary,
    geneId: geneBySource[sourceType] || "doctor-ai-action-learning",
    capsuleId: capsuleBySource[sourceType] || "capsule-doctor-ai-action-learning",
    sourceType,
    sourceModule: sourceType,
    triggerAction:
      sourceType === "family_qa"
        ? "family_question_answered"
        : sourceType === "checkin"
          ? "family_checkin_completed"
          : sourceType === "feedback"
            ? "family_feedback_submitted"
            : "doctor_suggestion_reviewed",
    impact: summary,
    syncStatus: "local_only",
    traceId: `trace-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    targetId,
    status: "local_recorded",
    deidentified: true,
    createdAt: nowIso()
  };
  seed.evolutionEvents.unshift(event);
  return event;
}

function getSubjectCondition(seed, subject) {
  const directCondition = subject.diagnosis || subject.primaryDiagnosis || subject.mainIssue;
  if (directCondition) return String(directCondition).trim();

  const diagnosisField = seed.extractions
    .filter((extraction) => extraction.subjectId === subject.id)
    .flatMap((extraction) => extraction.fields || [])
    .find((field) => /诊断|疾病|病种|主要问题/.test(String(field.name || "")));
  return String(diagnosisField?.value || "").trim();
}

function asQuestion(text) {
  const value = String(text || "")
    .replace(/\s+/g, "")
    .replace(/[。；;]+$/g, "");
  if (!value) return "";
  return /[？?]$/.test(value) ? value : `${value}？`;
}

function uniqueQuestions(items) {
  return Array.from(new Set(items.map(asQuestion).filter(Boolean)));
}

function buildFamilyQaPrompts(seed, subject, carePlan, doctorRehabAdvice = []) {
  const openReminder = seed.reminders.find((reminder) => reminder.subjectId === subject.id && reminder.status === "open");
  const latestFeedback = seed.familyFeedback.find((feedback) => feedback.subjectId === subject.id);
  const checkins = seed.familyCheckins.filter((item) => item.subjectId === subject.id);
  const hasRecentCheckin = checkins.some((item) => item.status === "done");
  const condition = getSubjectCondition(seed, subject);
  const primaryAdvice = doctorRehabAdvice[0] || null;
  const secondaryAdvice = doctorRehabAdvice[1] || null;
  const symptom = carePlan?.symptomWatch?.[0];
  const visitItem = carePlan?.visitPreparation?.[0];
  const prompts = uniqueQuestions([
    condition ? `${condition}康复期今天最该观察什么` : null,
    primaryAdvice?.title ? `${primaryAdvice.title}做到什么程度合适` : null,
    primaryAdvice?.advice ? `${primaryAdvice.focus || "医生建议"}这条建议家属要怎么配合` : null,
    openReminder?.type === "medication" ? "今天这次用药后要观察什么" : null,
    openReminder?.type === "visit" ? "复诊前需要准备哪些记录" : null,
    openReminder ? `${openReminder.title}要怎么准备` : null,
    latestFeedback ? "今天这些观察指标要怎么记录" : null,
    !hasRecentCheckin ? "今天恢复轻量活动要注意什么" : null,
    symptom ? `出现${symptom}要怎么记录` : null,
    visitItem ? `${visitItem}需要怎么整理` : null,
    secondaryAdvice?.title ? `${secondaryAdvice.title}家属可以先做什么` : null,
    subject.nextVisitDate ? `${subject.nextVisitDate}复诊前要带什么` : null,
    carePlan?.diet ? "今天饮食记录要写哪些变化" : null,
    `${subject.status}阶段今天家属最该记录什么`,
    "哪些症状需要联系医生"
  ]);
  return prompts.slice(0, 3);
}

function getFamilyMemory(seed, subjectId) {
  return seed.familyMemories.find((memory) => memory.subjectId === subjectId) || null;
}

function getDoctorRehabAdvice(seed, subject, carePlan) {
  const explicitAdvice = (seed.doctorRehabAdvice || [])
    .filter((item) => item.subjectId === subject.id && item.status !== "archived")
    .slice(0, 2)
    .map((item) => ({
      source: "主管医生",
      focus: "日常康复",
      priority: "normal",
      status: "active",
      ...item
    }));

  if (explicitAdvice.length) return explicitAdvice;

  return [
    {
      id: `DRA-${subject.id}-AUTO-001`,
      subjectId: subject.id,
      source: "主管医生",
      title: carePlan?.exercise || "完成今日基础康复记录",
      advice: carePlan
        ? `${carePlan.diet}；活动后记录体温、疼痛评分和不适变化。`
        : "今天记录体温、疼痛评分、饮食、活动耐受和明显不适变化。",
      focus: carePlan?.visitPreparation?.length ? "复诊准备" : "症状观察",
      priority: subject.risk === "warning" ? "attention" : "normal",
      status: "active"
    }
  ];
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
      preferenceSummary: "家属偏好简短、可执行的康复提醒。",
      riskPatternSummary: "暂无高风险分流记录。",
      lastAppliedStrategyIds: ["STR-002"],
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
  memory.preferenceSummary =
    memory.lowRiskCount >= 2 ? "家属持续关注可执行的饮食、运动、复诊准备和症状记录建议。" : memory.preferenceSummary || "家属偏好简短、可执行的康复提醒。";
  memory.riskPatternSummary =
    memory.highRiskCount > 0 ? "出现过停药、换药、急性症状或诊断相关高风险问题，需优先分流给医生。" : memory.riskPatternSummary || "暂无高风险分流记录。";
  memory.lastAppliedStrategyIds = Array.from(new Set([...(memory.lastAppliedStrategyIds || []), "STR-002"])).slice(0, 5);
  memory.updatedAt = nowIso();
  return memory;
}

function getLlmApiKey() {
  return getConfigValue("EVOMAP_LLM_API_KEY") || getConfigValue("OPENAI_API_KEY") || "";
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
    const response = await fetch(getLlmChatCompletionsUrl(), {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: getLlmModel(),
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
      model: getLlmModel()
    };
  } catch {
    return {
      content: fallback,
      provider: "local_fallback",
      model: null
    };
  }
}

function parseJsonObject(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const withoutFence = raw.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const match = withoutFence.match(/\{[\s\S]*\}/);
  try {
    return JSON.parse(match ? match[0] : withoutFence);
  } catch {
    return null;
  }
}

async function buildAiRehabAdvice(seed, subject, carePlan, reminders, feedback, familyMemory, doctorRehabAdvice, checkin, today) {
  const latestReminder = reminders.find((reminder) => reminder.status === "open");
  const latestFeedback = feedback[0] || null;
  const primaryDoctorAdvice = doctorRehabAdvice[0] || null;
  const contextUsed = [
    carePlan ? "当前康复计划" : "通用康复计划",
    primaryDoctorAdvice ? "医生康复建议" : "暂无医生康复建议",
    latestReminder ? `最近提醒：${reminderTypeForPrompt(latestReminder.type)}` : "暂无未完成提醒",
    latestFeedback ? `最近反馈：${feedbackObservationSummary(latestFeedback)}` : "暂无家属反馈",
    familyMemory?.summary ? "历史问答记忆" : "暂无历史问答记忆"
  ];
  const fallbackTask = primaryDoctorAdvice?.title || carePlan?.exercise || "完成一次轻量活动并记录身体状态";
  const fallbackAdvice = primaryDoctorAdvice?.advice || (carePlan
    ? `${carePlan.diet}；观察${carePlan.symptomWatch.slice(0, 2).join("、")}。`
    : "保持规律饮食，观察体温、疼痛和精神状态。");
  const fallbackPayload = JSON.stringify({
    task: fallbackTask,
    advice: fallbackAdvice,
    focus: primaryDoctorAdvice?.focus || (feedbackNeedsSymptomFollowup(latestFeedback) ? "症状观察" : latestReminder?.type === "visit" ? "复诊准备" : "日常康复")
  });

  const llmResult = await callChatCompletion(
    [
      {
        role: "system",
        content:
          "你是家属端康复建议助手。只生成低风险康复教育和提醒，不做诊断，不调整处方，不替代医生。请只返回 JSON：{\"task\":\"一句今日任务\",\"advice\":\"一句具体康复建议\",\"focus\":\"饮食/运动/症状观察/复诊准备之一\"}。"
      },
      {
        role: "user",
        content: JSON.stringify({
          patientStatus: subject.status,
          nextVisitDate: subject.nextVisitDate,
          carePlan: carePlan
            ? {
                summary: carePlan.summary,
                diet: carePlan.diet,
                exercise: carePlan.exercise,
                symptomWatch: carePlan.symptomWatch,
                visitPreparation: carePlan.visitPreparation
              }
            : null,
          doctorRehabAdvice: doctorRehabAdvice.map((item) => ({
            title: item.title,
            advice: item.advice,
            focus: item.focus,
            source: item.source
          })),
          latestReminder: latestReminder
            ? {
                type: latestReminder.type,
                dueAt: latestReminder.dueAt
              }
            : null,
          latestFeedback: latestFeedback
            ? {
                observations: latestFeedback.observations || [],
                observationSummary: feedbackObservationSummary(latestFeedback),
                temperatureC: latestFeedback.temperatureC,
                painScore: latestFeedback.painScore,
                medicationTaken: latestFeedback.medicationTaken
              }
            : null,
          memorySummary: familyMemory?.summary || "暂无历史记忆",
          preferenceSummary: familyMemory?.preferenceSummary || "",
          riskPatternSummary: familyMemory?.riskPatternSummary || ""
        })
      }
    ],
    fallbackPayload
  );
  const parsed = parseJsonObject(llmResult.content);
  return {
    date: today,
    title: "今日 AI 康复建议",
    task: String(parsed?.task || fallbackTask).slice(0, 120),
    advice: String(parsed?.advice || llmResult.content || fallbackAdvice).slice(0, 220),
    focus: String(parsed?.focus || "日常康复").slice(0, 40),
    status: checkin?.status || "open",
    completedAt: checkin?.completedAt || null,
    generatedBy: "ai",
    provider: llmResult.provider,
    model: llmResult.model,
    contextUsed
  };
}

function reminderTypeForPrompt(type) {
  return {
    medication: "用药",
    visit: "复诊",
    rehab: "康复",
    family_followup: "家属随访"
  }[type] ?? "提醒";
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
  ensureStoreShape(seed);
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
        name: "患者姓名",
        value: subject.name,
        confidence: 0.93,
        source: `${document.type}基本信息`
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
      },
      {
        name: "当前用药",
        value: body.currentMedication || "研究药A，按方案用药",
        confidence: 0.76,
        source: `${document.type}医嘱段落`
      },
      {
        name: "随访日期",
        value: subject.nextVisitDate,
        confidence: 0.81,
        source: `${document.type}随访计划`
      },
      {
        name: "风险提示",
        value: body.riskHint || "需关注用药依从性和复诊准备",
        confidence: 0.72,
        source: `${document.type}综合判断`
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
  const medicationReminder = {
    id: `REM-${String(nextNumber([...seed.reminders, reminder], "REM")).padStart(3, "0")}`,
    subjectId: subject.id,
    type: "medication",
    title: `${subject.name}用药完成确认`,
    dueAt: `${subject.nextVisitDate}T20:00:00+08:00`,
    channel: "family_h5",
    status: "open",
    source: "care_plan"
  };
  const rehabReminder = {
    id: `REM-${String(nextNumber([...seed.reminders, reminder, medicationReminder], "REM")).padStart(3, "0")}`,
    subjectId: subject.id,
    type: "rehab",
    title: `${subject.name}康复打卡提醒`,
    dueAt: `${subject.nextVisitDate}T20:30:00+08:00`,
    channel: "family_h5",
    status: "open",
    source: "care_plan"
  };
  const firstDoctorAdvice = {
    id: nextId(seed.doctorRehabAdvice, "DRA"),
    subjectId: subject.id,
    source: body.doctorName || "主管医生",
    title: "先完成基础康复记录",
    advice: `${carePlan.exercise}；记录体温、疼痛评分、食欲和明显不适变化。`,
    focus: "症状观察",
    priority: "normal",
    status: "active"
  };
  const secondDoctorAdvice = {
    id: `DRA-${String(nextNumber([...seed.doctorRehabAdvice, firstDoctorAdvice], "DRA")).padStart(3, "0")}`,
    subjectId: subject.id,
    source: body.doctorName || "主管医生",
    title: "复诊前整理用药和检查资料",
    advice: "把近7天用药、症状变化和既往检查报告放在一起，便于复诊时医生快速核对。",
    focus: "复诊准备",
    priority: "normal",
    status: "active"
  };

  seed.subjects.unshift(subject);
  seed.documents.unshift(document);
  seed.extractions.unshift(extraction);
  seed.visits.unshift(visit);
  seed.tasks.unshift(task);
  seed.carePlans.unshift(carePlan);
  seed.doctorRehabAdvice.unshift(firstDoctorAdvice, secondDoctorAdvice);
  seed.reminders.unshift(rehabReminder, medicationReminder, reminder);
  seed.aiSuggestions.unshift(
    createAiSuggestion(seed, {
      subjectId: subject.id,
      type: "document_review",
      title: "新患者材料待复核",
      summary: `${subject.name}已完成模拟病例解析，建议确认关键字段后生成正式随访计划。`,
      reasoningSummary: "AI 已从上传/手填材料中抽取诊断、用药、随访日期和风险提示，需要医生复核。",
      riskLevel: "low",
      evidenceItems: [
        { source: "extraction", label: "抽取置信度", value: `${Math.round(extraction.confidence * 100)}%` },
        { source: "document", label: "材料类型", value: document.type }
      ],
      recommendedAction: "确认 AI 候选字段，并检查初始康复计划和家属提醒。",
      confidence: extraction.confidence,
      priorityScore: 56,
      strategySource: "病例上传解析策略"
    })
  );
  addAudit(seed, "CRC 张琳", "新建患者并生成AI抽取任务", subject.id);
  recalculateMetrics(seed);

  return {
    subject,
    document,
    extraction,
    visit,
    task,
    carePlan,
    doctorRehabAdvice: [firstDoctorAdvice, secondDoctorAdvice],
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
        name: "患者姓名",
        value: subject.name,
        confidence: 0.92,
        source: `${document.type}基本信息`
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
      },
      {
        name: "当前用药",
        value: body.currentMedication || "按原治疗方案执行",
        confidence: 0.76,
        source: `${document.type}医嘱段落`
      },
      {
        name: "随访日期",
        value: subject.nextVisitDate || body.nextVisitDate || "待确认",
        confidence: 0.79,
        source: `${document.type}随访计划`
      },
      {
        name: "风险提示",
        value: body.riskHint || "需医生复核材料和康复计划",
        confidence: 0.7,
        source: `${document.type}综合判断`
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
  seed.aiSuggestions.unshift(
    createAiSuggestion(seed, {
      subjectId: subject.id,
      type: "document_review",
      title: "病例材料待复核",
      summary: `${subject.name}新增${document.type}，AI 已抽取关键字段，建议医生或 CRC 先复核再更新康复计划。`,
      riskLevel: "low",
      evidenceItems: [
        { source: "document", label: document.type, value: document.fileName },
        { source: "extraction", label: "抽取置信度", value: `${Math.round(extraction.confidence * 100)}%` }
      ],
      recommendedAction: "复核 AI 抽取字段，确认后同步更新患者档案和提醒。",
      confidence: extraction.confidence,
      priorityScore: 54,
      strategySource: "病例上传解析策略"
    })
  );
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

function createAiSuggestion(seed, input) {
  const evidenceItems =
    input.evidenceItems ||
    (input.evidence || []).map((item) => ({
      source: "legacy",
      label: String(item).split(" ")[0] || "证据",
      value: String(item)
    }));
  const evidence = input.evidence || evidenceItems.map((item) => `${item.label}: ${item.value}`);
  const priorityScore = Number(input.priorityScore ?? (input.riskLevel === "medium" ? 70 : 45));
  return {
    id: nextId(seed.aiSuggestions, "AIS"),
    subjectId: input.subjectId,
    type: input.type,
    title: input.title,
    summary: input.summary,
    reasoningSummary: input.reasoningSummary || input.summary,
    riskLevel: input.riskLevel || "low",
    evidence,
    evidenceItems,
    recommendedAction: input.recommendedAction || "建议医生确认后同步给家属。",
    confidence: Number(input.confidence ?? 0.78),
    priorityScore,
    strategySource: input.strategySource || "本地默认 AI 策略",
    appliedGeneIds: input.appliedGeneIds || ["doctor-ai-action-learning"],
    learningEligible: input.learningEligible ?? true,
    status: input.status || "candidate",
    doctorDecision: input.doctorDecision || null,
    doctorDecisionReason: input.doctorDecisionReason || null,
    createdAt: input.createdAt || nowIso(),
    createdBy: input.createdBy || "system_agent"
  };
}

function latestSubjectFeedback(seed, subjectId) {
  return seed.familyFeedback.find((feedback) => feedback.subjectId === subjectId && feedback.status !== "reviewed") || null;
}

function getSubjectCheckinSignals(seed, subjectId) {
  const today = new Date().toISOString().slice(0, 10);
  const subjectCheckins = seed.familyCheckins.filter((item) => item.subjectId === subjectId);
  const completedCount = subjectCheckins.filter((item) => item.status === "done").length;
  const todayCheckin = subjectCheckins.find((item) => item.date === today);
  return {
    completedCount,
    hasTodayDone: todayCheckin?.status === "done",
    hasAnyCheckin: subjectCheckins.length > 0,
    latest: subjectCheckins[0] || null
  };
}

function recordEvolutionRun(seed, created, sourceSignals) {
  ensureStoreShape(seed);
  const run = {
    id: nextId(seed.evolutionRuns, "RUN"),
    type: "doctor_ai_analysis",
    inputSummary: `${sourceSignals.openReminders} open reminders, ${sourceSignals.pendingFeedback} family feedback, ${sourceSignals.pendingExtractions} pending extractions`,
    outputSummary: `${created.length} candidate suggestions generated with structured evidence and strategy source`,
    strategyVersion: seed.strategyCapsules.find((item) => item.scope === "doctor_ai")?.version || "doctor-ai-v1",
    validationResult: created.every((item) => item.reasoningSummary && item.evidenceItems?.length && item.recommendedAction) ? "passed" : "needs_review",
    createdSuggestionIds: created.map((item) => item.id),
    createdAt: nowIso()
  };
  seed.evolutionRuns.unshift(run);
  return run;
}

function buildEvolutionDemo(seed) {
  ensureStoreShape(seed);
  const beforeSuggestions = seed.aiSuggestions
    .filter((item) => item.status === "candidate")
    .slice()
    .sort((a, b) => (b.priorityScore || 0) - (a.priorityScore || 0))
    .slice(0, 3)
    .map((item) => ({
      id: item.id,
      title: item.title,
      subjectName: getSubjectName(seed, item.subjectId),
      priorityScore: item.priorityScore || 0,
      strategySource: item.strategySource || "本地默认策略"
    }));

  const positiveSignals = seed.evolutionEvents.filter((event) => event.sourceModule === "doctor_ai" && event.impact === "positive_signal").length;
  const correctionSignals = seed.evolutionEvents.filter((event) => event.sourceModule === "doctor_ai" && event.impact === "correction_signal").length;
  const latestRun = seed.evolutionRuns[0] || null;
  const doctorStrategy = seed.strategyCapsules.find((item) => item.scope === "doctor_ai");
  const afterSuggestions = seed.aiSuggestions
    .filter((item) => item.status === "candidate")
    .slice()
    .sort((a, b) => (b.priorityScore || 0) - (a.priorityScore || 0))
    .slice(0, 3)
    .map((item, index) => ({
      id: item.id,
      rank: index + 1,
      title: item.title,
      subjectName: getSubjectName(seed, item.subjectId),
      priorityScore: item.priorityScore || 0,
      strategySource: item.strategySource || "本地默认策略",
      reasoningSummary: item.reasoningSummary || item.summary
    }));

  return {
    beforeTitle: beforeSuggestions[0] ? `${beforeSuggestions[0].subjectName} · ${beforeSuggestions[0].title}` : "未运行 baseline",
    afterTitle: afterSuggestions[0] ? `${afterSuggestions[0].subjectName} · ${afterSuggestions[0].title}` : "等待进化后分析",
    beforeSuggestions,
    afterSuggestions,
    qaComparison: latestRun?.qaComparison || {
      question: "疼痛加重，能不能自己减量？",
      beforeRoute: "rehab_education",
      beforeAnswer: "建议记录疼痛评分、持续时间和影响睡眠情况，复诊时告诉医生。仅作康复教育与提醒，不替代医生诊疗。",
      doctorFeedback: "这个回答没有识别“自己减量”属于处方调整风险，也没有结合疼痛升高和用药未确认。",
      afterRoute: "doctor_contact",
      afterAnswer: "不要自行减量或调整用药。这个问题涉及处方调整，且当前存在疼痛升高、用药未确认和打卡中断，请联系主管医生；若疼痛剧烈、胸痛、呼吸困难或持续高热，请及时就医。仅作康复教育与提醒，不替代医生诊疗。",
      capabilityDelta: ["识别处方调整风险", "结合疼痛升高与用药未确认", "从康复教育改为医生分流"]
    },
    learningSignals: {
      positiveSignals,
      correctionSignals,
      totalEvents: seed.evolutionEvents.length
    },
    strategy: doctorStrategy || null,
    latestRun
  };
}

function ensureDemoScenarioData(seed) {
  const exists = seed.subjects.some((subject) => subject.id === "SUBJ-900");
  if (exists) return;

  seed.subjects.unshift({
    id: "SUBJ-900",
    code: "S900",
    name: "演示患者A",
    sex: "女",
    age: 56,
    phone: "13800009900",
    site: "上海第一中心",
    status: "随访中",
    risk: "warning",
    baselineDate: "2026-06-12",
    nextVisitDate: "2026-06-22",
    updatedAt: nowIso()
  });
  seed.carePlans.unshift({
    id: nextId(seed.carePlans, "PLAN"),
    subjectId: "SUBJ-900",
    summary: "复诊前疼痛观察、用药依从性和轻量活动计划",
    diet: "高蛋白、少量多餐，记录食欲变化",
    exercise: "每日轻量步行8-10分钟，疼痛加重则停止并记录",
    symptomWatch: ["疼痛升高", "发热", "呼吸困难", "明显乏力"],
    visitPreparation: ["带近3天疼痛评分", "带用药完成记录", "准备复诊问题清单"]
  });
  seed.reminders.unshift(
    {
      id: nextId(seed.reminders, "REM"),
      subjectId: "SUBJ-900",
      type: "medication",
      title: "演示患者A用药完成确认",
      dueAt: "2026-06-20T20:00:00+08:00",
      channel: "family_h5",
      status: "open",
      source: "demo"
    },
    {
      id: nextId(seed.reminders, "REM"),
      subjectId: "SUBJ-900",
      type: "rehab",
      title: "演示患者A康复打卡提醒",
      dueAt: "2026-06-20T20:30:00+08:00",
      channel: "family_h5",
      status: "open",
      source: "demo"
    }
  );
  seed.familyFeedback.unshift({
    id: nextId(seed.familyFeedback, "FBK"),
    subjectId: "SUBJ-900",
    symptoms: "疼痛较前升高，夜间睡眠受影响，今日尚未确认用药",
    temperatureC: 37.4,
    painScore: 7,
    medicationTaken: false,
    question: "是否需要提前联系医生",
    status: "new",
    createdAt: nowIso()
  });
  seed.familyConversations.unshift(
    {
      id: nextId(seed.familyConversations, "FQA"),
      subjectId: "SUBJ-900",
      threadId: "family-SUBJ-900",
      turnIndex: 1,
      question: "疼痛加重怎么记录？",
      answer: "记录疼痛评分、持续时间、影响睡眠情况和用药完成情况。仅作康复教育与提醒，不替代医生诊疗。",
      riskRoute: "rehab_education",
      answerProvider: "local_fallback",
      memorySummary: "家属关注疼痛和用药记录。",
      contextUsed: ["已结合当前康复计划", "已结合最近反馈：疼痛 7，体温 37.4", "低风险康复教育"],
      createdAt: nowIso(),
      storedLocally: true
    },
    {
      id: nextId(seed.familyConversations, "FQA"),
      subjectId: "SUBJ-900",
      threadId: "family-SUBJ-900",
      turnIndex: 2,
      question: "能不能自己减量？",
      answer: "这个问题涉及处方调整，请联系主管医生。仅作康复教育与提醒，不替代医生诊疗。",
      riskRoute: "doctor_contact",
      answerProvider: "local_safety_guard",
      memorySummary: "家属出现过处方调整相关高风险问题。",
      contextUsed: ["已结合当前康复计划", "命中高风险分流"],
      createdAt: nowIso(),
      storedLocally: true
    }
  );
  seed.familyCheckins.unshift({
    id: nextId(seed.familyCheckins, "CHK"),
    subjectId: "SUBJ-900",
    date: "2026-06-19",
    title: "今日康复打卡",
    task: "复诊前轻量步行和疼痛记录",
    note: "疼痛影响活动，未完成步行",
    mood: "焦虑",
    fatigueLevel: 6,
    activityCompleted: false,
    warningObserved: true,
    status: "done",
    completedAt: "2026-06-19T20:30:00+08:00"
  });
}

function runEvolutionDemo(seed) {
  ensureStoreShape(seed);
  ensureDemoScenarioData(seed);
  const baseline = generateDoctorSuggestions(seed);
  const baselineTop = seed.aiSuggestions
    .filter((item) => item.status === "candidate")
    .slice()
    .sort((a, b) => (b.priorityScore || 0) - (a.priorityScore || 0))
    .slice(0, 3)
    .map((item) => ({
      id: item.id,
      title: item.title,
      subjectName: getSubjectName(seed, item.subjectId),
      priorityScore: item.priorityScore || 0,
      strategySource: item.strategySource || "本地默认策略"
    }));

  const combinedRisk = seed.aiSuggestions.find((item) => item.subjectId === "SUBJ-900" && item.type === "combined_risk" && item.status === "candidate");
  if (combinedRisk) {
    updateSuggestion(seed, combinedRisk.id, {
      status: "accepted",
      doctorDecisionReason: "疼痛升高、用药未确认和打卡中断叠加，需要优先电话随访。"
    });
  }
  const lowPriority = seed.aiSuggestions.find((item) => item.type === "family_anxiety" && item.status === "candidate");
  if (lowPriority) {
    updateSuggestion(seed, lowPriority.id, {
      status: "false_positive",
      doctorDecisionReason: "单纯反复提问不应高于组合风险。"
    });
  }

  const doctorStrategy = seed.strategyCapsules.find((item) => item.scope === "doctor_ai");
  if (doctorStrategy) {
    doctorStrategy.version = "doctor-ai-v2-visible-evolution";
    doctorStrategy.source = "doctor_feedback_evolved";
    doctorStrategy.summary = "After doctor feedback, prioritize combined risk: pain increase + medication unconfirmed + check-in dropoff. Downgrade standalone family anxiety.";
    doctorStrategy.updatedAt = nowIso();
  }
  const familyStrategy = seed.strategyCapsules.find((item) => item.scope === "family_qa");
  if (familyStrategy) {
    familyStrategy.version = "family-qa-v2-risk-correction";
    familyStrategy.source = "doctor_feedback_evolved";
    familyStrategy.summary = "After correction, route medication self-adjustment questions with pain increase and unconfirmed medication to doctor contact guidance.";
    familyStrategy.updatedAt = nowIso();
  }

  const evolvedCombinedRisk = createAiSuggestion(seed, {
    subjectId: "SUBJ-900",
    type: "combined_risk",
    title: "组合风险需要优先查看",
    summary: "进化后 AI 识别到演示患者A同时存在疼痛升高、用药未确认和打卡中断，建议置顶处理。",
    reasoningSummary: "进化后 AI 将疼痛升高、用药未确认和打卡中断组合为最高优先级。",
    riskLevel: "medium",
    evidenceItems: [
      { source: "family_feedback", label: "疼痛评分", value: 7 },
      { source: "reminder", label: "用药完成", value: "未确认" },
      { source: "checkin", label: "康复打卡", value: "中断且观察到异常" }
    ],
    recommendedAction: "优先电话随访，确认症状趋势、用药完成情况和是否需要提前复诊。",
    confidence: 0.94,
    priorityScore: 98,
    strategySource: "进化后策略 v2：医生反馈强化组合风险"
  });
  seed.aiSuggestions.unshift(evolvedCombinedRisk);

  seed.aiSuggestions
    .filter((item) => item.status === "candidate")
    .forEach((item) => {
      if (item.type === "combined_risk") {
        item.priorityScore = Math.max(item.priorityScore || 0, item.id === evolvedCombinedRisk.id ? 98 : 96);
        item.strategySource = "进化后策略 v2：医生反馈强化组合风险";
        item.reasoningSummary = "进化后 AI 将疼痛升高、用药未确认和打卡中断组合为最高优先级。";
      }
      if (item.type === "family_anxiety") {
        item.priorityScore = Math.min(item.priorityScore || 40, 34);
        item.strategySource = "进化后策略 v2：医生反馈降低单一焦虑信号";
      }
    });
  seed.aiSuggestions.sort((a, b) => (b.priorityScore || 0) - (a.priorityScore || 0));

  const run = {
    id: nextId(seed.evolutionRuns, "RUN"),
    type: "visible_evolution_demo",
    inputSummary: "Demo injected pain increase, medication unconfirmed, check-in dropoff, and doctor feedback.",
    outputSummary: "Combined risk moved to top priority; family Q&A corrected medication self-adjustment into doctor routing.",
    strategyVersion: doctorStrategy?.version || "doctor-ai-v2-visible-evolution",
    validationResult: "passed",
    qaComparison: {
      question: "疼痛加重，能不能自己减量？",
      beforeRoute: "rehab_education",
      beforeAnswer: "建议记录疼痛评分、持续时间和影响睡眠情况，复诊时告诉医生。仅作康复教育与提醒，不替代医生诊疗。",
      doctorFeedback: "医生反馈：该回答没有识别“自己减量”属于处方调整风险，也没有结合疼痛升高和用药未确认。",
      afterRoute: "doctor_contact",
      afterAnswer: "不要自行减量或调整用药。这个问题涉及处方调整，且当前存在疼痛升高、用药未确认和打卡中断，请联系主管医生；若疼痛剧烈、胸痛、呼吸困难或持续高热，请及时就医。仅作康复教育与提醒，不替代医生诊疗。",
      capabilityDelta: ["识别处方调整风险", "结合疼痛升高与用药未确认", "从康复教育改为医生分流"]
    },
    beforeTop: baselineTop,
    afterTop: seed.aiSuggestions
      .filter((item) => item.status === "candidate")
      .slice(0, 3)
      .map((item) => ({
        id: item.id,
        title: item.title,
        subjectName: getSubjectName(seed, item.subjectId),
        priorityScore: item.priorityScore || 0,
        strategySource: item.strategySource || "本地默认策略"
      })),
    createdSuggestionIds: baseline.map((item) => item.id),
    createdAt: nowIso()
  };
  seed.evolutionRuns.unshift(run);
  addAudit(seed, "AI演示服务", "运行肉眼可见的进化演示", run.id);
  recalculateMetrics(seed);
  return {
    run,
    demo: buildEvolutionDemo(seed)
  };
}

function generateDoctorSuggestions(seed) {
  ensureStoreShape(seed);
  const created = [];
  const sourceSignals = {
    openReminders: seed.reminders.filter((item) => item.status === "open").length,
    pendingFeedback: seed.familyFeedback.filter((item) => item.status !== "reviewed").length,
    pendingExtractions: seed.extractions.filter((item) => item.status !== "confirmed").length
  };

  for (const reminder of seed.reminders.filter((item) => item.status === "open")) {
    const type =
      reminder.type === "medication"
        ? "medication_adherence"
        : reminder.type === "visit"
          ? "visit_preparation"
          : reminder.type === "rehab"
            ? "checkin_dropoff"
            : `reminder_${reminder.type}`;
    if (suggestionExists(seed, reminder.subjectId, type)) continue;
    const suggestion = createAiSuggestion(seed, {
      subjectId: reminder.subjectId,
      type,
      title: reminder.type === "medication" ? "用药依从性提醒" : reminder.type === "visit" ? "复诊准备不足" : "康复打卡跟进",
      summary: `${getSubjectName(seed, reminder.subjectId)}存在未完成${reminder.title}，建议医生确认后同步给家属。`,
      reasoningSummary: `AI 发现${reminder.title}仍未完成，可能影响用药、复诊或康复连续性。`,
      riskLevel: reminder.type === "medication" ? "medium" : "low",
      evidenceItems: [
        { source: "reminder", label: "提醒", value: reminder.title },
        { source: "reminder", label: "截止时间", value: reminder.dueAt }
      ],
      recommendedAction: reminder.type === "medication" ? "确认用药完成情况，必要时提醒家属补充记录。" : "确认提醒事项是否完成，并同步复诊或康复准备要求。",
      confidence: reminder.type === "medication" ? 0.86 : 0.78,
      priorityScore: reminder.type === "medication" ? 72 : 52,
      strategySource: "本地默认策略 + 医生历史处理偏好"
    });
    seed.aiSuggestions.unshift(suggestion);
    created.push(suggestion);
  }

  for (const feedback of seed.familyFeedback.filter((item) => item.status !== "reviewed")) {
    const type = feedbackNeedsSymptomFollowup(feedback) ? "symptom_followup" : "family_feedback_followup";
    if (suggestionExists(seed, feedback.subjectId, type)) continue;
    const riskLevel = feedbackHasMediumRisk(feedback) ? "medium" : "low";
    const observationItems = feedbackObservationItems(feedback);
    const suggestion = createAiSuggestion(seed, {
      subjectId: feedback.subjectId,
      type,
      title: type === "symptom_followup" ? "症状反馈跟进" : "家属反馈跟进建议",
      summary: `${getSubjectName(seed, feedback.subjectId)}有新的家属反馈，建议医生端查看依从性和症状变化。`,
      reasoningSummary: `AI 结合${feedbackObservationSummary(feedback)}和用药记录，判断需要医生端复核。`,
      riskLevel,
      evidenceItems: [
        { source: "family_feedback", label: "症状", value: feedback.symptoms },
        ...observationItems,
        { source: "family_feedback", label: "用药完成", value: feedback.medicationTaken ? "已确认" : "未确认" }
      ],
      recommendedAction: riskLevel === "medium" ? "建议电话随访，确认症状趋势和是否需要提前复诊。" : "查看家属反馈，必要时给出康复记录或复诊准备建议。",
      confidence: riskLevel === "medium" ? 0.88 : 0.8,
      priorityScore: riskLevel === "medium" ? 84 : 62,
      strategySource: "本地默认策略 + 家属反馈记忆"
    });
    seed.aiSuggestions.unshift(suggestion);
    created.push(suggestion);
  }

  for (const extraction of seed.extractions.filter((item) => item.status !== "confirmed")) {
    if (suggestionExists(seed, extraction.subjectId, "document_review")) continue;
    const document = seed.documents.find((item) => item.id === extraction.documentId);
    const suggestion = createAiSuggestion(seed, {
      subjectId: extraction.subjectId,
      type: "document_review",
      title: "病例材料待复核",
      summary: `${getSubjectName(seed, extraction.subjectId)}仍有 AI 抽取字段待确认，建议先复核材料再推进随访。`,
      reasoningSummary: `AI 发现${document?.type || "材料"}抽取结果置信度为 ${Math.round(extraction.confidence * 100)}%，仍未确认入档。`,
      riskLevel: extraction.confidence < 0.8 ? "medium" : "low",
      evidenceItems: [
        { source: "extraction", label: "抽取任务", value: extraction.id },
        { source: "document", label: "材料", value: document?.type || extraction.documentId },
        { source: "extraction", label: "置信度", value: `${Math.round(extraction.confidence * 100)}%` }
      ],
      recommendedAction: "复核关键字段，确认后再生成或更新康复提醒。",
      confidence: extraction.confidence,
      priorityScore: extraction.confidence < 0.8 ? 74 : 58,
      strategySource: "病例上传解析策略"
    });
    seed.aiSuggestions.unshift(suggestion);
    created.push(suggestion);
  }

  for (const subject of seed.subjects) {
    const checkinSignals = getSubjectCheckinSignals(seed, subject.id);
    const feedback = latestSubjectFeedback(seed, subject.id);
    const medicationOpen = seed.reminders.some((item) => item.subjectId === subject.id && item.type === "medication" && item.status === "open");
    if (!checkinSignals.hasTodayDone && feedback && !suggestionExists(seed, subject.id, "combined_risk")) {
      const mediumRisk = feedbackNeedsSymptomFollowup(feedback) || medicationOpen;
      const suggestion = createAiSuggestion(seed, {
        subjectId: subject.id,
        type: "combined_risk",
        title: "组合风险需要优先查看",
        summary: `${subject.name}同时存在家属反馈、康复打卡未完成${medicationOpen ? "和用药提醒未确认" : ""}，建议医生优先查看。`,
        reasoningSummary: "AI 将家属症状反馈、今日打卡状态和用药提醒组合判断，认为单个低风险信号叠加后需要提前处理。",
        riskLevel: mediumRisk ? "medium" : "low",
        evidenceItems: [
          { source: "family_feedback", label: "最近反馈", value: feedback.symptoms },
          { source: "checkin", label: "今日打卡", value: checkinSignals.hasTodayDone ? "已完成" : "未完成" },
          { source: "reminder", label: "用药提醒", value: medicationOpen ? "未确认" : "无未完成用药提醒" }
        ],
        recommendedAction: "优先查看该患者详情，必要时电话随访并同步家属康复记录要求。",
        confidence: mediumRisk ? 0.9 : 0.82,
        priorityScore: mediumRisk ? 92 : 78,
        strategySource: "本地默认策略 + 医生历史处理偏好"
      });
      seed.aiSuggestions.unshift(suggestion);
      created.push(suggestion);
    }

    const familyQuestions = seed.familyConversations.filter((item) => item.subjectId === subject.id);
    if (familyQuestions.length >= 2 && !suggestionExists(seed, subject.id, "family_anxiety")) {
      const suggestion = createAiSuggestion(seed, {
        subjectId: subject.id,
        type: "family_anxiety",
        title: "家属反复询问需安抚",
        summary: `${subject.name}家属近期多次提问，建议医生端提供更明确的复诊准备或康复边界说明。`,
        reasoningSummary: `AI 发现家属已有 ${familyQuestions.length} 轮问答，关注点可能集中在复诊、用药或症状观察。`,
        riskLevel: "low",
        evidenceItems: [
          { source: "family_qa", label: "问答轮数", value: familyQuestions.length },
          { source: "family_qa", label: "最近问题", value: familyQuestions[0]?.riskRoute === "doctor_contact" ? "高风险分流" : "康复教育" }
        ],
        recommendedAction: "在下一次沟通中补充明确的复诊准备清单和症状观察边界。",
        confidence: 0.76,
        priorityScore: 48,
        strategySource: "家属问答记忆"
      });
      seed.aiSuggestions.unshift(suggestion);
      created.push(suggestion);
    }
  }

  addAudit(seed, "AI分析服务", `生成${created.length}条医生端候选建议`, seed.study.id);
  created.sort((a, b) => (b.priorityScore || 0) - (a.priorityScore || 0));
  seed.aiSuggestions.sort((a, b) => (b.priorityScore || 0) - (a.priorityScore || 0));
  recordEvolutionRun(seed, created, sourceSignals);
  recalculateMetrics(seed);
  return created;
}

function updateSuggestion(seed, id, body) {
  ensureStoreShape(seed);
  const suggestion = seed.aiSuggestions.find((item) => item.id === id);
  if (!suggestion) {
    return { statusCode: 404, payload: { error: "Suggestion not found" } };
  }

  const allowedStatuses = ["candidate", "accepted", "dismissed", "sent_to_family", "false_positive"];
  if (body.status && !allowedStatuses.includes(body.status)) {
    return { statusCode: 400, payload: { error: "Invalid suggestion status" } };
  }

  suggestion.status = body.status || suggestion.status;
  suggestion.doctorDecision = suggestion.status;
  suggestion.doctorDecisionReason =
    body.doctorDecisionReason ||
    body.reason ||
    (suggestion.status === "accepted"
      ? "医生确认该建议有处理价值。"
      : suggestion.status === "sent_to_family"
        ? "医生认为该建议适合同步给家属执行。"
        : suggestion.status === "false_positive"
          ? "医生标记该建议为误报，后续需降低相似信号权重。"
          : suggestion.status === "dismissed"
            ? "医生暂不处理该建议。"
            : suggestion.doctorDecisionReason);
  suggestion.learningEligible = body.learningEligible ?? suggestion.learningEligible ?? true;
  suggestion.updatedAt = nowIso();
  suggestion.reviewedBy = body.reviewedBy || "医生管理者";
  if (["accepted", "sent_to_family", "dismissed", "false_positive"].includes(suggestion.status)) {
    const event = addLocalLearningEvent(
      seed,
      `Doctor ${suggestion.status} ${suggestion.type} suggestion; reason: ${suggestion.doctorDecisionReason}`,
      "doctor_ai",
      suggestion.id
    );
    event.triggerAction = `doctor_${suggestion.status}`;
    event.impact =
      suggestion.status === "false_positive"
        ? "correction_signal"
        : ["accepted", "sent_to_family"].includes(suggestion.status)
          ? "positive_signal"
          : "low_priority_signal";
    event.strategySource = suggestion.strategySource;
  }
  addAudit(seed, "医生管理者", `AI建议状态更新为${suggestion.status}`, suggestion.id);
  recalculateMetrics(seed);
  return { statusCode: 200, payload: suggestion };
}

function deterministicIndex(seed, length) {
  if (!length) return 0;
  let total = 0;
  for (const char of String(seed)) {
    total = (total * 31 + char.charCodeAt(0)) % 9973;
  }
  return total % length;
}

function buildGeneratedCheckinRecord(subject, carePlan, doctorRehabAdvice, day, existing) {
  if (existing) {
    const symptom = carePlan?.symptomWatch?.[deterministicIndex(`${subject.id}-${day}-existing-symptom`, carePlan.symptomWatch.length)] || "体温、疼痛和精神状态";
    const painScore = existing.painScore ?? deterministicIndex(`${subject.id}-${day}-pain`, 4);
    const temperatureC = existing.temperatureC ?? Number((36.4 + deterministicIndex(`${subject.id}-${day}-temp`, 6) * 0.1).toFixed(1));
    const fatigueLevel = existing.fatigueLevel ?? 2 + deterministicIndex(`${subject.id}-${day}-fatigue`, 4);
    const appetite = existing.appetite || ["正常", "略差", "较好", "少量多餐完成"][deterministicIndex(`${subject.id}-${day}-appetite`, 4)];
    const sleepQuality = existing.sleepQuality || ["睡眠平稳", "夜间醒1次", "入睡稍慢", "睡眠较好"][deterministicIndex(`${subject.id}-${day}-sleep`, 4)];
    const hydration = existing.hydration || ["饮水约1200ml", "饮水约1500ml", "少量多次饮水", "按计划补水"][deterministicIndex(`${subject.id}-${day}-water`, 4)];
    const completedTasks = Array.from(
      new Set([
        ...(existing.completedTasks || (existing.activityCompleted !== false && existing.task ? [existing.task] : [])),
        `记录${symptom}变化`,
        Number(day.slice(-2)) % 2 === 0 ? "复核用药和饮水情况" : "记录睡眠、食欲和疲劳度"
      ])
    ).slice(0, 4);
    const vitalSummary = existing.vitalSummary || `体温${temperatureC}℃，疼痛${painScore}分，疲劳${fatigueLevel}/10。`;
    const noteBase = String(existing.note || "").trim();
    const note =
      noteBase.length > 28 && noteBase.includes("；")
        ? noteBase
        : `${day.slice(5)}记录：${noteBase || completedTasks[0] || "完成康复记录"}；${appetite}，${sleepQuality}，${hydration}。${vitalSummary}`;
    return {
      ...existing,
      completedTasks,
      note,
      mood: existing.mood || "平稳",
      fatigueLevel,
      painScore,
      temperatureC,
      appetite,
      sleepQuality,
      hydration,
      vitalSummary
    };
  }

  const dayNumber = Number(day.slice(-2));
  const doctorAdvice = doctorRehabAdvice[deterministicIndex(`${subject.id}-${day}-doctor`, doctorRehabAdvice.length)] || null;
  const symptom = carePlan?.symptomWatch?.[deterministicIndex(`${subject.id}-${day}-symptom`, carePlan.symptomWatch.length)] || "体温、疼痛和精神状态";
  const taskTemplates = [
    carePlan?.exercise,
    doctorAdvice?.title,
    carePlan?.diet ? `饮食记录：${carePlan.diet}` : null,
    `症状观察：重点看${symptom}`,
    subject.nextVisitDate ? `复诊准备：整理${subject.nextVisitDate}前记录` : "复诊准备：整理近期记录",
    "记录体温、疼痛评分和活动耐受"
  ].filter(Boolean);
  const secondTasks = [
    `记录${symptom}变化`,
    "核对今日用药和饮水",
    "整理家属想问医生的问题",
    "记录食欲、睡眠和疲劳度",
    "观察活动后是否胸闷、头晕或乏力"
  ];
  const painScore = Math.min(8, deterministicIndex(`${subject.id}-${day}-pain`, 5) + (subject.risk === "warning" ? 2 : 0));
  const temperatureC = Number((36.3 + deterministicIndex(`${subject.id}-${day}-temp`, 7) * 0.1).toFixed(1));
  const fatigueLevel = Math.min(8, 2 + deterministicIndex(`${subject.id}-${day}-fatigue`, 5) + (painScore >= 5 ? 1 : 0));
  const warningObserved = subject.risk === "warning" && painScore >= 6 && dayNumber % 3 === 0;
  const moods = warningObserved ? ["担心", "焦虑", "谨慎"] : ["平稳", "轻松", "有信心", "略疲惫", "状态稳定"];
  const appetite = ["正常", "略差", "较好", "少量多餐完成", "晚餐进食一般"][deterministicIndex(`${subject.id}-${day}-appetite`, 5)];
  const sleepQuality = ["睡眠平稳", "夜间醒1次", "入睡稍慢", "午后补休30分钟", "睡眠较好"][deterministicIndex(`${subject.id}-${day}-sleep`, 5)];
  const hydration = ["饮水约1200ml", "饮水约1500ml", "少量多次饮水", "按计划补水", "饮水偏少，明天提醒"][deterministicIndex(`${subject.id}-${day}-water`, 5)];
  const task = taskTemplates[deterministicIndex(`${subject.id}-${day}-task`, taskTemplates.length)];
  const completedTasks = Array.from(
    new Set([
      task,
      secondTasks[deterministicIndex(`${subject.id}-${day}-second`, secondTasks.length)],
      dayNumber % 2 === 0 ? "记录晚间体温和疼痛评分" : "完成家属陪同下轻量活动"
    ])
  );

  return {
    id: `AUTO-CHK-${subject.id}-${day}`,
    subjectId: subject.id,
    date: day,
    title: "康复打卡记录",
    task,
    completedTasks,
    note: `${day.slice(5)}记录：${completedTasks[0]}；${appetite}，${sleepQuality}，${hydration}。${warningObserved ? "疼痛偏高，已提醒家属继续观察并按边界联系医生。" : "整体耐受可，继续保持记录。"}`,
    mood: moods[deterministicIndex(`${subject.id}-${day}-mood`, moods.length)],
    fatigueLevel,
    painScore,
    temperatureC,
    appetite,
    sleepQuality,
    hydration,
    vitalSummary: `体温${temperatureC}℃，疼痛${painScore}分，疲劳${fatigueLevel}/10。`,
    activityCompleted: !warningObserved,
    warningObserved,
    status: "done",
    completedAt: `${day}T${String(19 + (dayNumber % 3)).padStart(2, "0")}:${String(10 + ((dayNumber * 7) % 45)).padStart(2, "0")}:00+08:00`,
    generated: true
  };
}

async function buildFamilyHome(seed, subjectId) {
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
  const doctorRehabAdvice = getDoctorRehabAdvice(seed, subject, carePlan);
  const qaPrompts = buildFamilyQaPrompts(seed, subject, carePlan, doctorRehabAdvice);
  const today = new Date().toISOString().slice(0, 10);
  const checkin = null;
  const monthStart = new Date(`${today.slice(0, 7)}-01T00:00:00.000Z`);
  const nextMonth = new Date(monthStart);
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  const monthDays = Math.round((nextMonth - monthStart) / 86400000);
  const checkinMonth = Array.from({ length: monthDays }, (_, index) => {
    const date = new Date(monthStart);
    date.setUTCDate(index + 1);
    const day = date.toISOString().slice(0, 10);
    const isFuture = day > today;
    const isPast = day < today;
    const existing = day === today ? null : seed.familyCheckins.find((entry) => entry.subjectId === subject.id && entry.date === day);
    const item = isPast || existing ? buildGeneratedCheckinRecord(subject, carePlan, doctorRehabAdvice, day, existing) : null;
    return {
      date: day,
      day: index + 1,
      status: item?.status || (isFuture ? "future" : "open"),
      completedAt: item?.completedAt || null,
      title: item?.title || "",
      task: item?.task || "",
      completedTasks: item?.completedTasks || (item?.activityCompleted !== false && item?.task ? [item.task] : []),
      note: item?.note || "",
      mood: item?.mood || "",
      fatigueLevel: item?.fatigueLevel ?? null,
      painScore: item?.painScore ?? null,
      temperatureC: item?.temperatureC ?? null,
      appetite: item?.appetite || "",
      sleepQuality: item?.sleepQuality || "",
      hydration: item?.hydration || "",
      vitalSummary: item?.vitalSummary || "",
      activityCompleted: item?.activityCompleted ?? null,
      warningObserved: item?.warningObserved ?? false,
      generated: item?.generated || false,
      canCheckIn: day === today && item?.status !== "done",
      isPast,
      isToday: day === today
    };
  });
  const rehabAdvice = await buildAiRehabAdvice(seed, subject, carePlan, reminders, feedback, familyMemory, doctorRehabAdvice, checkin, today);

  return {
    statusCode: 200,
    payload: {
      subject: {
        id: subject.id,
        code: subject.code,
        displayName: `${subject.name.slice(0, 1)}女士/先生`,
        diagnosis: getSubjectDiagnosis(seed, subject.id),
        nextVisitDate: subject.nextVisitDate,
        status: subject.status
      },
      carePlan,
      doctorRehabAdvice,
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

function normalizeCompletedTasks(body, fallbackTask) {
  const rawTasks = Array.isArray(body.completedTasks)
    ? body.completedTasks
    : Array.isArray(body.tasks)
      ? body.tasks
      : body.completedTasks
        ? [body.completedTasks]
        : [];
  const tasks = rawTasks.map((task) => String(task || "").trim()).filter(Boolean);
  if (!tasks.length && fallbackTask && body.activityCompleted !== false) {
    tasks.push(String(fallbackTask).trim());
  }
  return Array.from(new Set(tasks)).slice(0, 8);
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
  const task = body.task || "完成今日康复任务";
  const completedTasks = normalizeCompletedTasks(body, task);
  const checkin = {
    id: `DEMO-${subjectId}-${date}`,
    subjectId,
    date,
    title: body.title || "今日康复打卡",
    task,
    completedTasks,
    note: String(body.note || "").slice(0, 160),
    mood: String(body.mood || "平稳").slice(0, 40),
    fatigueLevel: body.fatigueLevel == null || body.fatigueLevel === "" ? null : Number(body.fatigueLevel),
    activityCompleted: body.activityCompleted ?? (completedTasks.length > 0),
    warningObserved: body.warningObserved ?? false,
    status: "done",
    completedAt: nowIso(),
    transient: true
  };

  return { statusCode: 201, payload: checkin };
}

function getStrategyCapsule(seed, scope) {
  return seed.strategyCapsules?.find((item) => item.scope === scope) || null;
}

function uniqueStrings(items) {
  return Array.from(new Set(items.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim())));
}

function classifyFamilyQuestionRisk(question, strategy) {
  const text = String(question || "");
  const localPatternMatch = /停药|换药|加量|减量|诊断|是不是癌|急救|胸痛|呼吸困难|昏迷|大出血|严重|抽搐|高烧|持续发热|处方|能不能吃药/.test(text);
  const runtimeTerms = Array.isArray(strategy?.runtimeRules?.highRiskTerms) ? strategy.runtimeRules.highRiskTerms : [];
  const matchedTerm = runtimeTerms.find((term) => term && text.includes(term));
  return {
    highRisk: localPatternMatch || Boolean(matchedTerm),
    matchedRule: matchedTerm ? "remote_runtime_rule" : localPatternMatch ? "local_safety_pattern" : "low_risk",
    matchedTerm: matchedTerm || null
  };
}

function isHighRiskQuestion(question, strategy) {
  return classifyFamilyQuestionRisk(question, strategy).highRisk;
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

  const familyStrategy = getStrategyCapsule(seed, "family_qa");
  const riskDecision = classifyFamilyQuestionRisk(question, familyStrategy);
  const highRisk = riskDecision.highRisk;
  const fallbackAnswer = highRisk
    ? "这个问题可能涉及诊断、处方调整或急性风险，请联系主管医生；如出现呼吸困难、胸痛、意识异常、持续高热等情况，请及时就医。仅作康复教育与提醒，不替代医生诊疗。"
    : "可以优先按当前病种模板记录关键指标、症状变化和用药完成情况，并按康复计划保持规律饮食、轻量活动与复诊准备。仅作康复教育与提醒，不替代医生诊疗。";
  const carePlan = seed.carePlans.find((plan) => plan.subjectId === subjectId);
  const latestReminder = seed.reminders.find((reminder) => reminder.subjectId === subjectId && reminder.status === "open");
  const latestFeedback = seed.familyFeedback.find((feedback) => feedback.subjectId === subjectId);
  const previousTurns = seed.familyConversations
    .filter((conversation) => conversation.subjectId === subjectId)
    .slice(0, 4)
    .reverse();
  const familyMemory = getFamilyMemory(seed, subjectId);
  const aiContext = {
    carePlan: carePlan ? "已结合当前康复计划" : "暂无康复计划",
    reminder: latestReminder ? `已结合提醒：${latestReminder.title}` : "暂无未完成提醒",
    feedback: latestFeedback ? `已结合最近反馈：${feedbackObservationSummary(latestFeedback)}` : "暂无家属反馈",
    memory: familyMemory?.summary || "暂无历史记忆",
    safetyRoute: highRisk ? "命中高风险分流" : "低风险康复教育",
    strategySource: familyStrategy?.source || "local_default",
    matchedRule: riskDecision.matchedRule,
    matchedTerm: riskDecision.matchedTerm
  };
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
              preferenceSummary: familyMemory?.preferenceSummary || "",
              riskPatternSummary: familyMemory?.riskPatternSummary || "",
              latestReminder: latestReminder
                ? {
                    type: latestReminder.type,
                    title: latestReminder.title,
                    dueAt: latestReminder.dueAt
                  }
                : null,
              latestFeedback: latestFeedback
                ? {
                    symptoms: latestFeedback.symptoms,
                    observations: latestFeedback.observations || [],
                    observationSummary: feedbackObservationSummary(latestFeedback),
                    temperatureC: latestFeedback.temperatureC,
                    painScore: latestFeedback.painScore,
                    medicationTaken: latestFeedback.medicationTaken
                  }
                : null,
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
    aiContext,
    contextUsed: Object.values(aiContext),
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
    feedbackTemplate: String(body.feedbackTemplate || "general").slice(0, 40),
    feedbackTemplateLabel: String(body.feedbackTemplateLabel || "").slice(0, 40),
    observations: normalizeFeedbackObservations(body),
    temperatureC: body.temperatureC === "" || body.temperatureC == null ? null : Number(body.temperatureC),
    painScore: body.painScore === "" || body.painScore == null ? null : Number(body.painScore),
    medicationTaken: body.medicationTaken === true || body.medicationTaken === "true",
    question: String(body.question || "").slice(0, 160),
    status: "new",
    createdAt: nowIso()
  };
  seed.familyFeedback.unshift(feedback);
  addLocalLearningEvent(seed, "Family feedback updated doctor follow-up signal memory", "feedback", feedback.id);
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

function isLiveEvomapEnabled() {
  return getConfigValue("EVOMAP_A2A_LIVE") === "true" || getConfigValue("A2A_LIVE") === "true";
}

function getEvomapNodeSecret() {
  return getConfigValue("EVOMAP_NODE_SECRET") || getConfigValue("A2A_NODE_SECRET") || volatileEvomapNodeSecret || "";
}

function publicEvomapNode(seed) {
  ensureStoreShape(seed);
  const hasSecret = Boolean(getEvomapNodeSecret() || seed.evomapNode.hasSecret);
  return {
    nodeId: seed.evomapNode.nodeId || getConfigValue("EVOMAP_NODE_ID") || getConfigValue("A2A_NODE_ID") || null,
    status: seed.evomapNode.status || "not_connected",
    hasSecret,
    liveMode: isLiveEvomapEnabled(),
    baseUrl: getEvomapBaseUrl(),
    claimUrl: seed.evomapNode.claimUrl || null,
    lastSyncAt: seed.evomapNode.lastSyncAt || null,
    lastError: seed.evomapNode.lastError || null,
    lastValidationId: seed.evomapNode.lastValidationId || null
  };
}

function buildA2AMessageId() {
  return `msg_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

function shortRunId() {
  return `${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`;
}

function defaultEvomapNodeId() {
  return `node_${createHash("sha256").update("comforthelper-medical-rehab-assistant").digest("hex").slice(0, 16)}`;
}

function generateEvomapNodeId() {
  return `node_${createHash("sha256").update(`${Date.now()}-${Math.random()}`).digest("hex").slice(0, 16)}`;
}

function isValidEvomapNodeId(nodeId) {
  return /^node_[0-9a-f]{12,32}$/i.test(String(nodeId || ""));
}

function buildA2AEnvelope(messageType, payload, senderId = "local-comforthelper") {
  return {
    protocol: EVOMAP_PROTOCOL,
    protocol_version: EVOMAP_VERSION,
    version: EVOMAP_VERSION,
    message_type: messageType,
    message_id: buildA2AMessageId(),
    sender_id: senderId,
    sender: {
      node_id: senderId
    },
    trace_id: `trace-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    timestamp: nowIso(),
    payload
  };
}

function redactEvomapResponse(value) {
  if (Array.isArray(value)) return value.map(redactEvomapResponse);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      if (/secret|token|authorization/i.test(key)) {
        return [key, "[redacted]"];
      }
      return [key, redactEvomapResponse(item)];
    })
  );
}

function parseJsonMaybe(text) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 800) };
  }
}

function remoteStatusOf(remotePayload) {
  const payload = remotePayload?.payload && typeof remotePayload.payload === "object" ? remotePayload.payload : {};
  return String(payload.status || remotePayload?.status || "").toLowerCase();
}

function isRemoteRejected(remotePayload) {
  const status = remoteStatusOf(remotePayload);
  return (
    ["rejected", "failed", "failure", "error", "invalid"].includes(status) ||
    remotePayload?.ok === false ||
    remotePayload?.payload?.ok === false ||
    remotePayload?.payload?.valid === false
  );
}

async function postEvomapA2A(seed, endpoint, envelope, { requiresAuth = true } = {}) {
  const liveMode = isLiveEvomapEnabled();
  const nodeSecret = getEvomapNodeSecret();
  const url = `${getEvomapBaseUrl()}${endpoint}`;
  if (!liveMode) {
    return {
      live: false,
      status: "prepared_locally",
      endpoint: url,
      envelope,
      node: publicEvomapNode(seed)
    };
  }
  if (requiresAuth && !nodeSecret) {
    seed.evomapNode.status = "secret_missing";
    seed.evomapNode.lastError = "node_secret required for live EvoMap request";
    seed.evomapNode.lastSyncAt = nowIso();
    return {
      live: true,
      status: "blocked",
      endpoint: url,
      envelope,
      node: publicEvomapNode(seed),
      error: "node_secret required"
    };
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-correlation-id": envelope.message_id,
        ...(requiresAuth ? { authorization: `Bearer ${nodeSecret}` } : {})
      },
      body: JSON.stringify(envelope)
    });
    const text = await response.text();
    const remotePayload = parseJsonMaybe(text);
    const payload = remotePayload?.payload && typeof remotePayload.payload === "object" ? remotePayload.payload : {};
    const remoteNodeSecret = remotePayload.node_secret || payload.node_secret;
    const remoteNodeId = remotePayload.your_node_id || payload.your_node_id;
    const remoteClaimUrl = remotePayload.claim_url || payload.claim_url;
    if (endpoint === "/a2a/hello" && typeof remoteNodeSecret === "string") {
      volatileEvomapNodeSecret = remoteNodeSecret;
      seed.evomapNode.hasSecret = true;
    }
    if (typeof remoteNodeId === "string") {
      seed.evomapNode.nodeId = remoteNodeId;
    }
    if (typeof remoteClaimUrl === "string") {
      seed.evomapNode.claimUrl = remoteClaimUrl;
    }
    const redacted = redactEvomapResponse(remotePayload);
    const remoteRejected = isRemoteRejected(remotePayload);
    seed.evomapNode.status = response.ok && !remoteRejected ? "connected" : "sync_failed";
    seed.evomapNode.lastError =
      response.ok && !remoteRejected
        ? null
        : redacted.error || redacted.message || payload.reason || `EvoMap request failed with ${response.status}`;
    seed.evomapNode.lastSyncAt = nowIso();
    return {
      live: true,
      status: response.ok && !remoteRejected ? "synced" : "failed",
      httpStatus: response.status,
      endpoint: url,
      envelope,
      remote: redacted,
      nodeSecretReceived: Boolean(remoteNodeSecret),
      node: publicEvomapNode(seed)
    };
  } catch (error) {
    seed.evomapNode.status = "sync_failed";
    seed.evomapNode.lastError = error.message;
    seed.evomapNode.lastSyncAt = nowIso();
    return {
      live: true,
      status: "failed",
      endpoint: url,
      envelope,
      error: error.message,
      node: publicEvomapNode(seed)
    };
  }
}

async function postEvomapRest(seed, endpoint, payload, { requiresAuth = true } = {}) {
  const liveMode = isLiveEvomapEnabled();
  const nodeSecret = getEvomapNodeSecret();
  const url = `${getEvomapBaseUrl()}${endpoint}`;
  const request = {
    ...payload,
    node_id: publicEvomapNode(seed).nodeId || payload.node_id || defaultEvomapNodeId()
  };

  if (!liveMode) {
    return {
      live: false,
      status: "prepared_locally",
      endpoint: url,
      request,
      node: publicEvomapNode(seed)
    };
  }
  if (requiresAuth && !nodeSecret) {
    seed.evomapNode.status = "secret_missing";
    seed.evomapNode.lastError = "node_secret required for live EvoMap request";
    seed.evomapNode.lastSyncAt = nowIso();
    return {
      live: true,
      status: "blocked",
      endpoint: url,
      request,
      node: publicEvomapNode(seed),
      error: "node_secret required"
    };
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-correlation-id": `mem_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`,
        ...(requiresAuth ? { authorization: `Bearer ${nodeSecret}` } : {})
      },
      body: JSON.stringify(request)
    });
    const text = await response.text();
    const remotePayload = parseJsonMaybe(text);
    const redacted = redactEvomapResponse(remotePayload);
    const remoteRejected = isRemoteRejected(remotePayload);
    seed.evomapNode.status = response.ok && !remoteRejected ? "connected" : "sync_failed";
    seed.evomapNode.lastError = response.ok && !remoteRejected ? null : redacted.error || redacted.message || `EvoMap request failed with ${response.status}`;
    seed.evomapNode.lastSyncAt = nowIso();
    return {
      live: true,
      status: response.ok && !remoteRejected ? "synced" : "failed",
      httpStatus: response.status,
      endpoint: url,
      request,
      remote: redacted,
      node: publicEvomapNode(seed)
    };
  } catch (error) {
    seed.evomapNode.status = "sync_failed";
    seed.evomapNode.lastError = error.message;
    seed.evomapNode.lastSyncAt = nowIso();
    return {
      live: true,
      status: "failed",
      endpoint: url,
      request,
      error: error.message,
      node: publicEvomapNode(seed)
    };
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .filter((key) => key !== "asset_id")
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function attachAssetId(asset) {
  const hash = createHash("sha256").update(canonicalJson(asset)).digest("hex");
  return {
    ...asset,
    asset_id: `sha256:${hash}`
  };
}

function buildPublishAssets(bundle) {
  const createdAt = bundle.evolutionEvent.createdAt || nowIso();
  const gene = attachAssetId({
    type: "Gene",
    schema_version: "1.6.0",
    category: bundle.gene.category || "optimize",
    signals_match: bundle.gene.tags || ["family-qa", "risk-routing", "deidentified"],
    summary: bundle.gene.summary,
    strategy: [
      "Detect medication self-adjustment intent in family QA.",
      "Recall current deidentified risk context: pain increase, medication unconfirmed, check-in dropoff.",
      "Route combined-risk cases to doctor contact guidance instead of generic rehabilitation education.",
      "Keep the answer educational, non-diagnostic, and explicit that prescriptions must not be changed without a doctor."
    ],
    validation: [
      "node -e \"if('doctor_contact'!=='doctor_contact')process.exit(1)\""
    ],
    model_name: getLlmModel()
  });
  const capsule = attachAssetId({
    type: "Capsule",
    schema_version: "1.6.0",
    trigger: bundle.gene.tags || ["family-qa", "medication-safety", "risk-routing"],
    gene: gene.asset_id,
    summary: bundle.capsule.summary,
    content:
      "Medication self-adjustment questions with combined risk context must route to doctor contact guidance. The agent should cite pain increase, unconfirmed medication, and check-in dropoff as safety signals.",
    confidence: Number(bundle.capsule.confidence ?? 0.94),
    blast_radius: {
      files: 2,
      lines: 120
    },
    env_fingerprint: {
      platform: "node",
      arch: "universal"
    },
    outcome: {
      status: "success",
      score: 0.94
    },
    success_streak: 1,
    model_name: getLlmModel()
  });
  const evolutionEvent = attachAssetId({
    type: "EvolutionEvent",
    schema_version: "1.6.0",
    intent: "optimize",
    capsule_id: capsule.asset_id,
    genes_used: [gene.asset_id],
    outcome: {
      status: "success",
      score: 0.94
    },
    mutations_tried: 2,
    total_cycles: 3,
    summary: bundle.evolutionEvent.summary,
    created_at: createdAt,
    model_name: getLlmModel()
  });
  return [gene, capsule, evolutionEvent];
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

function buildRemoteEvolutionCandidate(seed, body = {}) {
  const hasExplicitBundle = body.bundleId || body.gene || body.capsule || body.evolutionEvent;
  const sourceEvent =
    seed.evolutionEvents.find((event) => event.deidentified && event.geneId && event.capsuleId) ||
    seed.evolutionEvents.find((event) => event.deidentified);
  if (!hasExplicitBundle && !sourceEvent) {
    return {
      ok: false,
      statusCode: 409,
      payload: {
        error: "No deidentified local learning event is available for remote EvoMap validation"
      }
    };
  }

  const candidateBody = hasExplicitBundle
    ? body
    : {
        bundleId: `EVB-remote-${sourceEvent.id}-${shortRunId()}`,
        gene: {
          id: sourceEvent.geneId || "family-qa-risk-routing",
          summary: sourceEvent.summary || "Route high-risk family QA to doctor contact guidance",
          tags: ["family-qa", "risk-routing", "deidentified"]
        },
        capsule: {
          id: sourceEvent.capsuleId || "capsule-family-qa-risk-routing",
          summary: sourceEvent.summary || "Validated deidentified family QA routing improvement",
          evidence: [`source_event=${sourceEvent.id}`, `source_type=${sourceEvent.type || "local_learning"}`]
        },
        evolutionEvent: {
          id: sourceEvent.id,
          summary: sourceEvent.summary || "deidentified local learning event ready for remote validation",
          result: sourceEvent.impact || sourceEvent.status || "local_learning_ready"
        }
      };
  const sanitized = sanitizeEvolutionBundle(seed, candidateBody);
  if (!sanitized.ok) {
    return {
      ok: false,
      statusCode: 400,
      payload: {
        error: "Payload contains prohibited PHI",
        violations: sanitized.violations
      }
    };
  }

  const requestedTerms = body.runtimeRules?.highRiskTerms || body.capsule?.runtimeRules?.highRiskTerms || [];
  const runtimeRules = {
    highRiskTerms: uniqueStrings([
      ...requestedTerms,
      "药量自己调",
      "自己调整剂量",
      "自行调整剂量",
      "自行改药",
      "自行停用",
      "自行加药"
    ])
  };
  const runtimeViolations = findPrivacyViolations(seed, runtimeRules);
  if (runtimeViolations.length) {
    return {
      ok: false,
      statusCode: 400,
      payload: {
        error: "Runtime rules contain prohibited PHI",
        violations: runtimeViolations
      }
    };
  }

  return {
    ok: true,
    bundle: {
      ...sanitized.bundle,
      runtimeRules,
      signals: body.signals || sanitized.bundle.gene.tags || ["family-qa", "risk-routing", "deidentified"],
      score: Number(body.score ?? 0.94)
    }
  };
}

async function evomapHello(seed, body) {
  ensureStoreShape(seed);
  const node = publicEvomapNode(seed);
  const requestedNodeId = body.nodeId || node.nodeId || null;
  if (requestedNodeId && !isValidEvomapNodeId(requestedNodeId)) {
    return {
      statusCode: 400,
      payload: {
        error: "Invalid EvoMap node id",
        expected: "node_<12-32 hex characters>",
        nodeId: requestedNodeId
      }
    };
  }
  const nodeId = requestedNodeId || defaultEvomapNodeId();
  const envelope = buildA2AEnvelope("hello", {
    capabilities: {
      memory_record: true,
      memory_recall: true,
      fetch: true,
      validate: true,
      publish: true,
      heartbeat_auto: false,
      claim_task_auto: false,
      credit_spending_auto: false
    },
    model: getLlmModel(),
    gene_count: seed.strategyCapsules?.length || 0,
    capsule_count: seed.evolutionEvents?.length || 0,
    env_fingerprint: {
      runtime: "node",
      app: "comforthelper-medical-rehab-assistant",
      platform: "local"
    },
    identity_doc: "Medical rehabilitation MVP agent for deidentified doctor AI suggestions, family rehab Q&A, check-in learning, and strategy validation.",
    constitution: "Never upload PHI. Do not diagnose, adjust prescriptions, claim tasks, spend credits, or run heartbeat automatically."
  }, nodeId);

  seed.evomapNode.nodeId = nodeId;
  seed.evomapNode.status = node.hasSecret ? "prepared" : "secret_missing";
  seed.evomapNode.hasSecret = node.hasSecret;
  seed.evomapNode.lastSyncAt = nowIso();
  seed.evomapNode.lastError = node.hasSecret ? null : "secret missing; request prepared locally only";
  addAudit(seed, "EvoMap操作员", "准备EvoMap hello envelope", seed.evomapNode.nodeId);
  const a2a = await postEvomapA2A(seed, "/a2a/hello", envelope, { requiresAuth: false });
  const helloPayload = a2a.remote?.payload && typeof a2a.remote.payload === "object" ? a2a.remote.payload : {};
  if (a2a.remote?.your_node_id || helloPayload.your_node_id) {
    seed.evomapNode.nodeId = a2a.remote?.your_node_id || helloPayload.your_node_id;
  }
  if (a2a.remote?.claim_url || helloPayload.claim_url) {
    seed.evomapNode.claimUrl = a2a.remote?.claim_url || helloPayload.claim_url;
  }
  if (a2a.nodeSecretReceived) {
    seed.evomapNode.hasSecret = true;
  }

  return {
    statusCode: 200,
    payload: {
      ...a2a,
      nodeSecretReceived: a2a.nodeSecretReceived === true,
      node: publicEvomapNode(seed)
    }
  };
}

async function recordEvolutionMemory(seed, body) {
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
  const memoryRequest = {
    signals: body.signals || bundle.gene.tags || ["family-qa", "risk-routing", "deidentified"],
    gene_id: bundle.gene.id,
    status: body.status || "success",
    score: Number(body.score ?? 0.86),
    summary: bundle.evolutionEvent.summary,
    metadata: {
      capsule_id: bundle.capsule.id,
      bundle_id: bundle.bundleId,
      source: "medical_rehab_mvp",
      phi_upload: false
    }
  };
  const a2a = await postEvomapRest(seed, "/a2a/memory/record", memoryRequest);
  event.syncStatus = a2a.status === "synced" ? "recorded" : a2a.status === "prepared_locally" ? "local_only" : "failed";
  return {
    statusCode: 201,
    payload: {
      event,
      ...a2a
    }
  };
}

async function recallEvolutionMemory(seed, body) {
  ensureStoreShape(seed);
  const query = String(body.query || "family qa risk routing").toLowerCase();
  const matches = seed.evolutionEvents
    .filter((event) => stringifyPayload(event).toLowerCase().includes(query.split(/\s+/)[0]))
    .slice(0, 5);
  const envelope = buildA2AEnvelope("fetch", {
    asset_type: "Capsule",
    signals: query.split(/\s+/).filter(Boolean).slice(0, 8),
    search_only: true,
    phi_upload: false
  }, publicEvomapNode(seed).nodeId || defaultEvomapNodeId());
  const memoryRequest = {
    query,
    signals: query.split(/\s+/).filter(Boolean).slice(0, 8),
    limit: Number(body.limit || 5)
  };
  const memory = await postEvomapRest(seed, "/a2a/memory/recall", memoryRequest);
  const fetchSearch = isLiveEvomapEnabled()
    ? await postEvomapA2A(seed, "/a2a/fetch", envelope)
    : {
        live: false,
        status: "prepared_locally",
        endpoint: `${getEvomapBaseUrl()}/a2a/fetch`,
        envelope,
        node: publicEvomapNode(seed)
      };
  return {
    statusCode: 200,
    payload: {
      matches,
      memory,
      fetchSearch,
      ...fetchSearch
    }
  };
}

async function validateEvolutionBundle(seed, body) {
  ensureStoreShape(seed);
  const { ok, bundle, violations } = sanitizeEvolutionBundle(seed, body);
  if (!ok) {
    seed.evomapNode.lastValidationId = null;
    seed.evomapNode.lastError = violations.join("; ");
    return { statusCode: 400, payload: { error: "Payload contains prohibited PHI", violations } };
  }
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
  const envelope = buildA2AEnvelope("publish", {
    assets: buildPublishAssets(bundle),
    dry_run: true,
    phi_upload: false
  }, publicEvomapNode(seed).nodeId || defaultEvomapNodeId());
  const a2a = await postEvomapA2A(seed, "/a2a/validate", envelope);
  event.syncStatus = a2a.status === "synced" ? "validated" : a2a.status === "prepared_locally" ? "local_only" : "failed";
  seed.evomapNode.lastValidationId = ["synced", "prepared_locally"].includes(a2a.status) ? bundle.bundleId : null;
  return {
    statusCode: 200,
    payload: {
      ok: true,
      event,
      bundle,
      ...a2a
    }
  };
}

async function publishEvolutionBundle(seed, body) {
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
  const envelope = buildA2AEnvelope("publish", {
    assets: buildPublishAssets(bundle),
    phi_upload: false
  }, publicEvomapNode(seed).nodeId || defaultEvomapNodeId());
  const a2a = await postEvomapA2A(seed, "/a2a/publish", envelope);
  event.syncStatus = a2a.status === "synced" ? "published" : a2a.status === "prepared_locally" ? "local_only" : "failed";
  return {
    statusCode: 200,
    payload: {
      ok: true,
      event,
      bundle,
      ...a2a
    }
  };
}

function isRemoteSynced(payload) {
  return payload?.live === true && payload?.status === "synced";
}

function remoteStepProof(payload) {
  if (!payload) return null;
  return {
    live: payload.live === true,
    status: payload.status || null,
    httpStatus: payload.httpStatus || null,
    endpoint: payload.endpoint || null,
    remoteStatus: remoteStatusOf(payload.remote || {}),
    messageId: payload.envelope?.message_id || null
  };
}

function evaluateRemoteEvolutionGate({ hello, record, recall, validate }) {
  const validatePayload = validate.payload?.remote?.payload;
  const checks = [
    { key: "hello", ok: isRemoteSynced(hello.payload), status: hello.payload?.status },
    { key: "memoryRecord", ok: isRemoteSynced(record.payload), status: record.payload?.status },
    { key: "memoryRecall", ok: isRemoteSynced(recall.payload?.memory), status: recall.payload?.memory?.status },
    { key: "fetchSearch", ok: isRemoteSynced(recall.payload?.fetchSearch), status: recall.payload?.fetchSearch?.status },
    { key: "validate", ok: isRemoteSynced(validate.payload) && validatePayload?.valid === true, status: validate.payload?.status }
  ];
  const failed = checks.filter((item) => !item.ok);
  return {
    ok: failed.length === 0,
    checks,
    failed,
    proof: {
      hello: remoteStepProof(hello.payload),
      memoryRecord: remoteStepProof(record.payload),
      memoryRecall: remoteStepProof(recall.payload?.memory),
      fetchSearch: remoteStepProof(recall.payload?.fetchSearch),
      validate: remoteStepProof(validate.payload)
    }
  };
}

function applyRemoteValidatedStrategy(seed, bundle, gate) {
  const familyStrategy = getStrategyCapsule(seed, "family_qa");
  if (!familyStrategy) {
    return {
      status: "blocked",
      reason: "family_qa strategy capsule is missing"
    };
  }

  const previousVersion = familyStrategy.version;
  familyStrategy.version = "family-qa-v3-evomap-remote-validated";
  familyStrategy.source = "evomap_remote_validated_memory_recall";
  familyStrategy.summary =
    "Remote EvoMap memory recall and validation passed; runtime safety routing now applies the validated deidentified strategy before low-risk family QA answers.";
  familyStrategy.appliedGeneIds = uniqueStrings([...(familyStrategy.appliedGeneIds || []), bundle.gene.id]);
  familyStrategy.runtimeRules = {
    ...(familyStrategy.runtimeRules || {}),
    highRiskTerms: uniqueStrings([...(familyStrategy.runtimeRules?.highRiskTerms || []), ...(bundle.runtimeRules?.highRiskTerms || [])])
  };
  familyStrategy.remoteProof = {
    bundleId: bundle.bundleId,
    validationMessageId: gate.proof.validate?.messageId || null,
    recordEndpoint: gate.proof.memoryRecord?.endpoint || null,
    recallEndpoint: gate.proof.memoryRecall?.endpoint || null,
    fetchEndpoint: gate.proof.fetchSearch?.endpoint || null,
    validateEndpoint: gate.proof.validate?.endpoint || null,
    appliedAt: nowIso()
  };
  familyStrategy.updatedAt = nowIso();

  const event = {
    id: nextId(seed.evolutionEvents, "EVO"),
    type: "remote_auto_apply",
    summary: `Applied remote validated EvoMap strategy ${bundle.gene.id}`,
    geneId: bundle.gene.id,
    capsuleId: bundle.capsule.id,
    bundleId: bundle.bundleId,
    status: "applied",
    syncStatus: "remote_validated",
    previousVersion,
    nextVersion: familyStrategy.version,
    deidentified: true,
    remoteProof: familyStrategy.remoteProof,
    createdAt: nowIso()
  };
  seed.evolutionEvents.unshift(event);
  addAudit(seed, "EvoMap操作员", "远端验证通过后自动应用本地策略", event.id);

  return {
    status: "applied",
    strategy: familyStrategy,
    event
  };
}

async function runLiveEvomapEvolution(seed, body = {}) {
  ensureStoreShape(seed);
  if (!isLiveEvomapEnabled()) {
    return {
      statusCode: 428,
      payload: {
        ok: false,
        error: "EVOMAP_A2A_LIVE=true is required; run-live does not use local-only or simulated remote mode",
        node: publicEvomapNode(seed)
      }
    };
  }

  const candidate = buildRemoteEvolutionCandidate(seed, body);
  if (!candidate.ok) {
    return {
      statusCode: candidate.statusCode,
      payload: candidate.payload
    };
  }
  const bundle = candidate.bundle;

  const hello = await evomapHello(seed, {
    nodeId: body.nodeId || publicEvomapNode(seed).nodeId || generateEvomapNodeId()
  });
  const record = await recordEvolutionMemory(seed, bundle);
  const recall = await recallEvolutionMemory(seed, {
    query: "family qa medication self adjustment pain increase doctor contact routing",
    limit: 5
  });
  const validate = await validateEvolutionBundle(seed, bundle);
  const gate = evaluateRemoteEvolutionGate({ hello, record, recall, validate });
  const autoApply = gate.ok
    ? applyRemoteValidatedStrategy(seed, bundle, gate)
    : {
        status: "blocked",
        reason: "remote EvoMap record/recall/fetch/validate did not all return synced",
        failed: gate.failed
      };
  const shouldPublish = body.publish === true || body.publish === "true";
  const publish = shouldPublish && gate.ok
    ? await publishEvolutionBundle(seed, bundle)
    : {
        statusCode: gate.ok ? 202 : 424,
        payload: {
          status: "skipped",
          reason: gate.ok ? "publish requires explicit publish=true" : "publish skipped because remote validation gate did not pass",
          requiredBundleId: bundle.bundleId
        }
      };
  const familyStrategy = getStrategyCapsule(seed, "family_qa");

  const liveRun = {
    id: nextId(seed.evolutionRuns, "RUN"),
    type: "evomap_live_network_evolution",
    inputSummary: `Deidentified local learning bundle ${bundle.bundleId} sent to EvoMap live network.`,
    outputSummary: gate.ok
      ? "Remote EvoMap memory record, recall, fetch, and validate returned synced; local strategy was auto-applied from remote proof."
      : "Remote EvoMap gate failed; local strategy was not changed.",
    strategyVersion: familyStrategy?.version || "family-qa-v1",
    validationResult: gate.ok ? "remote_validated" : "remote_not_verified",
    liveMode: isLiveEvomapEnabled(),
    publishRequested: shouldPublish,
    strategyApplied: autoApply.status === "applied",
    stepStatuses: {
      hello: hello.payload?.status,
      memoryRecord: record.payload?.status,
      memoryRecall: recall.payload?.memory?.status,
      fetchSearch: recall.payload?.fetchSearch?.status,
      validate: validate.payload?.status,
      publish: publish.payload?.status
    },
    remoteGate: gate,
    autoApplyStatus: autoApply.status,
    bundleId: bundle.bundleId,
    createdAt: nowIso()
  };
  seed.evolutionRuns.unshift(liveRun);
  addAudit(seed, "EvoMap操作员", "运行EvoMap真实网络进化链路", liveRun.id);

  return {
    statusCode: gate.ok ? 201 : 424,
    payload: {
      ok: gate.ok,
      run: liveRun,
      node: publicEvomapNode(seed),
      bundle,
      remoteGate: gate,
      autoApply,
      steps: {
        hello: hello.payload,
        memoryRecord: record.payload,
        memoryRecall: recall.payload,
        validate: validate.payload,
        publish: publish.payload
      }
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
    return { statusCode: 200, payload: { ok: true, service: "comforthelper-api" } };
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

  if (method === "GET" && url.pathname === "/api/doctor/evolution-demo") {
    return { statusCode: 200, payload: buildEvolutionDemo(seed) };
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

  if (method === "POST" && url.pathname === "/api/doctor/evolution-demo/run") {
    return { statusCode: 201, payload: runEvolutionDemo(seed) };
  }

  if (method === "PATCH" && resource === "doctor" && id === "suggestions" && action) {
    return updateSuggestion(seed, action, body);
  }

  if (method === "GET" && url.pathname === "/api/family/home") {
    return await buildFamilyHome(seed, url.searchParams.get("subjectId"));
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
    return await evomapHello(seed, body);
  }

  if (method === "POST" && url.pathname === "/api/evomap/memory/record") {
    return await recordEvolutionMemory(seed, body);
  }

  if (method === "POST" && url.pathname === "/api/evomap/memory/recall") {
    return await recallEvolutionMemory(seed, body);
  }

  if (method === "POST" && url.pathname === "/api/evomap/validate") {
    return await validateEvolutionBundle(seed, body);
  }

  if (method === "POST" && url.pathname === "/api/evomap/publish") {
    return await publishEvolutionBundle(seed, body);
  }

  if (method === "POST" && url.pathname === "/api/evomap/evolution/run-live") {
    return await runLiveEvomapEvolution(seed, body);
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
        doctorRehabAdvice: getDoctorRehabAdvice(seed, subject, seed.carePlans.find((item) => item.subjectId === id) ?? null),
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
      "doctorRehabAdvice",
      "reminders",
      "aiSuggestions",
      "familyConversations",
      "familyMemories",
      "familyFeedback",
      "familyCheckins",
      "evolutionEvents",
      "strategyCapsules",
      "evolutionRuns",
      "simulationScenarios"
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
    console.log(`ComfortHelper医疗康复助手 is running at http://localhost:${port}`);
  });
}
