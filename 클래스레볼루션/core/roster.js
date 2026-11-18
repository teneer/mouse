import { requestResult, transact } from './db.js';
import { avatarNumber, AVATAR_COUNT } from './avatar.js';

const STUDENT_SEAT_LIMIT = 200;
const GROUP_POSITION_LIMIT = 180;

function sortBy(field) {
  return function (a, b) { return Number(a[field] || 0) - Number(b[field] || 0) || String(a.id).localeCompare(String(b.id)); };
}

function place(records, position, limit) {
  const occupied = new Map();
  const unplaced = [];
  records.forEach(function (record) {
    const slot = record[position];
    if (Number.isInteger(slot) && slot >= 0 && slot < limit && !occupied.has(slot)) occupied.set(slot, record);
    else unplaced.push(record);
  });
  let free = 0;
  unplaced.forEach(function (record) {
    while (occupied.has(free)) free += 1;
    occupied.set(free, record);
  });
  return occupied;
}

export function studentSeats(students) {
  return place(students, 'seat', STUDENT_SEAT_LIMIT);
}

export function groupPositions(groups) {
  return place(groups, 'position', GROUP_POSITION_LIMIT);
}

async function readRoster(transaction, classId) {
  const [students, groups] = await Promise.all(['students', 'groups'].map(function (name) {
    return requestResult(transaction.objectStore(name).index('classId').getAll(classId));
  }));
  return {
    students: students.filter(function (student) { return student.status !== 'deleted'; }).sort(sortBy('number')),
    deletedStudents: students.filter(function (student) { return student.status === 'deleted'; }).sort(sortBy('number')),
    groups: groups.sort(sortBy('order'))
  };
}

export function loadRoster(classId) {
  return transact(['students', 'groups'], 'readonly', function (transaction) {
    return readRoster(transaction, classId);
  });
}

function updateRoster(classId, update) {
  return transact(['students', 'groups'], 'readwrite', async function (transaction) {
    const roster = await readRoster(transaction, classId);
    return update(roster, transaction.objectStore('students'), transaction.objectStore('groups'));
  });
}

function groupIdInRoster(student, groups) {
  return groups.some(function (group) { return group.id === student.groupId; }) ? student.groupId : '';
}

function seatsFor(roster, groupId) {
  return studentSeats(roster.students.filter(function (student) {
    return groupIdInRoster(student, roster.groups) === groupId;
  }));
}

function firstEmptySeat(seats) {
  let seat = 0;
  while (seats.has(seat)) seat += 1;
  return seat;
}

export function saveStudent(classId, values) {
  return updateRoster(classId, function (roster, students) {
    const previous = roster.students.find(function (student) { return student.id === values.id; });
    if (values.id && !previous) throw new Error('해당 학생을 찾을 수 없습니다.');
    const name = String(values.name || '').trim();
    const number = Number(values.number);
    if (!name || !Number.isSafeInteger(number) || number < 1) throw new Error('번호와 이름을 확인해 주세요.');
    if (number !== previous?.number && roster.students.some(function (student) { return Number(student.number) === number; })) {
      throw new Error(number + '번 학생이 이미 있습니다.');
    }
    if (values.groupId && !roster.groups.some(function (group) { return group.id === values.groupId; })) {
      throw new Error('해당 모둠을 찾을 수 없습니다.');
    }
    const now = new Date().toISOString();
    const student = {
      ...(previous || { id: crypto.randomUUID(), classId, score: 0, status: 'active', createdAt: now }),
      number, name, groupId: values.groupId || null, avatarId: avatarNumber(values.avatarId), updatedAt: now
    };
    const previousGroup = previous ? groupIdInRoster(previous, roster.groups) : null;
    const groupId = student.groupId || '';
    const destination = seatsFor(roster, groupId);
    if (previous && previousGroup === groupId) {
      student.seat = Array.from(destination).find(function ([, member]) { return member.id === student.id; })[0];
    } else {
      student.seat = firstEmptySeat(destination);
      if (previous) {
        seatsFor(roster, previousGroup).forEach(function (member, seat) {
          if (member.id !== student.id && member.seat !== seat) students.put({ ...member, seat });
        });
      }
    }
    students.put(student);
    return student;
  });
}

export function trashStudent(classId, studentId) {
  return updateRoster(classId, function (roster, students) {
    const student = roster.students.find(function (record) { return record.id === studentId; });
    if (!student) throw new Error('명단에서 해당 학생을 찾을 수 없습니다.');
    const seats = seatsFor(roster, groupIdInRoster(student, roster.groups));
    seats.forEach(function (member, seat) {
      if (member.id === studentId) {
        students.put({ ...member, seat, status: 'deleted', updatedAt: new Date().toISOString() });
      } else if (member.seat !== seat) {
        students.put({ ...member, seat });
      }
    });
  });
}

export function restoreStudent(classId, studentId) {
  return updateRoster(classId, function (roster, students) {
    const student = roster.deletedStudents.find(function (record) { return record.id === studentId; });
    if (!student) throw new Error('휴지통에서 해당 학생을 찾을 수 없습니다.');
    const number = Number(student.number);
    if (roster.students.some(function (member) { return Number(member.number) === number; })) {
      throw new Error(number + '번을 사용 중인 학생의 번호를 바꾼 뒤 다시 복원해 주세요.');
    }
    const groupId = groupIdInRoster(student, roster.groups);
    const seats = seatsFor(roster, groupId);
    const savedSeat = student.seat;
    const canUseSavedSeat = Number.isInteger(savedSeat) && savedSeat >= 0 &&
      savedSeat < STUDENT_SEAT_LIMIT && !seats.has(savedSeat);
    students.put({
      ...student, groupId: groupId || null, seat: canUseSavedSeat ? savedSeat : firstEmptySeat(seats),
      status: 'active', updatedAt: new Date().toISOString()
    });
  });
}

export function saveGroup(classId, values) {
  return updateRoster(classId, function (roster, students, groups) {
    const name = String(values.name || '').trim();
    const previous = roster.groups.find(function (group) { return group.id === values.id; });
    if (!name) throw new Error('모둠 이름을 입력해 주세요.');
    if (values.id && !previous) throw new Error('해당 모둠을 찾을 수 없습니다.');
    if (roster.groups.some(function (group) { return group.id !== values.id && group.name === name; })) {
      throw new Error('이미 있는 모둠 이름입니다.');
    }
    const group = {
      ...(previous || { id: crypto.randomUUID(), classId, order: Math.max(0, ...roster.groups.map(function (group) { return Number(group.order) || 0; })) + 1, createdAt: new Date().toISOString() }),
      name
    };
    groups.put(group);
    return group;
  });
}

export function importStudents(classId, text) {
  const rows = String(text || '').split(/\r?\n/).map(function (line) {
    return line.split(line.includes('\t') ? '\t' : ',').map(function (part) { return part.trim(); });
  }).filter(function (parts) { return parts.some(Boolean); });
  if (rows[0]?.[0] === '번호' || rows[0]?.[0] === '이름') rows.shift();
  if (!rows.length) throw new Error('추가할 학생 명단을 입력해 주세요.');

  return updateRoster(classId, function (roster, students, groups) {
    const usedNumbers = new Set(roster.students.map(function (student) { return Number(student.number); }));
    const groupsByName = new Map(roster.groups.map(function (group) { return [group.name, group]; }));
    let next = Math.max(0, ...usedNumbers) + 1;
    let avatarIndex = roster.students.length;
    let nextGroupOrder = Math.max(0, ...roster.groups.map(function (group) { return Number(group.order) || 0; })) + 1;
    const occupied = new Map();
    const now = new Date().toISOString();
    rows.forEach(function (parts) {
      const hasNumber = parts.length > 1 && /^\d+$/.test(parts[0]);
      const number = hasNumber ? Number(parts[0]) : next;
      const [name, groupName] = hasNumber ? parts.slice(1) : parts;
      if (!name || !Number.isSafeInteger(number) || number < 1) throw new Error('번호와 이름을 확인해 주세요.');
      if (usedNumbers.has(number)) throw new Error(number + '번 학생이 이미 있습니다.');
      usedNumbers.add(number);
      next = Math.max(next, number + 1);
      let group = groupsByName.get(groupName);
      if (!group && groupName) {
        group = { id: crypto.randomUUID(), classId, name: groupName, order: nextGroupOrder++, createdAt: now };
        groupsByName.set(groupName, group);
        groups.add(group);
      }
      const groupId = group?.id || '';
      if (!occupied.has(groupId)) occupied.set(groupId, seatsFor(roster, groupId));
      const seats = occupied.get(groupId);
      const seat = firstEmptySeat(seats);
      seats.set(seat, true);
      students.add({
        id: crypto.randomUUID(), classId, number, name, groupId: groupId || null, seat,
        avatarId: avatarIndex++ % AVATAR_COUNT + 1, score: 0, status: 'active', createdAt: now, updatedAt: now
      });
    });
  });
}

export function moveStudent(classId, studentId, target, expected) {
  if (!Number.isInteger(target.seat) || target.seat < 0 || target.seat >= STUDENT_SEAT_LIMIT) {
    throw new Error('이 자리로는 이동할 수 없습니다.');
  }
  return updateRoster(classId, function (roster, students) {
    const moving = roster.students.find(function (student) { return student.id === studentId; });
    if (!moving || (target.groupId && !roster.groups.some(function (group) { return group.id === target.groupId; }))) {
      throw new Error('이동할 학생이나 모둠을 찾을 수 없습니다.');
    }
    const fromGroup = groupIdInRoster(moving, roster.groups);
    const source = seatsFor(roster, fromGroup);
    const destination = target.groupId === fromGroup ? source : seatsFor(roster, target.groupId);
    const fromSeat = Array.from(source).find(function ([, student]) { return student.id === studentId; })[0];
    const occupant = destination.get(target.seat);
    if (fromGroup !== expected.groupId || fromSeat !== expected.seat || (occupant?.id || '') !== target.studentId) {
      throw new Error('다른 탭에서 자리가 바뀌었습니다. 다시 선택해 주세요.');
    }
    if (occupant?.id === studentId) return;
    source.delete(fromSeat);
    destination.set(target.seat, { ...moving, groupId: target.groupId || null });
    if (occupant) source.set(fromSeat, { ...occupant, groupId: fromGroup || null });
    const writeSeats = function (arrangement) {
      arrangement.forEach(function (student, seat) {
        if (student.seat !== seat || student.id === studentId || student.id === occupant?.id) {
          students.put({ ...student, seat, updatedAt: new Date().toISOString() });
        }
      });
    };
    writeSeats(source);
    if (source !== destination) writeSeats(destination);
  });
}

export function moveGroup(classId, groupId, position, expected) {
  if (!Number.isInteger(position) || position < 0 || position >= GROUP_POSITION_LIMIT) {
    throw new Error('이 위치로는 이동할 수 없습니다.');
  }
  return updateRoster(classId, function (roster, students, groups) {
    const layout = groupPositions(roster.groups);
    const moving = layout.get(expected.position);
    const occupant = layout.get(position);
    if (moving?.id !== groupId || (occupant?.id || '') !== expected.targetId) {
      throw new Error('다른 탭에서 모둠 배치가 바뀌었습니다. 다시 선택해 주세요.');
    }
    if (occupant?.id === groupId) return;
    layout.delete(expected.position);
    layout.set(position, moving);
    if (occupant) layout.set(expected.position, occupant);
    layout.forEach(function (group, index) {
      if (group.position !== index) groups.put({ ...group, position: index });
    });
  });
}
