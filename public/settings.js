// ═══════════════════════════════════════════════════════════════════════
//  系统设置页面逻辑
//  - 从后端加载各角色成员列表
//  - 调用飞书 chooseContact（multi:true）添加成员
//  - 本地增删操作，点"保存"后统一提交后端
// ═══════════════════════════════════════════════════════════════════════

// 角色元数据定义（顺序即展示顺序）
const ROLES = [
  { key: 'super_admin',     name: '超级管理员', desc: '拥有所有权限，可管理所有角色' },
  { key: 'drawing_admin',   name: '图纸管理员', desc: '负责图纸借出、归还审核与管理' },
  { key: 'borrower',        name: '借图员',     desc: '可发起图纸借用申请' },
  { key: 'self_admin',      name: '自制管理员', desc: '管理自制件相关图纸流转' },
  { key: 'purchase_admin',  name: '采购管理员', desc: '管理采购类图纸借用流程' },
  { key: 'outsource_admin', name: '外协管理员', desc: '管理外协加工图纸流转' },
];

/*
 * rolesData[roleKey] = [{ name, open_id }, ...]
 * 本地操作在此处增删，保存时整体提交
 */
let rolesData = {};

// ── 初始化 ────────────────────────────────────────────────────────────
$(document).ready(() => {
  feishuAuth({
    jsApiList: ['chooseContact'],
    onReady() { /* JSAPI 就绪，chooseContact 可用 */ }
  });

  loadRoles();
});

// ── 从后端加载角色数据 ────────────────────────────────────────────────
function loadRoles() {
  fetch('/api/settings/roles')
    .then(r => r.json())
    .then(res => {
      if (res.code !== 0) {
        showToast('加载失败：' + (res.msg || '未知错误'), 'error');
        return;
      }
      rolesData = res.data || {};
      // 确保每个角色都有数组
      ROLES.forEach(r => {
        if (!rolesData[r.key]) rolesData[r.key] = [];
      });
      renderRoles();
    })
    .catch(() => showToast('网络异常，加载失败', 'error'));
}

// ── 渲染所有角色卡片 ──────────────────────────────────────────────────
function renderRoles() {
  $('#skeleton-area').addClass('hidden');
  $('#bottom-bar').removeClass('hidden');

  const $area = $('#roles-area').removeClass('hidden').empty();

  ROLES.forEach(role => {
    const members = rolesData[role.key] || [];
    const countLabel = members.length > 0 ? `${members.length} 人` : '未设置';
    const hasClass   = members.length > 0 ? 'has-member' : '';

    const membersHtml = members.length === 0
      ? `<div class="empty-role-tip">暂未设置，点击下方添加</div>`
      : members.map((m, idx) => memberItemHtml(role.key, m, idx)).join('');

    $area.append(`
      <div class="role-card" data-role="${role.key}">
        <div class="role-header">
          <div class="role-title-wrap">
            <div class="role-name">${role.name}</div>
            <div class="role-desc">${role.desc}</div>
          </div>
          <div class="role-count ${hasClass}">${countLabel}</div>
        </div>
        <div class="member-list" id="member-list-${role.key}">
          ${membersHtml}
        </div>
        <div class="add-member-row" onclick="addMember('${role.key}')">
          <div class="add-icon">
            <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
              <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
            </svg>
          </div>
          <span class="add-member-label">添加成员</span>
        </div>
      </div>`);
  });
}

// ── 生成单个成员行 HTML ───────────────────────────────────────────────
function memberItemHtml(roleKey, member, idx) {
  const initial = (member.name || '?').charAt(0).toUpperCase();
  return `
    <div class="member-item" data-idx="${idx}">
      <div class="member-avatar">${initial}</div>
      <div class="member-info">
        <div class="member-name">${member.name}</div>
        <div class="member-id">${member.open_id || ''}</div>
      </div>
      <button class="btn-remove-member" onclick="removeMember('${roleKey}', ${idx})" title="移除">
        <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
          <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19
                   12 13.41 17.59 19 19 17.59 13.41 12z"/>
        </svg>
      </button>
    </div>`;
}

// ── 添加成员（调用飞书多选联系人） ───────────────────────────────────
function addMember(roleKey) {
  if (!window.tt || !tt.chooseContact) {
    showToast('请在飞书客户端中使用此功能', 'error');
    return;
  }

  tt.chooseContact({
    multi: true,          // 多选
    externalContact: false,
    success(res) {
      if (!res.data || res.data.length === 0) return;

      const existing = rolesData[roleKey] || [];
      let addedCount = 0;

      res.data.forEach(contact => {
        // 去重：openId 已存在则跳过
        const alreadyIn = existing.some(m => m.open_id === contact.openId);
        if (!alreadyIn) {
          existing.push({ name: contact.name, open_id: contact.openId || '' });
          addedCount++;
        }
      });

      rolesData[roleKey] = existing;
      refreshRoleCard(roleKey);

      if (addedCount > 0) {
        showToast(`已添加 ${addedCount} 位成员`, 'success');
      } else {
        showToast('所选成员已在列表中', '');
      }
    },
    fail(err) {
      console.error('chooseContact 失败', err);
    }
  });
}

// ── 移除成员 ──────────────────────────────────────────────────────────
function removeMember(roleKey, idx) {
  rolesData[roleKey].splice(idx, 1);
  refreshRoleCard(roleKey);
}

// ── 刷新单个角色卡片的成员区和计数 ──────────────────────────────────
function refreshRoleCard(roleKey) {
  const members    = rolesData[roleKey] || [];
  const $list      = $(`#member-list-${roleKey}`);
  const $card      = $(`.role-card[data-role="${roleKey}"]`);
  const $count     = $card.find('.role-count');

  // 更新成员列表区
  $list.empty();
  if (members.length === 0) {
    $list.append('<div class="empty-role-tip">暂未设置，点击下方添加</div>');
  } else {
    members.forEach((m, idx) => $list.append(memberItemHtml(roleKey, m, idx)));
  }

  // 更新计数徽章
  const countLabel = members.length > 0 ? `${members.length} 人` : '未设置';
  $count.text(countLabel)
        .toggleClass('has-member', members.length > 0);
}

// ── 保存所有角色配置 ──────────────────────────────────────────────────
function saveAllRoles() {
  const $btn = $('#btn-save-all');
  $btn.addClass('saving').html(`
    <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"
         style="animation:spin .8s linear infinite">
      <path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0
               4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/>
    </svg>
    保存中...`);

  fetch('/api/settings/roles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roles: rolesData })
  })
  .then(r => r.json())
  .then(res => {
    $btn.removeClass('saving').html(`
      <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
        <path d="M17 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5
                 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z"/>
      </svg>
      保存所有设置`);

    if (res.code === 0) {
      showToast('✅ 设置已保存', 'success');
    } else {
      showToast('保存失败：' + (res.msg || '请重试'), 'error');
    }
  })
  .catch(() => {
    $btn.removeClass('saving').html(`
      <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
        <path d="M17 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5
                 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z"/>
      </svg>
      保存所有设置`);
    showToast('网络异常，保存失败', 'error');
  });
}

// ── Toast 提示（页面内，不依赖飞书 JSAPI） ───────────────────────────
let _toastTimer = null;
function showToast(msg, type) {
  // 动态插入 toast 节点
  if (!document.getElementById('toast-bar')) {
    $('body').append('<div id="toast-bar"></div>');
  }
  const $t = $('#toast-bar');
  $t.text(msg)
    .removeClass('toast-success toast-error')
    .addClass(type === 'success' ? 'toast-success' : type === 'error' ? 'toast-error' : '');

  clearTimeout(_toastTimer);
  // 短暂延迟让 display:block 生效再触发 transition
  setTimeout(() => $t.addClass('show'), 10);
  _toastTimer = setTimeout(() => $t.removeClass('show'), 2200);
}

// CSS keyframe for spin（动态注入，避免额外 CSS 文件）
const styleEl = document.createElement('style');
styleEl.textContent = '@keyframes spin { to { transform: rotate(360deg); } }';
document.head.appendChild(styleEl);
