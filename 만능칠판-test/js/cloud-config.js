const required = ['apiKey', 'authDomain', 'projectId', 'appId'];

export function parseFirebaseConfig(source) {
  let input;
  if (typeof source === 'object' && source) input = source;
  else {
    try {input = JSON.parse(source);}
    catch {
      input = {};
      for (const key of required) {
        const result = new RegExp(`(?:^|[,{\\s])["']?${key}["']?\\s*:\\s*["']([^"'\\s]+)["']`).exec(source);
        if (result) input[key] = result[1];
      }
    }
  }
  if (!required.every(key => typeof input?.[key] === 'string' && /^[a-z0-9_.:-]{1,180}$/i.test(input[key]))) {
    throw Error('Firebase 웹 앱 설정에서 apiKey, authDomain, projectId, appId를 확인해주세요.');
  }
  return Object.fromEntries(required.map(key => [key, input[key]]));
}

export function encodeInvite(settings) {
  const link = new URL(location.href);
  link.hash = '기기연결=' + encodeURIComponent(JSON.stringify({config: settings.config, boardId: settings.boardId}));
  return link.href;
}

export function readInvite(value) {
  let input;
  try {
    const url = new URL(value);
    const hash = decodeURIComponent(url.hash.slice(1));
    if (!hash.startsWith('기기연결=')) throw Error();
    input = JSON.parse(hash.slice('기기연결='.length));
  } catch {throw Error('연결 링크를 확인해주세요.');}
  if (!/^[a-z0-9_-]{20,128}$/i.test(input?.boardId)) throw Error('연결 링크를 확인해주세요.');
  return {config:parseFirebaseConfig(input.config), boardId:input.boardId};
}

const deviceKeyPrefix = 'WB5.';
const deviceInvitePattern = /^[0-9a-f]{48}$/;

export function encodeDeviceKey(settings, token) {
  if (!deviceInvitePattern.test(token)) throw Error('연결 키를 확인해주세요.');
  const {config, boardId} = settings;
  const encoded = btoa(JSON.stringify({config:parseFirebaseConfig(config), boardId, token}));
  return deviceKeyPrefix + encoded.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function deviceInviteURL(key, pageURL = location.href) {
  const link = new URL(pageURL);
  link.hash = key;
  return link.href;
}

export function readDeviceKey(source) {
  try {
    const value = source.trim();
    const key = value.startsWith(deviceKeyPrefix) ? value : new URL(value).hash.slice(1);
    if (!/^WB5\.[a-z\d_-]{1,1500}$/i.test(key) || !key.startsWith(deviceKeyPrefix)) throw Error();
    const input = JSON.parse(atob(key.slice(deviceKeyPrefix.length).replaceAll('-', '+').replaceAll('_', '/')));
    if (typeof input.boardId !== 'string' || !/^[a-z0-9_-]{20,128}$/i.test(input.boardId)
      || typeof input.token !== 'string' || !deviceInvitePattern.test(input.token)) throw Error();
    return {config:parseFirebaseConfig(input.config), boardId:input.boardId, token:input.token};
  } catch {throw Error('연결 키나 QR 링크를 확인해주세요.');}
}
