/**
 * 本機假 Google OAuth 伺服器：在 127.0.0.1 隨機 port 模擬授權端點與 token 端點，測試不連任何外網。
 * Worker 只在 ENVIRONMENT=test 時透過 GOOGLE_OAUTH_BASE 指向這裡。
 *
 * - GET  /o/oauth2/v2/auth：記下 code_challenge 與 redirect_uri，302 回 redirect_uri?code&state（或 error=access_denied）。
 * - POST /token：驗證授權碼（一次性）、client_id、client_secret、redirect_uri 與 code_verifier 的 S256，
 *   通過才回傳 id_token。id_token 的簽章是假的；Worker 依 TD-2 不驗簽，只檢查 aud／iss／exp／email_verified。
 */
import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';

const b64url = (value) => Buffer.from(value).toString('base64url');

/**
 * 組出假的 JWT（header.payload.signature），簽章固定為假值。
 */
export function fakeJwt(payload) {
  return `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'fake' }))}.${b64url(JSON.stringify(payload))}.${b64url('fake-signature')}`;
}

/**
 * 讀完整個請求 body。
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * 啟動假 Google。clientId／clientSecret 是測試用的假值，必須與 Worker env 一致。
 */
export async function startFakeGoogle({ clientId, clientSecret }) {
  const codes = new Map();
  const state = {
    user: { sub: 'google-sub-1', email: 'learner@example.test', email_verified: true },
    deny: false,
    tokenStatus: 200,
    claimOverrides: {},
    rawIdToken: null,
  };
  const log = { authorizations: [], tokenRequests: [], issued: [] };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const reply = (status, body, headers = {}) => {
      res.writeHead(status, { 'content-type': 'application/json', ...headers });
      res.end(body === undefined ? '' : JSON.stringify(body));
    };

    if (req.method === 'GET' && url.pathname === '/o/oauth2/v2/auth') {
      const params = Object.fromEntries(url.searchParams);
      log.authorizations.push(params);
      if (params.client_id !== clientId || params.response_type !== 'code' || params.code_challenge_method !== 'S256') {
        return reply(400, { error: 'invalid_request' });
      }
      const back = new URL(params.redirect_uri);
      back.searchParams.set('state', params.state ?? '');
      if (state.deny) {
        back.searchParams.set('error', 'access_denied');
      } else {
        const code = `fake-code-${randomBytes(12).toString('hex')}`;
        codes.set(code, {
          challenge: params.code_challenge,
          redirectUri: params.redirect_uri,
          claims: { ...state.user },
          used: false,
        });
        back.searchParams.set('code', code);
      }
      res.writeHead(302, { location: back.href });
      return res.end();
    }

    if (req.method === 'POST' && url.pathname === '/token') {
      const form = Object.fromEntries(new URLSearchParams(await readBody(req)));
      log.tokenRequests.push(form);
      if (state.tokenStatus !== 200) return reply(state.tokenStatus, { error: 'server_error' });
      const entry = codes.get(form.code);
      const verifierOk = entry && createHash('sha256').update(form.code_verifier ?? '').digest('base64url') === entry.challenge;
      const ok = entry && !entry.used
        && form.grant_type === 'authorization_code'
        && form.client_id === clientId
        && form.client_secret === clientSecret
        && form.redirect_uri === entry.redirectUri
        && verifierOk;
      if (entry) entry.used = true;
      if (!ok) return reply(400, { error: 'invalid_grant' });
      const nowSec = Math.floor(Date.now() / 1000);
      const payload = {
        iss: 'https://accounts.google.com',
        aud: clientId,
        iat: nowSec,
        exp: nowSec + 3600,
        ...entry.claims,
        ...state.claimOverrides,
      };
      const idToken = state.rawIdToken ?? fakeJwt(payload);
      const accessToken = `fake-access-${randomBytes(12).toString('hex')}`;
      log.issued.push({ code: form.code, idToken, accessToken });
      return reply(200, { access_token: accessToken, id_token: idToken, expires_in: 3599, token_type: 'Bearer', scope: 'openid email' });
    }

    return reply(404, { error: 'not_found' });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  return {
    base,
    log,
    /**
     * 設定下一次授權的使用者（Google 回傳的 claims）。
     */
    setUser(user) {
      state.user = { ...user };
    },
    /**
     * 讓授權端點模擬使用者按「取消」。
     */
    setDeny(deny) {
      state.deny = deny;
    },
    /**
     * 讓 token 端點回傳指定的錯誤狀態碼（200 表示恢復正常）。
     */
    setTokenStatus(status) {
      state.tokenStatus = status;
    },
    /**
     * 覆寫 id_token 的欄位（aud、iss、exp 等），用來測 Worker 的驗證。
     */
    setClaimOverrides(overrides) {
      state.claimOverrides = { ...overrides };
    },
    /**
     * 直接指定 id_token 原文（例如格式錯誤的字串）；null 表示恢復正常產生。
     */
    setRawIdToken(raw) {
      state.rawIdToken = raw;
    },
    /**
     * 恢復預設行為。
     */
    reset() {
      state.user = { sub: 'google-sub-1', email: 'learner@example.test', email_verified: true };
      state.deny = false;
      state.tokenStatus = 200;
      state.claimOverrides = {};
      state.rawIdToken = null;
      log.authorizations.length = 0;
      log.tokenRequests.length = 0;
      log.issued.length = 0;
    },
    /**
     * 模擬瀏覽器前往授權網址，回傳 Google 導回的回呼網址（URL 物件）。
     */
    async authorize(authUrl) {
      const response = await fetch(authUrl, { redirect: 'manual' });
      if (response.status !== 302) throw new Error(`fake google authorize failed: ${response.status}`);
      return new URL(response.headers.get('location'));
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
