import { openDatabase } from './db.js';

function uid() {
  return (crypto && crypto.randomUUID) ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2);
}

export async function applyIndividualScore(options) {
  const classId = options.classId;
  const studentId = options.studentId;
  const delta = Number(options.delta);
  const reason = String(options.reason || '');
  const source = String(options.source || 'manual');
  if (!Number.isInteger(delta) || delta === 0) throw new Error('점수 변경은 0이 아닌 정수여야 합니다.');

  const db = await openDatabase();
  return new Promise(function (resolve, reject) {
    const tx = db.transaction(['students', 'scoreEvents', 'growthStates', 'growthConversions'], 'readwrite');
    let result = null;
    let failure = null;
    const studentStore = tx.objectStore('students');
    const eventStore = tx.objectStore('scoreEvents');
    const growthStore = tx.objectStore('growthStates');
    const conversionStore = tx.objectStore('growthConversions');
    const studentRequest = studentStore.get(studentId);

    studentRequest.onerror = function () {
      failure = studentRequest.error || new Error('학생 정보를 읽지 못했습니다.');
      try { tx.abort(); } catch (error) {}
    };

    studentRequest.onsuccess = function () {
      const student = studentRequest.result;
      if (!student || student.classId !== classId) {
        failure = new Error('학생을 찾을 수 없습니다.');
        try { tx.abort(); } catch (error) {}
        return;
      }

      const now = new Date().toISOString();
      student.score = Number(student.score || 0) + delta;
      student.updatedAt = now;
      studentStore.put(student);

      const scoreEvent = {
        id: uid(),
        classId: classId,
        studentId: studentId,
        studentName: student.name,
        groupId: student.groupId || null,
        delta: delta,
        reason: reason,
        source: source,
        createdAt: now
      };
      eventStore.add(scoreEvent);

      const growthRequest = growthStore.get(classId);
      growthRequest.onerror = function () {
        failure = growthRequest.error || new Error('학급 성장 기록을 읽지 못했습니다.');
        try { tx.abort(); } catch (error) {}
      };
      growthRequest.onsuccess = function () {
        const state = growthRequest.result || {
          classId: classId, classScore: 0, pending: [], totalContributions: 0, updatedAt: now
        };
        state.pending = Array.isArray(state.pending) ? state.pending : [];
        state.totalContributions = Number(state.totalContributions || 0);
        const conversions = [];

        // 양의 개인 점수 1점마다 별길 기여 1개를 기록합니다.
        // 감점이 이미 적립된 기여를 되돌리는지는 별도 정책 결정 전까지 보류합니다.
        if (delta > 0) {
          for (let index = 0; index < delta; index += 1) {
            state.pending.push({
              id: uid(),
              studentId: studentId,
              studentName: student.name,
              avatarId: student.avatarId || null,
              scoreEventId: scoreEvent.id,
              createdAt: now
            });
            state.totalContributions += 1;

            if (state.pending.length === 10) {
              const contributions = state.pending.slice();
              state.classScore = Number(state.classScore || 0) + 1;
              const conversion = {
                id: uid(),
                classId: classId,
                classScoreAfter: state.classScore,
                contributions: contributions,
                createdAt: now
              };
              conversionStore.add(conversion);
              conversions.push(conversion);
              state.pending = [];
            }
          }
        }
        state.updatedAt = now;
        growthStore.put(state);
        result = { student: student, event: scoreEvent, growthState: state, conversions: conversions };
      };
    };

    tx.oncomplete = function () { resolve(result); };
    tx.onerror = function () { reject(failure || tx.error || new Error('점수 저장에 실패했습니다.')); };
    tx.onabort = function () { reject(failure || tx.error || new Error('점수 변경이 취소되었습니다.')); };
  });
}