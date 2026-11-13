const MEMBERS_PATH = '/api/admin/members';
const ROLE_LABELS = new Map([
  ['owner', '擁有者'],
  ['admin', '管理員'],
  ['member', '成員'],
]);
const ERROR_MESSAGES = new Map([
  ['INVALID_EMAIL', '請輸入有效的 Email（最多 254 字）。'],
  ['INVALID_NICKNAME', '暱稱最多 40 字。'],
  ['ALREADY_EXISTS', '已在名單中'],
  ['FORBIDDEN', '你沒有執行此操作的權限。'],
  ['OWNER_ONLY', '只有擁有者可以執行此操作。'],
  ['OWNER_PROTECTED', '擁有者的角色與名單資格受保護。'],
  ['ACCOUNT_CHANGED', '帳號已變更，請重新載入頁面。'],
  ['NOT_FOUND', '找不到這位成員，請重新整理名單。'],
  ['CONFLICT', '名單已變更，請重新整理後再試。'],
]);
const DATE_FORMAT = new Intl.DateTimeFormat('zh-TW', { dateStyle: 'medium', timeStyle: 'short' });

/**
 * 後台請求保留 Worker 錯誤碼，讓畫面能區分重複成員與權限失效。
 */
function createAdminApi() {
  let accountId;
  async function request(path, { method = 'GET', data } = {}) {
    const headers = {};
    if (data !== undefined) headers['Content-Type'] = 'application/json';
    if (accountId) headers['X-Cloud-Account'] = accountId;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(path, {
        method,
        credentials: 'same-origin',
        cache: 'no-store',
        signal: controller.signal,
        headers,
        body: data === undefined ? undefined : JSON.stringify(data),
      });
      if (response.status === 204) return;
      if (response.ok) return await response.json();
      const body = await response.json().catch(() => null);
      throw Object.assign(new Error('管理 API 請求失敗'), { status: response.status, code: body?.error });
    } finally { clearTimeout(timer); }
  }

  return {
    async me() {
      const account = await request('/api/me');
      accountId = account.accountId;
      return account;
    },
    listMembers: () => request(MEMBERS_PATH),
    addMember: (data) => request(MEMBERS_PATH, { method: 'POST', data }),
    updateMember: (email, data) => request(MEMBERS_PATH + '/' + encodeURIComponent(email), { method: 'PATCH', data }),
    removeMember: (email) => request(MEMBERS_PATH + '/' + encodeURIComponent(email), { method: 'DELETE' }),
  };
}

/**
 * 掛載管理後台。呼叫端以站點設定提供 cloudEnabled。
 * account 未提供時查 /api/me；測試可注入 account、api 與 confirmRemoval。
 */
export async function initAdminPage({
  mount,
  cloudEnabled = false,
  account,
  api = createAdminApi(),
  confirmRemoval = (email) => globalThis.confirm('確定要將 ' + email + ' 移出名單？'),
} = {}) {
  const doc = mount.ownerDocument;
  function element(tag, content) {
    const node = doc.createElement(tag);
    if (content !== undefined) node.textContent = content;
    return node;
  }

  const status = element('p');
  status.setAttribute('role', 'status');
  mount.replaceChildren(status);
  const showStatus = (message) => { status.textContent = message; };
  if (!cloudEnabled) {
    showStatus('此頁只在新網址可用');
    return;
  }

  function denyAccess() {
    mount.replaceChildren(status);
    showStatus('需要管理權限');
  }

  function handleError(error, fallback) {
    if (error?.code === 'ACCOUNT_CHANGED') {
      denyAccess();
      showStatus(ERROR_MESSAGES.get(error.code));
    } else if (error?.status === 401 || ['UNAUTHENTICATED', 'NOT_ALLOWED', 'NOT_STAFF'].includes(error?.code)) {
      denyAccess();
    } else {
      showStatus(ERROR_MESSAGES.get(error?.code) ?? fallback);
    }
  }

  showStatus('正在載入名單…');
  try {
    if (account === undefined) account = await api.me();
  } catch (error) {
    handleError(error, '無法確認管理權限，請重新載入頁面。');
    return;
  }
  if (account?.role !== 'owner' && account?.role !== 'admin') {
    denyAccess();
    return;
  }

  const isOwner = account.role === 'owner';
  const panel = element('fieldset');
  panel.className = 'admin-panel';
  panel.append(element('legend', '成員管理'));

  function field(labelText, inputType, initialValue = '') {
    const label = element('label', labelText);
    const input = element('input');
    input.type = inputType;
    input.value = initialValue;
    label.append(input);
    return { label, input };
  }

  function button(label, onClick) {
    const control = element('button', label);
    control.className = 'btn ghost sm';
    control.type = onClick ? 'button' : 'submit';
    if (onClick) control.addEventListener('click', onClick);
    return control;
  }

  const addForm = element('form');
  addForm.className = 'admin-add-form';
  addForm.noValidate = true;
  const email = field('Email', 'email');
  const nickname = field('暱稱（選填）', 'text');
  addForm.append(email.label, nickname.label, button('新增'));
  addForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void mutate(async () => {
      await api.addMember({ email: email.input.value.trim().toLowerCase(), nickname: nickname.input.value });
      addForm.reset();
    });
  });

  const tableWrap = element('div');
  tableWrap.className = 'admin-table-wrap';
  const table = element('table');
  table.className = 'admin-table';
  table.append(element('caption', '成員名單'));
  const headings = table.createTHead().insertRow();
  for (const label of ['Email', '暱稱', '角色', '加入時間', '新增者', '最後登入時間', '登入狀態', '雲端紀錄更新時間', '操作']) {
    const heading = element('th', label);
    heading.scope = 'col';
    headings.append(heading);
  }
  const body = table.createTBody();
  tableWrap.append(table);
  panel.append(addForm, button('重新整理名單', () => void refresh()), tableWrap);

  function appendTime(cell, timestamp, empty = '—') {
    const date = new Date(timestamp);
    if (!Number.isFinite(timestamp) || !Number.isFinite(date.getTime())) {
      cell.textContent = empty;
      return;
    }
    const time = element('time', DATE_FORMAT.format(date));
    time.dateTime = date.toISOString();
    cell.append(time);
  }

  function appendNicknameEditor(cell, member) {
    const form = element('form');
    form.className = 'admin-nickname-form';
    const nickname = field('暱稱', 'text', member.nickname ?? '');
    const edit = button('編輯暱稱', () => {
      edit.hidden = true;
      form.hidden = false;
      nickname.input.focus();
    });
    const cancel = button('取消', () => {
      nickname.input.value = member.nickname ?? '';
      form.hidden = true;
      edit.hidden = false;
      edit.focus();
    });
    form.hidden = true;
    form.append(nickname.label, button('儲存'), cancel);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      void mutate(() => api.updateMember(member.email, { nickname: nickname.input.value }));
    });
    cell.append(edit, form);
  }

  function renderMember(member) {
    const row = doc.createElement('tr');
    row.insertCell().textContent = member.email;
    row.insertCell().textContent = member.nickname ?? '—';
    const role = row.insertCell();
    role.textContent = ROLE_LABELS.get(member.role) ?? '—';
    if (!member.inAllowlist) role.append(' ', element('span', '不在名單'));
    appendTime(row.insertCell(), member.createdAt);
    row.insertCell().textContent = member.addedBy ?? '—';
    appendTime(row.insertCell(), member.lastLoginAt, '尚未登入');
    row.insertCell().textContent = member.activeSessions > 0 ? '登入中' : '未登入';
    appendTime(row.insertCell(), member.snapshotUpdatedAt);
    const actions = row.insertCell();
    if (!member.inAllowlist) {
      actions.append(button('加入名單', () => {
        void mutate(() => api.addMember({ email: member.email, nickname: member.nickname ?? '' }));
      }));
      return row;
    }
    if (isOwner || member.role === 'member' || (member.role === 'admin' && member.email === account.email)) {
      appendNicknameEditor(actions, member);
    }
    if (isOwner && ['member', 'admin'].includes(member.role)) {
      const isMember = member.role === 'member';
      actions.append(
        button(isMember ? '升為管理員' : '降為成員', () => {
          void mutate(() => api.updateMember(member.email, { role: isMember ? 'admin' : 'member' }));
        }),
        button('移除', () => {
          if (confirmRemoval(member.email)) void mutate(() => api.removeMember(member.email));
        }),
      );
    }
    return row;
  }

  async function loadMembers() {
    const { members } = await api.listMembers();
    // Worker 已依擁有者、最後登入時間與 email 排序。
    body.replaceChildren(...members.map(renderMember));
  }

  async function refresh() {
    if (panel.disabled) return;
    panel.disabled = true;
    showStatus('正在載入名單…');
    try {
      await loadMembers();
      showStatus('');
    } catch (error) {
      body.replaceChildren();
      handleError(error, '無法載入名單，請重新整理後再試。');
    } finally {
      panel.disabled = false;
    }
  }

  async function mutate(operation) {
    if (panel.disabled) return;
    panel.disabled = true;
    showStatus('正在儲存…');
    try {
      await operation();
    } catch (error) {
      handleError(error, '未能確認操作結果，請先重新整理名單。');
      panel.disabled = false;
      return;
    }

    try {
      await loadMembers();
      showStatus('已更新名單。');
    } catch (error) {
      body.replaceChildren();
      handleError(error, '操作已儲存，名單未能更新。請重新整理名單。');
    } finally {
      panel.disabled = false;
    }
  }

  mount.append(panel);
  await refresh();
}
