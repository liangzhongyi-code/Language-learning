/**
 * 僅接受本機原型頂層頁面的 Tauri bridge；注入函式只供隔離契約測試。
 */
function nativeInvoke() {
  const current = globalThis.window;
  if (!current || current.top !== current || !current.__TAURI_INTERNALS__ ||
      typeof current.__TAURI__?.core?.invoke !== 'function') {
    throw new Error('需要原生 Tauri 原型 runtime；瀏覽器不能執行此探針。');
  }
  const url = new URL(current.location.href);
  const local = (url.protocol === 'tauri:' && url.hostname === 'localhost') ||
    (['http:', 'https:'].includes(url.protocol) && url.hostname === 'tauri.localhost');
  if (!local || url.port || url.username || url.password ||
      !['/app/prototype/index.html', '/app/prototype/second.html'].includes(url.pathname)) {
    throw new Error('只允許本機原型兩頁呼叫原生探針。');
  }
  return current.__TAURI__.core.invoke.bind(current.__TAURI__.core);
}

/**
 * await 原生回應並驗證完整證據；拒絕假成功或冒充 learning repository。
 */
export async function runProbe(invoke = nativeInvoke()) {
  const proof = await invoke('prototype_probe');
  if (!proof || typeof proof !== 'object' || Array.isArray(proof) ||
      typeof proof.sqliteVersion !== 'string' || !proof.sqliteVersion.trim() ||
      proof.sqliteVersion.length > 128 || proof.rollbackVerified !== true ||
      proof.learningRepository !== 'not-implemented') {
    throw new Error('原生探針回應格式無效；不能視為回滾成功。');
  }
  return proof;
}
