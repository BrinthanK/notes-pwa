let activeKey = null;

export function setSessionKey(key) {
  activeKey = key;
}

export function getSessionKey() {
  return activeKey;
}

export function clearSessionKey() {
  activeKey = null;
}
