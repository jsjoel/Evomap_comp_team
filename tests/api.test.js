import test from "node:test";
import assert from "node:assert/strict";
import { createTestStore, resolveApi } from "../apps/api/server.js";

test("health endpoint responds", async () => {
  const response = await resolveApi("/api/health");

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.ok, true);
});

test("dashboard contains study metrics and recent tasks", async () => {
  const store = await createTestStore();
  const response = await resolveApi("/api/dashboard", { store });

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.study.code, "IIT-EDC-001");
  assert.equal(response.payload.metrics.subjectsTotal, 4);
  assert.ok(response.payload.recentTasks.length > 0);
});

test("subject detail aggregates documents, visits, medications, and tasks", async () => {
  const store = await createTestStore();
  const response = await resolveApi("/api/subjects/SUBJ-002", { store });

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.name, "李强");
  assert.equal(response.payload.documents.length, 1);
  assert.equal(response.payload.extractions.length, 1);
  assert.equal(response.payload.visits.length, 1);
  assert.equal(response.payload.medications.length, 1);
  assert.equal(response.payload.tasks.length, 2);
});

test("creating a subject generates document, extraction, screening visit, task, and audit log", async () => {
  const store = await createTestStore();
  const response = await resolveApi("/api/subjects", {
    method: "POST",
    store,
    body: {
      name: "钱晓梅",
      sex: "女",
      age: 55,
      site: "上海第一中心",
      diagnosis: "肺腺癌"
    }
  });

  assert.equal(response.statusCode, 201);
  assert.equal(response.payload.subject.name, "钱晓梅");
  assert.equal(response.payload.document.subjectId, response.payload.subject.id);
  assert.equal(response.payload.extraction.fields[0].value, "肺腺癌");
  assert.equal(response.payload.visit.status, "待执行");
  assert.equal(response.payload.task.status, "open");

  const dashboard = await resolveApi("/api/dashboard", { store });
  assert.equal(dashboard.payload.metrics.subjectsTotal, 5);
  assert.equal(dashboard.payload.metrics.openTasks, 5);
});

test("bulk importing subjects creates test patients and their AI review work", async () => {
  const store = await createTestStore();
  const response = await resolveApi("/api/imports/subjects", {
    method: "POST",
    store
  });
  const dashboard = await resolveApi("/api/dashboard", { store });
  const quality = await resolveApi("/api/quality", { store });

  assert.equal(response.statusCode, 201);
  assert.equal(response.payload.importedCount, 3);
  assert.equal(response.payload.subjects.length, 3);
  assert.equal(dashboard.payload.metrics.subjectsTotal, 7);
  assert.equal(dashboard.payload.metrics.openTasks, 7);
  assert.equal(quality.payload.counters.pendingExtractions, 5);
  assert.equal(store.auditLogs[0].action, "批量导入3名测试患者");
});

test("confirming an extraction updates subject, document, tasks, metrics, and audit log", async () => {
  const store = await createTestStore();
  const response = await resolveApi("/api/extractions/EXT-002/confirm", {
    method: "POST",
    store
  });
  const subject = await resolveApi("/api/subjects/SUBJ-003", { store });
  const dashboard = await resolveApi("/api/dashboard", { store });

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.status, "confirmed");
  assert.equal(subject.payload.status, "已入组");
  assert.equal(subject.payload.documents[0].status, "已确认");
  assert.equal(subject.payload.tasks.every((task) => task.status === "done"), true);
  assert.equal(dashboard.payload.metrics.openTasks, 3);
  assert.equal(store.auditLogs[0].action, "确认AI抽取字段入档");
});

test("uploading a document for an existing subject creates extraction, review task, and audit log", async () => {
  const store = await createTestStore();
  const response = await resolveApi("/api/subjects/SUBJ-001/documents", {
    method: "POST",
    store,
    body: {
      type: "检查报告",
      fileName: "S001_followup_lab.pdf",
      primaryFieldName: "血红蛋白",
      primaryFieldValue: "122g/L"
    }
  });
  const subject = await resolveApi("/api/subjects/SUBJ-001", { store });
  const dashboard = await resolveApi("/api/dashboard", { store });

  assert.equal(response.statusCode, 201);
  assert.equal(response.payload.document.type, "检查报告");
  assert.equal(response.payload.extraction.fields[0].value, "122g/L");
  assert.equal(response.payload.task.type, "AI复核");
  assert.equal(subject.payload.documents.length, 2);
  assert.equal(subject.payload.extractions.length, 1);
  assert.equal(dashboard.payload.metrics.openTasks, 5);
  assert.equal(store.auditLogs[0].action, "上传检查报告并生成AI复核任务");
});

test("quality summary aggregates pending documents, extraction reviews, tasks, and audit logs", async () => {
  const store = await createTestStore();
  const response = await resolveApi("/api/quality", { store });

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.counters.pendingDocuments, 3);
  assert.equal(response.payload.counters.pendingExtractions, 2);
  assert.equal(response.payload.counters.openTasks, 4);
  assert.equal(response.payload.counters.auditLogs, 3);
  assert.ok(response.payload.pendingDocuments.some((document) => document.subjectName === "李强"));
  assert.ok(response.payload.pendingExtractions.some((extraction) => extraction.subjectName === "赵燕"));
  assert.ok(response.payload.openTasks.some((task) => task.subjectName === "王敏"));
});

test("doctor dashboard and AI analysis generate actionable suggestions", async () => {
  const store = await createTestStore();
  const dashboard = await resolveApi("/api/doctor/dashboard", { store });
  const analysis = await resolveApi("/api/doctor/ai/analyze", {
    method: "POST",
    store
  });

  assert.equal(dashboard.statusCode, 200);
  assert.ok(dashboard.payload.openReminders.length > 0);
  assert.ok(dashboard.payload.pendingFeedback.some((feedback) => feedback.subjectName === "王敏"));
  assert.equal(analysis.statusCode, 201);
  assert.ok(analysis.payload.createdCount > 0);
  assert.ok(store.aiSuggestions.some((suggestion) => suggestion.title.includes("提醒") || suggestion.title.includes("跟进")));
});

test("doctor can update AI suggestion status", async () => {
  const store = await createTestStore();
  const response = await resolveApi("/api/doctor/suggestions/AIS-001", {
    method: "PATCH",
    store,
    body: {
      status: "accepted"
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.status, "accepted");
  assert.equal(store.auditLogs[0].action, "AI建议状态更新为accepted");
});

test("family home exposes care plan and reminders", async () => {
  const store = await createTestStore();
  const response = await resolveApi("/api/family/home?subjectId=SUBJ-001", { store });

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.subject.id, "SUBJ-001");
  assert.equal(response.payload.carePlan.id, "PLAN-001");
  assert.equal(response.payload.rehabAdvice.title, "今日康复打卡");
  assert.ok(response.payload.checkinMonth.length >= 28);
  assert.equal(response.payload.qaPrompts.length, 3);
  assert.equal(response.payload.familyMemory.id, "MEM-001");
  assert.ok(response.payload.reminders.some((reminder) => reminder.type === "medication"));
});

test("family daily rehab checkin marks today's advice done", async () => {
  const store = await createTestStore();
  const home = await resolveApi("/api/family/home?subjectId=SUBJ-001", { store });
  const response = await resolveApi("/api/family/checkin", {
    method: "POST",
    store,
    body: {
      subjectId: "SUBJ-001",
      date: home.payload.rehabAdvice.date,
      task: home.payload.rehabAdvice.task,
      note: "已完成步行"
    }
  });
  const nextHome = await resolveApi("/api/family/home?subjectId=SUBJ-001", { store });

  assert.equal(response.statusCode, 201);
  assert.equal(response.payload.status, "done");
  assert.equal(nextHome.payload.rehabAdvice.status, "done");
  assert.equal(nextHome.payload.checkinMonth.find((day) => day.date === home.payload.rehabAdvice.date).status, "done");
  assert.equal(store.auditLogs[0].action, "完成今日康复打卡");
});

test("family QA routes low-risk questions to rehab education", async () => {
  const store = await createTestStore();
  const response = await resolveApi("/api/family/qa", {
    method: "POST",
    store,
    body: {
      subjectId: "SUBJ-001",
      question: "复诊前要记录哪些康复情况？"
    }
  });

  assert.equal(response.statusCode, 201);
  assert.equal(response.payload.riskRoute, "rehab_education");
  assert.equal(response.payload.answerProvider, "local_fallback");
  assert.equal(response.payload.familyMemory.subjectId, "SUBJ-001");
  assert.ok(response.payload.turnIndex > 0);
  assert.match(response.payload.answer, /仅作康复教育与提醒/);
});

test("family QA supports multi-turn memory and deidentified evolution events", async () => {
  const store = await createTestStore();
  const first = await resolveApi("/api/family/qa", {
    method: "POST",
    store,
    body: {
      subjectId: "SUBJ-001",
      question: "今天运动后有点累需要记录吗？"
    }
  });
  const second = await resolveApi("/api/family/qa", {
    method: "POST",
    store,
    body: {
      subjectId: "SUBJ-001",
      question: "那复诊时怎么说？"
    }
  });
  const home = await resolveApi("/api/family/home?subjectId=SUBJ-001", { store });

  assert.equal(first.statusCode, 201);
  assert.equal(second.statusCode, 201);
  assert.ok(second.payload.turnIndex > first.payload.turnIndex);
  assert.ok(home.payload.familyMemory.turnCount >= 3);
  assert.ok(store.evolutionEvents.some((event) => event.summary.includes("Family QA rehab education turn updated memory")));
});

test("family QA escalates high-risk medication and severe symptom questions", async () => {
  const store = await createTestStore();
  const response = await resolveApi("/api/family/qa", {
    method: "POST",
    store,
    body: {
      subjectId: "SUBJ-001",
      question: "现在呼吸困难，能不能停药？"
    }
  });

  assert.equal(response.statusCode, 201);
  assert.equal(response.payload.riskRoute, "doctor_contact");
  assert.equal(response.payload.answerProvider, "local_safety_guard");
  assert.match(response.payload.answer, /联系主管医生|及时就医/);
});

test("family feedback enters doctor dashboard and quality review", async () => {
  const store = await createTestStore();
  await resolveApi("/api/family/feedback", {
    method: "POST",
    store,
    body: {
      subjectId: "SUBJ-002",
      symptoms: "轻微恶心",
      temperatureC: 36.9,
      painScore: 3,
      medicationTaken: true
    }
  });
  const dashboard = await resolveApi("/api/doctor/dashboard", { store });
  const quality = await resolveApi("/api/quality", { store });

  assert.ok(dashboard.payload.pendingFeedback.some((feedback) => feedback.subjectId === "SUBJ-002"));
  assert.ok(quality.payload.familyFeedback.some((feedback) => feedback.symptoms === "轻微恶心"));
});

test("completing reminder updates doctor and family views", async () => {
  const store = await createTestStore();
  const response = await resolveApi("/api/reminders/REM-001", {
    method: "PATCH",
    store,
    body: {
      status: "done"
    }
  });
  const familyHome = await resolveApi("/api/family/home?subjectId=SUBJ-001", { store });
  const doctorDashboard = await resolveApi("/api/doctor/dashboard", { store });

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.status, "done");
  assert.ok(familyHome.payload.reminders.find((reminder) => reminder.id === "REM-001").completedAt);
  assert.equal(doctorDashboard.payload.openReminders.some((reminder) => reminder.id === "REM-001"), false);
});

test("EvoMap hello builds gep-a2a envelope without exposing node secret", async () => {
  const store = await createTestStore();
  const response = await resolveApi("/api/evomap/hello", {
    method: "POST",
    store,
    body: {
      nodeId: "local-test-node"
    }
  });
  const text = JSON.stringify(response.payload);

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.envelope.protocol, "gep-a2a");
  assert.equal(response.payload.envelope.version, "1.0.0");
  assert.equal(response.payload.envelope.message_type, "hello");
  assert.equal(text.includes("node_secret"), false);
});

test("EvoMap payloads reject patient identifiers and raw conversation text", async () => {
  const store = await createTestStore();
  const response = await resolveApi("/api/evomap/validate", {
    method: "POST",
    store,
    body: {
      capsule: {
        summary: "王敏 13800001001 raw transcript",
        evidence: ["S001_medical_record.jpg"]
      },
      rawQuestion: "真实家属问答原文"
    }
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.payload.violations.join(","), /患者标识|手机号|病历文件名|自由文本/);
});

test("EvoMap publish requires validate before publish", async () => {
  const store = await createTestStore();
  const bundle = {
    bundleId: "EVB-test-routing",
    gene: {
      id: "family-qa-risk-routing",
      summary: "Route high-risk family QA to doctor guidance"
    },
    capsule: {
      id: "capsule-family-qa-risk-routing",
      summary: "Added high-risk keyword routing and tests",
      evidence: ["high-risk route test passed"]
    }
  };
  const blocked = await resolveApi("/api/evomap/publish", {
    method: "POST",
    store,
    body: bundle
  });
  const validated = await resolveApi("/api/evomap/validate", {
    method: "POST",
    store,
    body: bundle
  });
  const published = await resolveApi("/api/evomap/publish", {
    method: "POST",
    store,
    body: bundle
  });

  assert.equal(blocked.statusCode, 409);
  assert.equal(validated.statusCode, 200);
  assert.equal(published.statusCode, 200);
  assert.equal(published.payload.envelope.message_type, "publish");
});

test("completing a visit moves the subject into follow-up and records audit", async () => {
  const store = await createTestStore();
  const response = await resolveApi("/api/visits/VIS-002", {
    method: "PATCH",
    store,
    body: {
      status: "已完成"
    }
  });
  const subject = await resolveApi("/api/subjects/SUBJ-002", { store });

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.status, "已完成");
  assert.equal(subject.payload.status, "随访中");
  assert.equal(store.auditLogs[0].action, "更新访视状态为已完成");
});

test("adjusting medication updates dose, creates review task, and records audit", async () => {
  const store = await createTestStore();
  const response = await resolveApi("/api/medications/MED-003", {
    method: "PATCH",
    store,
    body: {
      weightKg: 68,
      reason: "体重变化至68kg"
    }
  });
  const subject = await resolveApi("/api/subjects/SUBJ-004", { store });
  const dashboard = await resolveApi("/api/dashboard", { store });

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.medication.previousDose, "0.5mg/kg");
  assert.equal(response.payload.medication.dose, "34.0mg");
  assert.equal(response.payload.medication.status, "已调整");
  assert.equal(response.payload.task.type, "用药");
  assert.equal(subject.payload.risk, "warning");
  assert.equal(dashboard.payload.metrics.openTasks, 5);
  assert.equal(store.auditLogs[0].action, "调整用药剂量 0.5mg/kg -> 34.0mg");
});

test("completing a task updates metrics and audit", async () => {
  const store = await createTestStore();
  const response = await resolveApi("/api/tasks/TASK-001", {
    method: "PATCH",
    store,
    body: {
      status: "done"
    }
  });
  const dashboard = await resolveApi("/api/dashboard", { store });

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.status, "done");
  assert.equal(dashboard.payload.metrics.openTasks, 3);
  assert.equal(store.auditLogs[0].action, "更新任务状态为done");
});

test("subjects can be exported as csv", async () => {
  const store = await createTestStore();
  const response = await resolveApi("/api/exports/subjects.csv", { store });

  assert.equal(response.statusCode, 200);
  assert.equal(response.contentType, "text/csv; charset=utf-8");
  assert.ok(response.payload.includes("编号,姓名,性别,年龄,中心,状态,基线日期,下次访视"));
  assert.ok(response.payload.includes("S001,王敏"));
});

test("reset restores seed data for a mutable store", async () => {
  const store = await createTestStore();
  await resolveApi("/api/subjects", {
    method: "POST",
    store,
    body: {
      name: "钱晓梅"
    }
  });
  assert.equal(store.subjects.length, 5);

  const reset = await resolveApi("/api/admin/reset", {
    method: "POST",
    store
  });

  assert.equal(reset.statusCode, 200);
  assert.equal(store.subjects.length, 4);
  assert.equal(store.subjects[0].id, "SUBJ-001");
});

test("mvp happy path runs from test data import to quality review and export", async () => {
  const store = await createTestStore();

  const imported = await resolveApi("/api/imports/subjects", {
    method: "POST",
    store
  });
  const importedSubjectId = imported.payload.subjects[0].id;

  await resolveApi("/api/family/qa", {
    method: "POST",
    store,
    body: {
      subjectId: importedSubjectId,
      question: "复诊前应该准备哪些记录？"
    }
  });

  await resolveApi("/api/family/feedback", {
    method: "POST",
    store,
    body: {
      subjectId: importedSubjectId,
      symptoms: "轻微乏力",
      temperatureC: 36.7,
      painScore: 2,
      medicationTaken: true
    }
  });

  await resolveApi("/api/doctor/ai/analyze", {
    method: "POST",
    store
  });

  const uploaded = await resolveApi(`/api/subjects/${importedSubjectId}/documents`, {
    method: "POST",
    store,
    body: {
      type: "检查报告",
      fileName: "imported_followup_lab.pdf",
      primaryFieldName: "血红蛋白",
      primaryFieldValue: "118g/L"
    }
  });

  await resolveApi(`/api/extractions/${uploaded.payload.extraction.id}/confirm`, {
    method: "POST",
    store
  });
  await resolveApi("/api/visits/VIS-001", {
    method: "PATCH",
    store,
    body: {
      status: "已完成"
    }
  });
  await resolveApi("/api/medications/MED-003", {
    method: "PATCH",
    store,
    body: {
      weightKg: 68
    }
  });
  await resolveApi(uploaded.payload.task.id ? `/api/tasks/${uploaded.payload.task.id}` : "/api/tasks/TASK-001", {
    method: "PATCH",
    store,
    body: {
      status: "done"
    }
  });

  await resolveApi(`/api/reminders/${imported.payload.subjects[0].id ? store.reminders[0].id : "REM-001"}`, {
    method: "PATCH",
    store,
    body: {
      status: "done"
    }
  });

  const bundle = {
    bundleId: "EVB-happy-path",
    gene: {
      id: "family-qa-risk-routing",
      summary: "Route high-risk family QA to doctor guidance"
    },
    capsule: {
      id: "capsule-family-qa-risk-routing",
      summary: "Added high-risk keyword routing and tests",
      evidence: ["family QA high-risk route test passed"]
    }
  };
  await resolveApi("/api/evomap/memory/record", {
    method: "POST",
    store,
    body: bundle
  });
  await resolveApi("/api/evomap/validate", {
    method: "POST",
    store,
    body: bundle
  });
  const published = await resolveApi("/api/evomap/publish", {
    method: "POST",
    store,
    body: bundle
  });

  const dashboard = await resolveApi("/api/dashboard", { store });
  const quality = await resolveApi("/api/quality", { store });
  const exportCsv = await resolveApi("/api/exports/subjects.csv", { store });

  assert.equal(dashboard.payload.metrics.subjectsTotal, 7);
  assert.equal(dashboard.payload.metrics.openTasks, 6);
  assert.ok(quality.payload.counters.auditLogs >= 19);
  assert.ok(quality.payload.openTasks.some((task) => task.type === "用药"));
  assert.ok(quality.payload.pendingExtractions.some((extraction) => extraction.subjectName === "吴鹏"));
  assert.ok(quality.payload.familyFeedback.some((feedback) => feedback.subjectName === "孙丽"));
  assert.equal(published.statusCode, 200);
  assert.ok(exportCsv.payload.includes("孙丽"));
  assert.ok(exportCsv.payload.includes("编号,姓名,性别,年龄,中心,状态,基线日期,下次访视"));
});
