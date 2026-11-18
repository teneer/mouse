import { requestResult, transact } from './db.js';
import { applyPath, sumDeductions } from './growth-path.js?v=golden-eggs';

export function adjustGoldenEggs(classId, delta) {
  if (!Number.isSafeInteger(delta) || delta === 0) throw new Error('변경할 황금알 개수를 확인해 주세요.');
  return transact(['growthStates'], 'readwrite', async function (transaction) {
    const store = transaction.objectStore('growthStates');
    const state = await requestResult(store.get(classId)) ||
      { classId, classScore: 0, pending: [], totalContributions: 0 };
    const total = Number(state.classScore || 0) + delta;
    const specialEggs = Number(state.specialEggs || 0) + delta;
    if (total < 0) throw new Error('현재 보유한 황금알보다 많이 차감할 수 없습니다.');
    if (!Number.isSafeInteger(total) || !Number.isSafeInteger(specialEggs)) {
      throw new Error('황금알 개수가 저장 가능한 범위를 벗어났습니다.');
    }
    state.classScore = total;
    state.specialEggs = specialEggs;
    state.pathRevision = (state.pathRevision || 0) + 1;
    state.updatedAt = new Date().toISOString();
    store.put(state);
    return state;
  });
}

export function applyScoreBatch(options) {
  const { classId } = options;
  const studentIds = Array.from(new Set(options.studentIds));
  const delta = Number(options.delta);
  const reason = String(options.reason || '');
  const source = String(options.source || 'manual');
  if (!studentIds.length || !Number.isSafeInteger(delta) || delta === 0) {
    throw new Error('학생과 0이 아닌 정수 점수를 입력해 주세요.');
  }

  return transact(['students', 'scoreEvents', 'growthStates', 'growthConversions'], 'readwrite', async function (transaction) {
    const studentStore = transaction.objectStore('students');
    const eventStore = transaction.objectStore('scoreEvents');
    const growthStore = transaction.objectStore('growthStates');
    const conversionStore = transaction.objectStore('growthConversions');
    const [students, savedGrowth] = await Promise.all([
      Promise.all(studentIds.map(function (id) { return requestResult(studentStore.get(id)); })),
      requestResult(growthStore.get(classId))
    ]);
    if (students.some(function (student) { return !student || student.classId !== classId || student.status === 'deleted'; })) {
      throw new Error('선택한 학생 중 명단에서 찾을 수 없는 학생이 있습니다.');
    }

    const now = new Date().toISOString();
    const growthState = savedGrowth || { classId, classScore: 0, pending: [], totalContributions: 0 };
    const [pastConversions, historicalScores] = await Promise.all([
      delta < 0 && growthState.classScore ? requestResult(conversionStore.index('classId').getAll(classId)) : [],
      Number.isFinite(growthState.totalDeductions) ? [] : requestResult(eventStore.index('classId').getAll(classId))
    ]);
    const batchId = crypto.randomUUID();
    const events = students.map(function (student) {
      student.score = Number(student.score || 0) + delta;
      student.updatedAt = now;
      studentStore.put(student);
      const event = {
        id: crypto.randomUUID(), batchId, classId, studentId: student.id, studentName: student.name,
        groupId: student.groupId || null, delta, reason, source, createdAt: now
      };
      eventStore.add(event);
      return event;
    });
    const { earned, reopened, trail } = applyPath(
      growthState, events, students, pastConversions, sumDeductions(historicalScores), now, function () { return crypto.randomUUID(); }
    );
    earned.forEach(function (record) { conversionStore.add(record); });
    reopened.forEach(function (record) { conversionStore.put(record); });
    growthStore.put(growthState);
    return { students, events, growthState, conversions: earned, trail };
  });
}

export async function applyIndividualScore(options) {
  const { students, events, growthState, conversions, trail } = await applyScoreBatch({
    ...options, studentIds: [options.studentId]
  });
  return { student: students[0], event: events[0], growthState, conversions, trail };
}
