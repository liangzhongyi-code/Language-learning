/**
 * 純交易守衛：平台先計算內容 SHA-256，在同一交易內讀取 meta／收據後呼叫。
 * 只對本機 epoch 的成功操作去重；收據不跨備份匯入，以免舊頁覆蓋還原結果。
 */
const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor']);
const idOk = (value) => typeof value === 'string' &&
  /^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(value) && !FORBIDDEN.has(value);
const revisionOk = (value) => Number.isSafeInteger(value) && value >= 0;
const hashOk = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

/**
 * 輸出欄位排序固定的 JSON，供平台雜湊；不依賴物件插入順序或自訂 toJSON。
 * 限制深度及輸出，並拒絕 undefined／getter／循環等非可攜資料，不靜默吞值。
 * 一般逐題保存上限 1 MiB；整組還原可由呼叫端放寬到備份上限，不影響其他操作。
 */
export function canonicalJson(value, { maxBytes = 1024 * 1024 } = {}) {
  const seen = new Set();
  let budget = maxBytes;
  const take = (text) => {
    budget -= text.length;
    if (budget < 0) fail('INVALID_OPERATION', '單次保存內容過大。');
    return text;
  };
  const visit = (item, depth) => {
    if (depth > 32) fail('INVALID_OPERATION', '保存內容結構過深。');
    if (item === null || typeof item === 'boolean') return take(JSON.stringify(item));
    if (typeof item === 'number' && Number.isFinite(item)) return take(JSON.stringify(item));
    if (typeof item === 'string') {
      if (item.length > budget) fail('INVALID_OPERATION', '單次保存內容過大。');
      return take(JSON.stringify(item));
    }
    if (typeof item !== 'object' || seen.has(item)) {
      fail('INVALID_OPERATION', '保存內容必須是有限、沒有循環的 JSON 資料。');
    }
    const array = Array.isArray(item);
    if (!array && ![Object.prototype, null].includes(Object.getPrototypeOf(item))) {
      fail('INVALID_OPERATION', '保存內容包含不支援的物件。');
    }
    if (Object.getOwnPropertySymbols(item).length) fail('INVALID_OPERATION', '保存內容不可含 Symbol。');
    seen.add(item);
    let values;
    if (array) {
      if (Object.keys(item).length !== item.length || item.length > 100000) {
        fail('INVALID_OPERATION', '保存陣列不可有空洞或額外欄位。');
      }
      values = [];
      for (let i = 0; i < item.length; i++) {
        const descriptor = Object.getOwnPropertyDescriptor(item, String(i));
        if (!descriptor || !('value' in descriptor)) fail('INVALID_OPERATION', '保存內容不可使用 getter。');
        values.push(visit(descriptor.value, depth + 1));
      }
    } else {
      values = Object.keys(item).sort().map((key) => {
        if (FORBIDDEN.has(key)) fail('INVALID_OPERATION', '保存內容包含不安全的欄位。');
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        if (!('value' in descriptor)) fail('INVALID_OPERATION', '保存內容不可使用 getter。');
        return take(JSON.stringify(key) + ':') + visit(descriptor.value, depth + 1);
      });
    }
    seen.delete(item);
    take('  ' + ','.repeat(Math.max(0, values.length - 1)));
    return (array ? '[' : '{') + values.join(',') + (array ? ']' : '}');
  };
  return visit(value, 0);
}

/**
 * 順序不可交換：先擋 epoch，再驗同操作成功收據，最後才檢查 expectedRevision。
 * 如此回應遺失可以安全重試，卻不會在清除／還原後沿用失效的舊操作。
 * 收據版本以已提交的 meta 為上限，不以重送者刷新後的 expectedRevision 驗證。
 */
export function checkOperation({ meta, operation, receipt, payloadHash }) {
  if (!meta || !revisionOk(meta.revision) || !idOk(meta.dataEpoch) ||
      !operation || !idOk(operation.operationId) || !idOk(operation.epoch) ||
      !revisionOk(operation.expectedRevision) || !hashOk(payloadHash)) {
    fail('INVALID_OPERATION', '保存操作格式不正確，沒有更動紀錄。');
  }
  if (operation.epoch !== meta.dataEpoch) {
    fail('STALE_EPOCH', '資料已清除或還原，請重新開啟目前的練習。');
  }
  if (receipt !== undefined && receipt !== null) {
    if (receipt.operationId !== operation.operationId || receipt.epoch !== operation.epoch ||
        !hashOk(receipt.payloadHash) || !revisionOk(receipt.result?.revision) ||
        receipt.result.revision === 0 || receipt.result.revision > meta.revision) {
      fail('INVALID_RECEIPT', '保存收據不完整，請重新載入後檢查紀錄。');
    }
    if (receipt.payloadHash !== payloadHash) {
      fail('OPERATION_MISMATCH', '同一筆保存操作的內容已改變，不能重複使用。');
    }
    return { replay: true, result: JSON.parse(canonicalJson(receipt.result)) };
  }
  if (operation.expectedRevision !== meta.revision) {
    fail('REVISION_CONFLICT', '其他頁面已更新紀錄，請重讀後再試。');
  }
  if (meta.revision === Number.MAX_SAFE_INTEGER) {
    fail('REVISION_EXHAUSTED', '紀錄版本已達上限，請先匯出備份。');
  }
  return { replay: false };
}

/**
 * 只在實際交易提交時保存此收據，不先把尚未落盤的結果當成功。
 */
export function operationReceipt(operation, payloadHash, revision) {
  if (!idOk(operation?.operationId) || !idOk(operation?.epoch) || !hashOk(payloadHash) ||
      !revisionOk(operation?.expectedRevision) || !revisionOk(revision) ||
      revision !== operation.expectedRevision + 1) {
    fail('INVALID_RECEIPT', '保存收據格式不正確。');
  }
  return {
    operationId: operation.operationId, epoch: operation.epoch, payloadHash, result: { revision },
  };
}
