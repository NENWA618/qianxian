// API Token 管理前端逻辑（增强版：Token 只显示一次，后续仅显示部分）

const API_BASE_URL = window.API_BASE_URL || 'https://qianxian-backend.onrender.com';

async function fetchTokens() {
  const res = await fetch(API_BASE_URL + '/api/api-tokens', {
    credentials: 'include',
    headers: { 'Accept': 'application/json' }
  });
  if (!res.ok) throw new Error('获取Token列表失败');
  return await res.json();
}

async function createToken(desc, expire) {
  const csrf = await getCsrfToken();
  const body = { description: desc, expired_at: expire };
  const res = await fetch(API_BASE_URL + '/api/api-tokens', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrf
    },
    body: JSON.stringify(body)
  });
  return await res.json();
}

async function deactivateToken(tokenId) {
  const csrf = await getCsrfToken();
  const res = await fetch(API_BASE_URL + '/api/api-tokens/' + encodeURIComponent(tokenId), {
    method: 'DELETE',
    credentials: 'include',
    headers: { 'X-CSRF-Token': csrf }
  });
  return await res.json();
}

function maskToken(token) {
  if (!token || token.length < 12) return token;
  return token.slice(0, 8) + '...' + token.slice(-4);
}

function renderTokens(tokens) {
  const tbody = document.getElementById('api-token-list-body');
  if (!Array.isArray(tokens) || tokens.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6">暂无Token</td></tr>`;
    return;
  }
  tbody.innerHTML = '';
  tokens.forEach(t => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <span style="font-family:monospace;">${maskToken(t.token)}</span>
        <button class="api-token-copy-btn" title="复制" data-token="${t.token}">复制</button>
      </td>
      <td>${escapeHtml(t.description || '')}</td>
      <td>${t.created_at ? new Date(t.created_at).toLocaleString() : ''}</td>
      <td>${t.expired_at ? new Date(t.expired_at).toLocaleDateString() : '永久'}</td>
      <td>${t.is_active ? '有效' : '已失效'}</td>
      <td>
        ${t.is_active ? `<button class="btn-deactivate" data-token-id="${t.id}">失效</button>` : ''}
      </td>
    `;
    tbody.appendChild(tr);
  });
  // 复制按钮事件
  document.querySelectorAll('.api-token-copy-btn').forEach(btn => {
    btn.onclick = e => {
      const token = btn.getAttribute('data-token');
      navigator.clipboard.writeText(token).then(() => {
        btn.textContent = '已复制';
        setTimeout(() => (btn.textContent = '复制'), 1000);
      });
    };
  });
  // 失效按钮事件
  document.querySelectorAll('.btn-deactivate').forEach(btn => {
    btn.onclick = async e => {
      if (!confirm('确定要失效此Token？')) return;
      btn.disabled = true;
      await deactivateToken(btn.getAttribute('data-token-id'));
      await loadTokens();
    };
  });
}

async function loadTokens() {
  const tbody = document.getElementById('api-token-list-body');
  tbody.innerHTML = `<tr><td colspan="6">加载中...</td></tr>`;
  try {
    const data = await fetchTokens();
    renderTokens(data.tokens || []);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" style="color:red;">加载失败</td></tr>`;
  }
}

function showTokenOnce(token) {
  if (!token) return;
  const msg = document.getElementById('api-token-create-msg');
  msg.innerHTML = `<span style="color:#b48a3a;">新建Token：<code style="font-size:1.1em;">${escapeHtml(
    token
  )}</code><br>请妥善保存，此Token只显示一次，后续无法再次查看。</span>`;
  setTimeout(() => {
    msg.textContent = '';
  }, 15000);
}

document.addEventListener('DOMContentLoaded', () => {
  loadTokens();

  const form = document.getElementById('api-token-create-form');
  const msg = document.getElementById('api-token-create-msg');
  form.onsubmit = async e => {
    e.preventDefault();
    const desc = document.getElementById('token-desc').value.trim();
    const expire = document.getElementById('token-expire') ? document.getElementById('token-expire').value : null;
    if (!desc) {
      msg.textContent = '描述不能为空';
      msg.style.color = 'red';
      return;
    }
    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;
    msg.textContent = '创建中...';
    msg.style.color = '#888';
    try {
      const res = await createToken(desc, expire);
      if (res.success) {
        form.reset();
        await loadTokens();
        if (res.token) {
          showTokenOnce(res.token);
        } else {
          msg.textContent = '创建成功';
          msg.style.color = 'green';
        }
      } else {
        msg.textContent = res.message || '创建失败';
        msg.style.color = 'red';
      }
    } catch (err) {
      msg.textContent = '网络错误，请重试';
      msg.style.color = 'red';
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  };
});