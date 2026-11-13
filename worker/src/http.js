/**
 * Worker 共用的回應工具；錯誤一律是 {"error":"CODE"}，不帶堆疊或 SQL 內容。
 */

/**
 * 回傳 JSON 回應；預設不快取，API 回應都與登入狀態有關。
 */
export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

/**
 * 回傳統一格式的錯誤。
 */
export function error(code, status, headers = {}) {
  return json({ error: code }, status, headers);
}

/**
 * 回傳 204（無內容）；可附帶額外標頭（例如清除 cookie）。
 */
export function noContent(headers = {}) {
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store', ...headers } });
}
