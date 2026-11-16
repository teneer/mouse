import { requestResult, transact } from './db.js';

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
    growthState.pending = Array.isArray(growthState.pending) ? growthState.pending : [];
    growthState.totalContributions = Number(growthState.totalContributions || 0);
    const conversions = [];
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

      // Growth conversion still uses the existing positive-point rule.
      for (let index = 0; index < delta; index += 1) {
        growthState.pending.push({
          id: crypto.randomUUID(), studentId: student.id, studentName: student.name,
          avatarId: student.avatarId || null, scoreEventId: event.id, createdAt: now
        });
        growthState.totalContributions += 1;
        if (growthState.pending.length === 10) {
          growthState.classScore = Number(growthState.classScore || 0) + 1;
          const conversion = {
            id: crypto.randomUUID(), classId, classScoreAfter: growthState.classScore,
            contributions: growthState.pending, createdAt: now
          };
          conversionStore.add(conversion);
          conversions.push(conversion);
          growthState.pending = [];
        }
      }
      return event;
    });
    growthState.updatedAt = now;
    growthStore.put(growthState);
    return { students, events, growthState, conversions };
  });
}

export async function applyIndividualScore(options) {
  const { students, events, growthState, conversions } = await applyScoreBatch({
    ...options, studentIds: [options.studentId]
  });
  return { student: students[0], event: events[0], growthState, conversions };
}
