let currentUser = { name: "获取中...", id: "" };
let userRoles = [];

/*
 * groupedData[borrowOrderId] = {
 *   step: 1 | 2,               // 当前所处步骤 (1=借图员发起, 2=管理员确认)
 *   borrower_name: "张三",     // 原借用人(只读)
 *   savedAt: null | "时间",    // 草稿时间
 *   items:[ ...db记录, _scanned: bool ]
 * }
 */
let groupedData = {};

$(document).ready(() => {
  const cached = feishuGetUser();
  if (cached && cached.openId) {
    currentUser = { name: cached.nickName, id: cached.openId };
    checkAuthAndInit();
  } else {
    alert("登录状态已过期或异常，请返回主页重新加载。");
    window.location.href = "/";
  }
});

// ── 1. 验证权限 ──────────────────────────────────────────────
function checkAuthAndInit() {
  fetch(`/api/my_roles?open_id=${currentUser.id}`)
    .then(r => r.json())
    .then(res => {
      userRoles = res.roles ||[];
      const isBorrowerRole = userRoles.includes('borrower');
      const isAdminRole    = userRoles.includes('drawing_admin');
      const isSuperRole    = userRoles.includes('super_admin');

      // 只有这三种角色能进入归还页面
      if (!isBorrowerRole && !isAdminRole && !isSuperRole) {
        showAlert("您没有归还模块的操作权限（需为借图员或图纸管理员）", () => history.back());
        return;
      }

      // 初始化飞书扫码组件
      feishuAuth({
        jsApiList: ['scanCode'],
        onReady() { /* 就绪后可以进行扫码 */ }
      });
    })
    .catch(() => showAlert("获取权限失败，请重试"));
}

const isBorrower = () => userRoles.includes('borrower') || userRoles.includes('super_admin');
const isAdmin    = () => userRoles.includes('drawing_admin') || userRoles.includes('super_admin');

// ── 2. 扫码逻辑 ──────────────────────────────────────────────
function startScan() {
  if (!window.tt || !window.tt.scanCode) {
    alert("扫码组件未就绪，请在飞书客户端中打开");
    return;
  }
  tt.scanCode({
    scanType: ['barCode', 'qrCode'],
    success(res) {
      let data;
      try {
        let clean = res.result.trim();
        if (clean.endsWith('|')) clean = clean.slice(0, -1);
        data = JSON.parse(clean);
      } catch (e) {
        return showAlert("二维码解析失败，请重试", startScan);
      }

      const borrowOrderId = data.borrowedNum || "";
      const chartNo       = data.chartNum    || "";
      const rawOrderNum   = data.orderNum    || "";

      if (!borrowOrderId || !chartNo) {
        return showAlert("二维码信息不完整，请核查", startScan);
      }

      if (groupedData[borrowOrderId]) {
        hitChart(borrowOrderId, chartNo, rawOrderNum);
        return;
      }

      loadOrder(borrowOrderId, () => hitChart(borrowOrderId, chartNo, rawOrderNum));
    },
    fail() { /* 手动关闭不处理 */ }
  });
}

// ── 3. 智能载入归还单并展示全文明细 ─────────────────────────
function loadOrder(borrowOrderId, callback) {
  if (groupedData[borrowOrderId]) {
    showToast(`单号 ${borrowOrderId} 已加载`, "success");
    return;
  }

  fetch(`/api/return/order/${encodeURIComponent(borrowOrderId)}`)
    .then(r => r.json())
    .then(res => {
      if (res.code !== 0) return showAlert(res.msg, startScan);

      const step1Items = res.data.filter(it => it.status === '已借出' || it.status === '待还草稿');
      const step2Items = res.data.filter(it => it.status === '待归还' || it.status === '已还草稿');

      let step = 0; // 默认0表示仅查看(只读)

      if (isBorrower() && step1Items.length > 0) {
        step = 1;
      } else if (isAdmin() && step2Items.length > 0) {
        step = 2;
      } else {
        // [修改 1] 无权限或无数据时，不阻断，只给予提示并将 step 置为 0 (只读)
        if (step1Items.length === 0 && step2Items.length === 0) {
          showToast(`单号【${borrowOrderId}】无可归还明细，仅供查看`);
        } else if (step1Items.length > 0 && !isBorrower()) {
          showToast(`有待借图员发起的图纸，您无权限，仅供查看`);
        } else if (step2Items.length > 0 && !isAdmin()) {
          showToast(`有待管理员确认的图纸，您无权限，仅供查看`);
        }
      }

      const processedItems = res.data.map(it => {
        let scanned = false;
        let isActionable = false;
        if (step === 1 && (it.status === '待还草稿' || it.status === '已借出')) {
          isActionable = true;
          if (it.status === '待还草稿') scanned = true;
        } else if (step === 2 && (it.status === '已还草稿' || it.status === '待归还')) {
          isActionable = true;
          if (it.status === '已还草稿') scanned = true;
        }
        return { ...it, _scanned: scanned, _isActionable: isActionable };
      });

      const bName = res.data.find(it => it.borrower_name)?.borrower_name || "未知";
      let savedAt = null;
      const draftIt = processedItems.find(it => (step === 1 && it.status === '待还草稿') || (step === 2 && it.status === '已还草稿'));
      if (draftIt) savedAt = draftIt.return_time;

      groupedData[borrowOrderId] = { step, borrower_name: bName, savedAt, items: processedItems };
      renderList();

      if (callback) callback();
    })
    .catch(() => showAlert("网络异常，加载失败"));
}

function hitChart(borrowOrderId, chartNo, rawOrderNum) {
  const group = groupedData[borrowOrderId];

  // [修改 2] 拦截只读模式的扫码
  if (group.step === 0) {
    return showAlert(`当前单据处于仅查看模式，无法操作图纸。`, startScan);
  }

  const byChart = group.items.filter(it => it.chart_no === chartNo);
  if (byChart.length === 0) return showAlert(`图号【${chartNo}】不在该借用单中。`, startScan);

  const actionable = byChart.filter(it => it._isActionable);
  if (actionable.length === 0) return showAlert(`图号【${chartNo}】当前状态不支持在该阶段归还。`, startScan);
  if (actionable.every(it => it._scanned)) return showAlert(`该图纸已扫码，无需重复。`, startScan);

  actionable.forEach(it => { it._scanned = true; });
  renderList();

  const allDone = group.items.filter(it => it._isActionable).every(it => it._scanned);
  if (allDone) {
    showToast("✅ 可归还的图纸已全部扫码完毕！", "success");
  } else {
    showToast(`扫码成功: ${chartNo}`, "success");
    setTimeout(startScan, 1000);
  }
}

function renderList() {
  const $list = $("#record-list").empty();
  const keys = Object.keys(groupedData);
  const totalItems = keys.reduce((acc, k) => acc + groupedData[k].items.length, 0);
  $("#record-count").text(totalItems);

  if (keys.length === 0) {
    return $list.append('<div class="empty-tip">暂无数据，请扫码或点击【草稿】开始</div>');
  }

  keys.forEach(bNum => {
    const group = groupedData[bNum];
    const actionableItems = group.items.filter(it => it._isActionable);
    const totalActionable = actionableItems.length;
    const scanned = actionableItems.filter(it => it._scanned).length;

    const canSubmit = scanned > 0;
    const allDoneForProgress = totalActionable > 0 && scanned === totalActionable;

    // [修改 3] 处理只读情况的 UI 文本
    const stepName = group.step === 1 ? "第1步: 借图员发起" :
                     group.step === 2 ? "第2步: 管理员确认" : "仅供查看 (无待办/无权限)";
    const opRole   = group.step === 1 ? "借图员" :
                     group.step === 2 ? "管理员" : "访客";
    const opClass  = group.step === 1 ? "role-borrower" :
                     group.step === 2 ? "role-admin" : "";

    const draftTag = group.savedAt ? `<span class="draft-tag">${stepName} | 草稿 ${group.savedAt}</span>` : `<span class="draft-tag">${stepName}</span>`;

    const rowsHtml = group.items.map(it => {
      let displayStatus = it._scanned ? '已扫码' : it.status;
      const { cls, label } = statusStyle(displayStatus);
      const rowStyle = (it._isActionable || group.step === 0) ? '' : 'opacity: 0.55; background: #fafbfc;';

      return `
        <tr class="item-row ${it._scanned ? 'row-scanned' : ''}" style="${rowStyle}">
          <td class="item-cell cell-seq">${it.seq_no || ''}</td>
          <td class="item-cell cell-chart">
            <div class="chart-no">${it.chart_no}</div>
            <div class="work-order">工作令：${it.work_order_id || '—'}</div>
          </td>
          <td class="item-cell cell-type">${it.drawing_type || '—'}</td>
          <td class="item-cell cell-purpose">${it.purpose || '—'}</td>
          <td class="item-cell cell-status">
            <span class="status-badge ${cls}">${label}</span>
          </td>
        </tr>`;
    }).join('');

    // [修改 4] 如果是 step=0 只读模式，隐藏底部操作按钮区
    const actionsHtml = group.step === 0 ? '' : `
      <div class="group-actions">
        <button class="btn-save-draft" onclick="saveReturnDraft('${bNum}')">💾 保存草稿</button>
        <button class="btn-submit-order ${canSubmit ? '' : 'btn-disabled'}" onclick="submitReturn('${bNum}')" ${canSubmit ? '' : 'disabled'}>✅ 提交归还</button>
      </div>`;

    $list.append(`
      <div class="group-card">
        <div class="group-header">
          <div class="group-title-wrap">
            <div class="group-title">单号：${bNum}</div>
            ${draftTag}
          </div>
          <div class="group-progress ${allDoneForProgress ? 'progress-done' : ''}">
            ${group.step !== 0 ? `${scanned} / ${totalActionable}` : '只读'}
          </div>
        </div>
        <div class="manager-row">
          <span class="manager-label">操作人</span>
          <span class="manager-value ${opClass}">${currentUser.name} (${opRole})</span>
        </div>
        <div class="borrower-row">
          <div class="borrower-row-left">
            <span class="borrower-row-label">原借用人</span>
            <span class="borrower-value">${group.borrower_name}</span>
          </div>
        </div>
        <table class="item-table">
          <thead>
            <tr><th class="th-seq">序号</th><th class="th-chart">图号 / 工作令</th><th class="th-type">类型</th><th class="th-purpose">用途</th><th class="th-status">状态</th></tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
        ${actionsHtml}
      </div>`);
  });
}

// ── 5. 保存与提交动作 ────────────────────────────────────────
function saveReturnDraft(bNum) {
  const group = groupedData[bNum];
  // 只抓取可操作且被扫码的图纸
  const scannedNos = group.items.filter(it => it._isActionable && it._scanned).map(it => it.chart_no);

  if (scannedNos.length === 0) {
    return showAlert("未扫码任何图纸，无需保存。");
  }

  fetch('/api/return/save_draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      borrow_order_id: bNum,
      scanned_chart_nos: scannedNos,
      step: group.step
    })
  })
  .then(r => r.json())
  .then(res => {
    if (res.code === 0) {
      group.savedAt = res.saved_at;
      group.items.forEach(it => {
        if (it._isActionable && it._scanned) {
          it.status = (group.step === 1) ? '待还草稿' : '已还草稿';
        }
      });
      renderList();
      showToast("草稿保存成功", "success");
    } else {
      showAlert(res.msg);
    }
  })
  .catch(() => showAlert("保存失败，网络异常"));
}

function submitReturn(bNum) {
  const group = groupedData[bNum];
  // 只抓取可操作且被扫码的图纸
  const scannedNos = group.items.filter(it => it._isActionable && it._scanned).map(it => it.chart_no);

  if (scannedNos.length === 0) {
    return showAlert("请至少扫码一张图纸后再提交！");
  }

  if (!confirm(`确认提交单据【${bNum}】中已扫码的 ${scannedNos.length} 项图纸吗？\n(未扫码的图纸可下次再还)`)) return;

  fetch('/api/return/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      borrow_order_id: bNum,
      scanned_chart_nos: scannedNos,
      step: group.step,
      user_name: currentUser.name,
      user_id: currentUser.id
    })
  })
  .then(r => r.json())
  .then(res => {
    if (res.code === 0) {
      showToast("提交成功！", "success");
      setTimeout(() => {
        delete groupedData[bNum];
        renderList();
      }, 1000);
    } else {
      showAlert(res.msg || "提交失败");
    }
  })
  .catch(() => showAlert("提交失败，网络异常"));
}

// ── 6. 获取草稿列表及轮盘选择器 (Wheel Picker) ────────────────
function openDraftList() {
  fetch(`/api/return/drafts?open_id=${currentUser.id}`)
    .then(r => r.json())
    .then(res => {
      if (!res.data || res.data.length === 0) {
        return showAlert("暂无您可以处理的归还草稿记录");
      }
      showWheelPicker(res.data);
    })
    .catch(() => showAlert("加载草稿失败，请重试"));
}

function showWheelPicker(drafts) {
  $('#draft-picker-mask').remove();

  const ITEM_H = 44;
  const VISIBLE = 5;

  const itemsHtml = drafts.map((d, i) => `
    <div class="wp-item" data-index="${i}">
      <span class="wp-order">${d.borrow_order_id}</span>
      <span class="wp-time">${d.saved_at || '无时间'}</span>
    </div>`).join('');

  const mask = $(`
    <div id="draft-picker-mask">
      <div id="draft-picker-sheet">
        <div id="dp-header">
          <button id="dp-cancel">取消</button>
          <span id="dp-title">选择归还草稿</span>
          <button id="dp-confirm">确定</button>
        </div>
        <div id="dp-wheel-wrap">
          <div id="dp-wheel">${itemsHtml}</div>
          <div id="dp-highlight-top"></div>
          <div id="dp-highlight"></div>
          <div id="dp-highlight-bot"></div>
        </div>
      </div>
    </div>`);

  $('body').append(mask);

  const $wheel = $('#dp-wheel');
  let selectedIdx = 0;
  let lastY = 0, velocity = 0, rafId = null;
  let currentOffset = 0;

  function clampIdx(idx) { return Math.max(0, Math.min(drafts.length - 1, idx)); }
  function offsetForIdx(idx) { return Math.floor(VISIBLE / 2) * ITEM_H - idx * ITEM_H; }

  function applyOffset(offset, animate) {
    $wheel.css({
      transition: animate ? 'transform 0.3s cubic-bezier(0.25,0.46,0.45,0.94)' : 'none',
      transform:  `translateY(${offset}px)`
    });
    currentOffset = offset;
  }

  function snapToNearest(offset) {
    const center = Math.floor(VISIBLE / 2) * ITEM_H;
    const rawIdx = (center - offset) / ITEM_H;
    selectedIdx  = clampIdx(Math.round(rawIdx));
    applyOffset(offsetForIdx(selectedIdx), true);
    updateHighlight();
  }

  function updateHighlight() {
    $('#dp-wheel .wp-item').removeClass('wp-selected');
    $(`#dp-wheel .wp-item[data-index="${selectedIdx}"]`).addClass('wp-selected');
  }

  applyOffset(offsetForIdx(0), false);
  updateHighlight();

  // 移动端手势支持
  $wheel[0].addEventListener('touchstart', e => {
    cancelAnimationFrame(rafId);
    lastY = e.touches[0].clientY;
    velocity = 0;
    $wheel.css('transition', 'none');
  }, { passive: true });

  $wheel[0].addEventListener('touchmove', e => {
    const y   = e.touches[0].clientY;
    const dy  = y - lastY;
    velocity  = dy;
    lastY     = y;
    currentOffset = Math.min(offsetForIdx(0), Math.max(offsetForIdx(drafts.length - 1), currentOffset + dy));
    $wheel.css('transform', `translateY(${currentOffset}px)`);
  }, { passive: true });

  $wheel[0].addEventListener('touchend', () => {
    let inertiaOffset = currentOffset;
    function inertia() {
      if (Math.abs(velocity) < 0.5) { snapToNearest(inertiaOffset); return; }
      velocity      *= 0.92;
      inertiaOffset  = Math.min(offsetForIdx(0), Math.max(offsetForIdx(drafts.length - 1), inertiaOffset + velocity));
      $wheel.css('transform', `translateY(${inertiaOffset}px)`);
      rafId = requestAnimationFrame(inertia);
    }
    rafId = requestAnimationFrame(inertia);
  });

  // PC 端鼠标滚轮支持
  $wheel[0].addEventListener('wheel', e => {
    e.preventDefault();
    selectedIdx = clampIdx(selectedIdx + (e.deltaY > 0 ? 1 : -1));
    applyOffset(offsetForIdx(selectedIdx), true);
    updateHighlight();
  }, { passive: false });

  // 点击单项支持
  $wheel.on('click', '.wp-item', function () {
    selectedIdx = parseInt($(this).data('index'), 10);
    applyOffset(offsetForIdx(selectedIdx), true);
    updateHighlight();
  });

  // 按钮交互
  $('#dp-cancel').on('click', () => mask.remove());
  $('#dp-confirm').on('click', () => {
    const chosen = drafts[selectedIdx];
    mask.remove();
    loadOrder(chosen.borrow_order_id);
  });

  // 点击遮罩层关闭
  mask.on('click', function (e) { if (e.target === this) mask.remove(); });
}

// ── 7. 工具与样式函数 ─────────────────────────────────────────

function statusStyle(status) {
  switch (status) {
    case '已扫码':    return { cls: 'badge-scanned',     label: '已扫码' };
    case '已借出':    return { cls: 'badge-out',         label: '已借出' };
    case '待归还':    return { cls: 'badge-pending-ret', label: '待归还' };
    case '已归还':    return { cls: 'badge-returned',    label: '已归还' };
    default:          return { cls: 'badge-pending',     label: status };
  }
}

function showToast(title, icon = "none") {
  if (window.tt && tt.showToast) {
    tt.showToast({ title, icon, duration: 1500 });
  } else {
    alert(title);
  }
}

function showAlert(msg, afterClose) {
  if (window.tt && tt.showModal) {
    tt.showModal({
      title: "提示",
      content: msg,
      showCancel: false,
      complete() { if (typeof afterClose === 'function') afterClose(); }
    });
  } else {
    alert(msg);
    if (typeof afterClose === 'function') afterClose();
  }
}

// ── 8. 手动还图相关逻辑 ──────────────
function openManualModal() {
  $("#manual-chart-no").val('');
  $("#manual-work-order").val('');
  $("#manual-result-list").empty();
  $("#manual-modal").removeClass("hidden");
}

function closeManualModal() {
  $("#manual-modal").addClass("hidden");
}

function searchManual() {
  const chartNo = $("#manual-chart-no").val().trim();
  const workOrder = $("#manual-work-order").val().trim();

  if (!chartNo) {
    return showToast("请输入图号", "error");
  }

  $("#manual-result-list").html('<div class="mr-empty">搜索中...</div>');

  fetch('/api/return/search_manual', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chart_no: chartNo, work_order_id: workOrder, open_id: currentUser.id })
  })
  .then(r => r.json())
  .then(res => {
    if (res.code !== 0 || res.data.length === 0) {
      return $("#manual-result-list").html('<div class="mr-empty">未找到可供您归还的借用单记录</div>');
    }

    // 渲染带有借用时间和工作令明细的结果卡片
    const listHtml = res.data.map(d => {
      // 遍历所有明细，生成蓝色的小标签
      const detailsHtml = d.items.map(it =>
        `<span class="mr-tag">${it.work_order_id || '无工作令'} (${it.status})</span>`
      ).join('');

      return `
      <div class="manual-result-item">
        <div class="mr-top">
          <div class="mr-info">
            <span class="mr-order">单号：${d.borrow_order_id}</span>
            <span class="mr-time">借出时间：${d.borrow_time || '未知'}</span>
          </div>
          <button class="mr-btn" onclick="confirmManualReturn('${d.borrow_order_id}', '${chartNo}', '${workOrder}')">归还</button>
        </div>
        <div class="mr-details">
          ${detailsHtml}
        </div>
      </div>
    `}).join('');

    $("#manual-result-list").html(listHtml);
  })
  .catch(() => $("#manual-result-list").html('<div class="mr-empty">网络异常，搜索失败</div>'));
}

function confirmManualReturn(bNum, chartNo, workOrder) {
  // 文案明确提示：将归还该图号的“所有明细”
  if (!confirm(`确认在单号【${bNum}】中，将图号【${chartNo}】的所有关联明细一并归还吗？\n\n(该操作将精确修改本单下此图号的全部工作令记录)`)) return;

  fetch('/api/return/manual_submit', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      borrow_order_id: bNum,
      chart_no: chartNo,
      user_name: currentUser.name,
      user_id: currentUser.id
    })
  })
  .then(r => r.json())
  .then(res => {
    if (res.code === 0) {
      showToast("手动归还成功", "success");
      closeManualModal();

      // 重新加载该单据的列表，刷新显示状态
      delete groupedData[bNum];
      loadOrder(bNum);
    } else {
      showAlert(res.msg);
    }
  });
}