export const PATH_LENGTH = 10;
const MAX_ANIMATED_STEPS = 150;

export function sumDeductions(events) {
  return events.reduce(function (total, event) {
    return total + Math.max(0, -(Number(event.delta) || 0));
  }, 0);
}

export function pathSnapshot(state) {
  return {
    classScore: state.classScore,
    pending: state.pending.slice(),
    totalContributions: state.totalContributions,
    totalDeductions: state.totalDeductions
  };
}

function historicalPath(conversion, level) {
  const contributions = Array.isArray(conversion?.contributions) ? conversion.contributions : [];
  return Array.from({ length: PATH_LENGTH }, function (_, index) {
    return contributions[index] || { id: 'archived-' + level + '-' + index };
  });
}

export function applyPath(state, events, students, pastConversions, legacyDeductions, now, makeId) {
  state.classScore = Math.max(0, Math.trunc(Number(state.classScore) || 0));
  state.pending = Array.isArray(state.pending) ? state.pending.slice(0, PATH_LENGTH - 1) : [];
  state.totalContributions = Number(state.totalContributions) || 0;
  state.totalDeductions = Number.isFinite(state.totalDeductions) ? state.totalDeductions : legacyDeductions;
  const before = pathSnapshot(state);
  const steps = [];
  const earned = [];
  const reopened = [];
  const activeEggs = new Map();
  pastConversions.forEach(function (record) {
    const existing = activeEggs.get(record.classScoreAfter);
    if (!record.reversedAt && (!existing || record.createdAt >= existing.createdAt)) {
      activeEggs.set(record.classScoreAfter, record);
    }
  });

  let condensed = false;
  function step(kind, details) {
    if (steps.length < MAX_ANIMATED_STEPS) steps.push({ kind, ...details });
    else condensed = true;
  }

  events.forEach(function (event, index) {
    const student = students[index];
    if (event.delta > 0) {
      for (let point = 0; point < event.delta; point += 1) {
        const contribution = {
          id: makeId(), studentId: student.id, studentName: student.name, avatarId: student.avatarId || null,
          scoreEventId: event.id, createdAt: now
        };
        state.pending.push(contribution);
        state.totalContributions += 1;
        step('arrive', { contribution });
        if (state.pending.length === PATH_LENGTH) {
          state.classScore += 1;
          earned.push({
            id: makeId(), classId: state.classId, classScoreAfter: state.classScore,
            contributions: state.pending, createdAt: now
          });
          state.pending = [];
          step('earn', { classScore: state.classScore });
        }
      }
      return;
    }

    state.totalDeductions += -event.delta;
    for (let point = 0; point > event.delta && (state.pending.length || state.classScore); point -= 1) {
      if (!state.pending.length) {
        const level = state.classScore;
        const previous = activeEggs.get(level);
        if (previous) reopened.push({ ...previous, reversedAt: now, reversedBy: event.id });
        activeEggs.delete(level);
        state.classScore -= 1;
        state.pending = historicalPath(previous, level);
        step('open', { classScore: state.classScore, contributions: state.pending.slice() });
      }
      state.pending.pop();
      step('retreat');
    }
  });

  state.pathRevision = (Number(state.pathRevision) || 0) + 1;
  state.updatedAt = now;
  return {
    earned, reopened,
    trail: {
      revision: state.pathRevision,
      before,
      after: pathSnapshot(state),
      steps: condensed ? [] : steps,
      condensed
    }
  };
}
