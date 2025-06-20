// API Token 管理前端逻辑

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

async function deactivateToken(token) {
  const csrf = await getCsrfToken();
  const res = await fetch(API_BASE_URL + '/api/api-tokens/' + encodeURIComponent(token), {
    method: 'DELETE',
    credentials: 'include',
    headers: { 'X-CSRF-Token': csrf }
  });
  return await res.json();
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
        <span style="font-family:monospace;">${t.token.slice(0, 8)}...${t.token.slice(-4)}</span>
        <button class="api-token-copy-btn" title="复制" data-token="${t.token}">复制</button>
      </td>
      <td>${escapeHtml(t.description || '')}</td>
      <td>${t.created_at ? new Date(t.created_at).toLocaleString() : ''}</td>
      <td>${t.expired_at ? new Date(t.expired_at).toLocaleDateString() : '永久'}</td>
      <td>${t.is_active ? '有效' : '已失效'}</td>
      <td>
        ${t.is_active ? `<button class="btn-deactivate" data-token="${t.token}">失效</button>` : ''}
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
      await deactivateToken(btn.getAttribute('data-token'));
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

document.addEventListener('DOMContentLoaded', () => {
  loadTokens();

  const form = document.getElementById('api-token-create-form');
  const msg = document.getElementById('api-token-create-msg');
  form.onsubmit = async e => {
    e.preventDefault();
    const desc = document.getElementById('token-desc').value.trim();
    const expire = document.getElementById('token-expire').value || null;
    if (!desc) {
      msg.textContent = '描述不能为空';
      msg.style.color = 'red';
      return;
    }
    form.querySelector('button[type="submit"]').disabled = true;
    msg.textContent = '创建中...';
    msg.style.color = '#888';
    try {
      const res = await createToken(desc, expire);
      if (res.success) {
        msg.textContent = '创建成功';
        msg.style.color = 'green';
        form.reset();
        await loadTokens();
      } else {
        msg.textContent = res.message || '创建失败';
        msg.style.color = 'red';
      }
    } catch (err) {
      msg.textContent = '网络错误，请重试';
      msg.style.color = 'red';
    } finally {
      form.querySelector('button[type="submit"]').disabled = false;
    }
  };
});