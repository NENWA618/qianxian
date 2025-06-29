// API Token 管理前端逻辑（增强版：Token 只显示一次，后续仅显示部分，复制有弹窗提示，错误友好提示，表单输入校验，删除操作二次确认，全局错误提示支持）

const API_BASE_URL = window.API_BASE_URL || 'https://qianxian-backend.onrender.com';

// ====== 全局错误提示组件 ======
function showGlobalError(msg, duration = 4000) {
  let el = document.getElementById('global-error-tip');
  if (!el) {
    el = document.createElement('div');
    el.id = 'global-error-tip';
    el.style.position = 'fixed';
    el.style.top = '24px';
    el.style.left = '50%';
    el.style.transform = 'translateX(-50%)';
    el.style.background = 'rgba(220, 53, 69, 0.97)';
    el.style.color = '#fff';
    el.style.padding = '10px 32px';
    el.style.borderRadius = '8px';
    el.style.fontSize = '1.05em';
    el.style.zIndex = 99999;
    el.style.boxShadow = '0 2px 12px rgba(0,0,0,0.12)';
    el.style.display = 'none';
    el.style.maxWidth = '90vw';
    el.style.textAlign = 'center';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.display = 'block';
  el.style.opacity = '1';
  setTimeout(() => {
    el.style.opacity = '0';
    setTimeout(() => { el.style.display = 'none'; }, 400);
  }, duration);
}

// 前端输入校验，防止XSS/SQL注入
function validateInput(str, type = "text") {
  if (typeof str !== "string") return false;
  if (type === "desc") {
    // 描述允许中英文、数字、空格、常用标点，最长64
    return /^[\u4e00-\u9fa5\w\s.,，。:：;；!！?？\-()（）【】\[\]{}《》<>@#&*+=~$%^'"|\\/]{1,64}$/.test(str);
  }
  return true;
}

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

function showCopyTip(btn, text = "已复制") {
  // 弹窗动画提示
  const rect = btn.getBoundingClientRect();
  const tip = document.createElement('div');
  tip.textContent = text;
  tip.style.position = 'fixed';
  tip.style.left = rect.left + rect.width / 2 + 'px';
  tip.style.top = rect.top - 30 + 'px';
  tip.style.transform = 'translateX(-50%)';
  tip.style.background = '#222';
  tip.style.color = '#fff';
  tip.style.padding = '4px 12px';
  tip.style.borderRadius = '6px';
  tip.style.fontSize = '0.95em';
  tip.style.zIndex = 9999;
  tip.style.opacity = 0;
  tip.style.transition = 'opacity 0.2s';
  document.body.appendChild(tip);
  setTimeout(() => { tip.style.opacity = 1; }, 10);
  setTimeout(() => { tip.style.opacity = 0; }, 1200);
  setTimeout(() => { tip.remove(); }, 1500);
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
        showCopyTip(btn, "已复制");
        btn.textContent = '已复制';
        setTimeout(() => (btn.textContent = '复制'), 1000);
      }).catch(() => {
        showCopyTip(btn, "复制失败");
        showGlobalError('复制失败，请手动复制');
      });
    };
  });
  // 失效按钮事件
  document.querySelectorAll('.btn-deactivate').forEach(btn => {
    btn.onclick = async e => {
      // 二次确认弹窗
      if (!window.confirm('确定要失效此Token？此操作不可恢复。')) return;
      btn.disabled = true;
      try {
        const res = await deactivateToken(btn.getAttribute('data-token-id'));
        if (!res.success) {
          showGlobalError(res.message || 'Token失效失败');
        }
        await loadTokens();
      } catch (err) {
        showGlobalError('网络错误，Token失效失败');
      } finally {
        btn.disabled = false;
      }
    };
  });
}

async function loadTokens() {
  const tbody = document.getElementById('api-token-list-body');
  tbody.innerHTML = `<tr><td colspan="6">加载中...</td></tr>`;
  try {
    const data = await fetchTokens();
    if (!data.success) {
      tbody.innerHTML = `<tr><td colspan="6" style="color:red;">${escapeHtml(data.message || '加载失败')}</td></tr>`;
      showGlobalError(data.message || 'Token加载失败');
      return;
    }
    renderTokens(data.tokens || []);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" style="color:red;">加载失败</td></tr>`;
    showGlobalError('Token加载失败，请检查网络');
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
    // 新增：前端输入校验
    if (!validateInput(desc, "desc")) {
      msg.textContent = '描述不合法，仅允许常用文字、标点，最长64字';
      msg.style.color = 'red';
      showGlobalError('Token描述不合法，仅允许常用文字、标点，最长64字');
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
        showGlobalError(res.message || 'Token创建失败');
      }
    } catch (err) {
      msg.textContent = '网络错误，请重试';
      msg.style.color = 'red';
      showGlobalError('Token创建失败，请检查网络');
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  };
});