import { runProbe } from './probe.js';

const button = document.querySelector('#run-probe');
const status = document.querySelector('#probe-status');
const output = document.querySelector('#probe-proof');

button.addEventListener('click', async () => {
  button.disabled = true;
  output.hidden = true;
  output.textContent = '';
  status.textContent = '正在等待原生探針；尚未取得成功證據。';
  try {
    const proof = await runProbe();
    output.textContent = JSON.stringify(proof, null, 2);
    output.hidden = false;
    status.textContent = '此頁本次記憶體 SQLite 回滾檢查通過；學習資料儲存仍未實作。';
  } catch (error) {
    status.textContent = `探針未成功：${error instanceof Error ? error.message : String(error)}`;
  } finally {
    button.disabled = false;
  }
});
