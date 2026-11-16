export const DB_NAME = 'ClassRevolutionLocalDB';
export const DB_VERSION = 1;

const definitions = {
  classes: { keyPath: 'id', indexes: [['name', 'name']] },
  students: { keyPath: 'id', indexes: [['classId', 'classId'], ['groupId', 'groupId'], ['number', 'number']] },
  groups: { keyPath: 'id', indexes: [['classId', 'classId'], ['name', 'name']] },
  scoreEvents: { keyPath: 'id', indexes: [['classId', 'classId'], ['studentId', 'studentId'], ['createdAt', 'createdAt']] },
  growthStates: { keyPath: 'classId', indexes: [] },
  growthConversions: { keyPath: 'id', indexes: [['classId', 'classId'], ['createdAt', 'createdAt']] },
  checklistDefinitions: { keyPath: 'id', indexes: [['classId', 'classId'], ['order', 'order']] },
  checklistEntries: { keyPath: 'id', indexes: [['classId', 'classId'], ['studentId', 'studentId'], ['definitionId', 'definitionId'], ['date', 'date']] },
  settings: { keyPath: 'key', indexes: [] }
};

export const STORE_NAMES = Object.keys(definitions);
let databasePromise;

export function openDatabase() {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise(function (resolve, reject) {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = function () {
      const db = request.result;
      Object.keys(definitions).forEach(function (name) {
        const spec = definitions[name];
        const store = db.objectStoreNames.contains(name)
          ? request.transaction.objectStore(name)
          : db.createObjectStore(name, { keyPath: spec.keyPath });
        spec.indexes.forEach(function (index) {
          if (!store.indexNames.contains(index[0])) store.createIndex(index[0], index[1], { unique: false });
        });
      });
    };
    request.onsuccess = function () {
      const db = request.result;
      db.onversionchange = function () { db.close(); databasePromise = null; };
      resolve(db);
    };
    request.onerror = function () {
      databasePromise = null;
      reject(request.error || new Error('IndexedDB를 열지 못했습니다.'));
    };
    request.onblocked = function () {
      console.warn('다른 탭이 데이터베이스 업그레이드를 막고 있습니다.');
    };
  });
  return databasePromise;
}

export function requestResult(request) {
  return new Promise(function (resolve, reject) {
    request.onsuccess = function () { resolve(request.result); };
    request.onerror = function () { reject(request.error); };
  });
}

export async function transact(storeNames, mode, operation) {
  const db = await openDatabase();
  const transaction = db.transaction(storeNames, mode);
  const completed = new Promise(function (resolve, reject) {
    transaction.oncomplete = resolve;
    transaction.onabort = function () {
      reject(transaction.error || new Error('저장이 취소되었습니다.'));
    };
  });
  const work = Promise.resolve().then(function () { return operation(transaction); });
  try {
    const [result] = await Promise.all([work, completed]);
    return result;
  } catch (error) {
    try { transaction.abort(); } catch (abortError) { /* The transaction already finished. */ }
    await completed.catch(function () {});
    throw error;
  }
}

export async function getRecord(storeName, key) {
  const db = await openDatabase();
  const tx = db.transaction(storeName, 'readonly');
  return requestResult(tx.objectStore(storeName).get(key));
}

export async function getAll(storeName) {
  const db = await openDatabase();
  const tx = db.transaction(storeName, 'readonly');
  return requestResult(tx.objectStore(storeName).getAll());
}

export async function putRecord(storeName, record) {
  const db = await openDatabase();
  const tx = db.transaction(storeName, 'readwrite');
  const result = await requestResult(tx.objectStore(storeName).put(record));
  return result;
}

export async function putMany(storeName, records) {
  const db = await openDatabase();
  return new Promise(function (resolve, reject) {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    records.forEach(function (record) { store.put(record); });
    tx.oncomplete = function () { resolve(records.length); };
    tx.onerror = function () { reject(tx.error); };
    tx.onabort = function () { reject(tx.error || new Error('저장이 취소되었습니다.')); };
  });
}

export async function deleteRecord(storeName, key) {
  const db = await openDatabase();
  const tx = db.transaction(storeName, 'readwrite');
  return requestResult(tx.objectStore(storeName).delete(key));
}

export async function exportAll() {
  const db = await openDatabase();
  const tx = db.transaction(STORE_NAMES, 'readonly');
  const records = await Promise.all(STORE_NAMES.map(function (storeName) {
    return requestResult(tx.objectStore(storeName).getAll());
  }));
  const result = { schemaVersion: DB_VERSION, database: DB_NAME };
  STORE_NAMES.forEach(function (storeName, index) { result[storeName] = records[index]; });
  return result;
}

export async function importAll(data) {
  if (!data || data.database !== DB_NAME || data.schemaVersion !== DB_VERSION ||
      !STORE_NAMES.every(function (storeName) { return Array.isArray(data[storeName]); })) {
    throw new Error('올바른 백업 파일이 아닙니다.');
  }

  const db = await openDatabase();
  return new Promise(function (resolve, reject) {
    const tx = db.transaction(STORE_NAMES, 'readwrite');
    tx.oncomplete = function () { resolve(true); };
    tx.onabort = function () { reject(tx.error || new Error('복원이 취소되었습니다.')); };
    try {
      STORE_NAMES.forEach(function (storeName) {
        const store = tx.objectStore(storeName);
        store.clear();
        data[storeName].forEach(function (record) { store.add(record); });
      });
    } catch (error) {
      tx.abort();
      reject(error);
    }
  });
}
