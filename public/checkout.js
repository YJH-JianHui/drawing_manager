let currentUser = { name: "获取中...", id: "" };

/*
 * groupedData[borrowOrderId] = {
 *   borrower  : null | { name, id },
 *   items     : [ ...db记录, 前端额外字段 _scanned:bool ]
 *   savedAt   : null | "2024-xx-xx xx:xx:xx"   草稿保存时间（仅草稿单有）
 * }
 */
let groupedData = {};

// ── 初始化 ────────────────────────────────────────────────────────────────
$(document).ready(() => {
  const cached = feishuGetUser();

  // 必须确保拿到了真实的 openId
  if (cached && cached.openId) {
    currentUser = { name: cached.nickName, id: cached.openId };

    // 初始化扫码等 JSAPI
    feishuAuth({
      jsApiList: ['scanCode', 'chooseContact'],
      onReady() { /* 就绪后可以扫码 */ }
    });
  } else {
    // 缓存失效或异常访问，直接弹窗拦截并踢回主页
    alert("登录状态已过期或异常，请返回主页重新加载。");
    window.location.href = "/";
  }
});

// ── 扫码入口 ──────────────────────────────────────────────────────────────
function startScan() {
  if (!window.tt || !window.tt.scanCode) {
    alert("扫码组件未就绪，请在飞书客户端中打开");
    return;
  }
  tt.scanCode({
    scanType: ['barCode', 'qrCode'],
    success(res) { processScanData(res.result); },
    fail()       { /* 用户手动关闭，不处理 */ }
  });
}

// ── 处理一次扫码 ──────────────────────────────────────────────────────────
function processScanData(resultStr) {
  let data;
  try {
    let clean = resultStr.trim();
    if (clean.endsWith('|')) clean = clean.slice(0, -1);
    data = JSON.parse(clean);
  } catch (e) {
    showAlert("二维码解析失败，请重试", () => startScan());
    return;
  }

  const borrowOrderId = data.borrowedNum || "";
  const chartNo       = data.chartNum    || "";
  const rawOrderNum   = data.orderNum    || "";

  if (!borrowOrderId || !chartNo) {
    showAlert("二维码信息不完整，请核查二维码内容", () => startScan());
    return;
  }

  const orderNums = parseOrderNums(rawOrderNum);

  if (groupedData[borrowOrderId]) {
    hitChart(borrowOrderId, chartNo, orderNums);
    return;
  }

  fetch(`/api/order/${encodeURIComponent(borrowOrderId)}`)
    .then(r => r.json())
    .then(res => {
      if (res.code !== 0) {
        showAlert(`借用单【${borrowOrderId}】不存在，请先在"借用单导入"中导入后再操作。`, () => startScan());
        return;
      }

      if (res.all_out) {
        const outItem = res.data.find(it => it.status === '已借出');
        const info = outItem
          ? `该单已于 ${outItem.borrow_time} 借给【${outItem.borrower_name}】`
          : "该单已全部借出";
        showAlert(`借用单【${borrowOrderId}】\n${info}`, () => startScan());
        return;
      }

      groupedData[borrowOrderId] = {
        borrower: null,
        savedAt:  null,
        items: res.data.map(it => ({
          ...it,
          _scanned: it.status === '草稿'
        }))
      };

      if (res.has_draft) {
        const draftItem = res.data.find(it => it.status === '草稿');
        if (draftItem) groupedData[borrowOrderId].savedAt = draftItem.borrow_time;
      }

      renderList();
      hitChart(borrowOrderId, chartNo, orderNums);
    })
    .catch(() => showAlert("网络异常，请检查后重试", () => startScan()));
}

function parseOrderNums(raw) {
  if (!raw || !raw.trim()) return [];
  const parts = raw.split(/(?=PJ)/);
  return parts.map(s => s.trim()).filter(Boolean);
}

// ── 命中某张图纸 ──────────────────────────────────────────────────────────
function hitChart(borrowOrderId, chartNo, orderNums) {
  let group = groupedData[borrowOrderId];

  const byChart = group.items.filter(it => it.chart_no === chartNo);

  if (byChart.length === 0) {
    showAlert(`图号【${chartNo}】不在借用单【${borrowOrderId}】中，请核查。`, () => startScan());
    return;
  }

  if (byChart.every(it => it.status === '无图')) {
    showAlert(`图号【${chartNo}】幅面为【无图】，无实体图纸，无需借出操作。`, () => startScan());
    return;
  }

  const actionable = byChart.filter(it => it.status !== '无图' && matchOrderNum(it.work_order_id, orderNums));

  if (actionable.length === 0) {
    const allOrders = byChart
      .filter(it => it.status !== '无图')
      .map(it => it.work_order_id || '（无工作令）')
      .join('、');
    showAlert(
      `图号【${chartNo}】在本单中有记录，但工作令号不匹配。\n本单工作令：${allOrders}`,
      () => startScan()
    );
    return;
  }

  if (actionable.every(it => it._scanned)) {
    const orders = actionable.map(it => it.work_order_id || '（无工作令）').join('、');
    showAlert(`图号【${chartNo}】（${orders}）已扫过，无需重复。`, () => startScan());
    return;
  }

  actionable.forEach(it => { it._scanned = true; });

  promoteOrder(borrowOrderId);
  renderList();

  const hitOrders = actionable.map(it => it.work_order_id).filter(Boolean);
  let toastMsg;
  if (hitOrders.length > 1) {
    toastMsg = `扫码成功：${chartNo}（${hitOrders.length} 个工作令合并标记）`;
  } else if (hitOrders.length === 1) {
    toastMsg = `扫码成功：${chartNo} / ${hitOrders[0]}`;
  } else {
    toastMsg = `扫码成功：${chartNo}`;
  }

  group           = groupedData[borrowOrderId];
  const scannable = group.items.filter(it => it.status !== '无图');
  const allDone   = scannable.length > 0 && scannable.every(it => it._scanned);

  if (allDone) {
    showToast(toastMsg, "success");
    setTimeout(() => {
      showAlert(`借用单【${borrowOrderId}】全部图纸已扫完！\n请确认借用人后点击【提交借出】。`);
    }, 800);
  } else {
    showToast(toastMsg, "success");
    setTimeout(startScan, 1000);
  }
}

function promoteOrder(borrowOrderId) {
  if (!groupedData[borrowOrderId]) return;
  const entry  = groupedData[borrowOrderId];
  const others = Object.fromEntries(
    Object.entries(groupedData).filter(([k]) => k !== borrowOrderId)
  );
  groupedData = { [borrowOrderId]: entry, ...others };
}

function matchOrderNum(workOrderId, orderNums) {
  const wid = (workOrderId || "").trim();
  if (orderNums.length === 0) return wid === "";
  return orderNums.includes(wid);
}

// ── 草稿列表弹窗 ──────────────────────────────────────────────────────────
function openDraftList() {
  fetch('/api/drafts')
    .then(r => r.json())
    .then(res => {
      if (!res.data || res.data.length === 0) {
        showAlert("暂无草稿记录");
        return;
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
      <span class="wp-time">${d.saved_at}</span>
    </div>`).join('');

  const mask = $(`
    <div id="draft-picker-mask">
      <div id="draft-picker-sheet">
        <div id="dp-header">
          <button id="dp-cancel">取消</button>
          <span id="dp-title">选择草稿</span>
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

  $wheel[0].addEventListener('wheel', e => {
    e.preventDefault();
    selectedIdx = clampIdx(selectedIdx + (e.deltaY > 0 ? 1 : -1));
    applyOffset(offsetForIdx(selectedIdx), true);
    updateHighlight();
  }, { passive: false });

  $wheel.on('click', '.wp-item', function () {
    selectedIdx = parseInt($(this).data('index'), 10);
    applyOffset(offsetForIdx(selectedIdx), true);
    updateHighlight();
  });

  $('#dp-cancel').on('click', () => mask.remove());
  $('#dp-confirm').on('click', () => {
    const chosen = drafts[selectedIdx];
    mask.remove();
    loadOrder(chosen.borrow_order_id);
  });
  mask.on('click', function (e) { if (e.target === this) mask.remove(); });
}

function loadOrder(borrowOrderId) {
  if (groupedData[borrowOrderId]) {
    showToast(`单号 ${borrowOrderId} 已加载`, "success");
    return;
  }
  fetch(`/api/order/${encodeURIComponent(borrowOrderId)}`)
    .then(r => r.json())
    .then(res => {
      if (res.code !== 0) { showAlert(res.msg); return; }
      if (res.all_out) {
        const outItem = res.data.find(it => it.status === '已借出');
        const info = outItem
          ? `该单已于 ${outItem.borrow_time} 借给【${outItem.borrower_name}】`
          : "该单已全部借出";
        showAlert(`借用单【${borrowOrderId}】\n${info}`);
        return;
      }
      groupedData[borrowOrderId] = {
        borrower: null,
        savedAt:  null,
        items: res.data.map(it => ({ ...it, _scanned: it.status === '草稿' }))
      };
      if (res.has_draft) {
        const draftItem = res.data.find(it => it.status === '草稿');
        if (draftItem) groupedData[borrowOrderId].savedAt = draftItem.borrow_time;
      }
      renderList();
      showToast(`已加载单号 ${borrowOrderId}`, "success");
    })
    .catch(() => showAlert("加载失败，请重试"));
}

// ── 保存草稿 ──────────────────────────────────────────────────────────────
function saveDraft(borrowOrderId) {
  const group = groupedData[borrowOrderId];
  if (!group) return;

  const scannedNos = [...new Set(
    group.items
      .filter(it => it._scanned && it.status !== '无图')
      .map(it => it.chart_no)
  )];

  if (scannedNos.length === 0) {
    showAlert(`单号【${borrowOrderId}】还未扫任何图纸，无需保存草稿。`);
    return;
  }

  fetch('/api/save_draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ borrow_order_id: borrowOrderId, scanned_chart_nos: scannedNos })
  })
  .then(r => r.json())
  .then(res => {
    if (res.code === 0) {
      group.savedAt = res.saved_at;
      group.items.forEach(it => {
        if (it._scanned && it.status !== '无图') it.status = '草稿';
      });
      renderList();
      showToast(`草稿已保存（${res.saved_at}）`, "success");
    } else {
      showAlert(res.msg || "保存失败，请重试");
    }
  })
  .catch(() => showAlert("网络异常，保存草稿失败"));
}

// ── 提交借出 ──────────────────────────────────────────────────────────────
function submitOrder(borrowOrderId) {
  const group = groupedData[borrowOrderId];
  if (!group) return;

  if (!group.borrower) {
    showAlert(`请先为借用单【${borrowOrderId}】选择借用人！`);
    const el = document.getElementById(`group-${borrowOrderId}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  const unscanned = group.items.filter(it => it.status !== '无图' && !it._scanned);
  if (unscanned.length > 0) {
    const detail = unscanned.slice(0, 3).map(it =>
      `${it.chart_no}${it.work_order_id ? ' / ' + it.work_order_id : ''}`
    ).join('\n');
    const more = unscanned.length > 3 ? `\n…等共 ${unscanned.length} 行` : `（共 ${unscanned.length} 行）`;
    showAlert(`还有未扫码的图纸，全部扫完后才能提交：\n${detail}${more}`);
    return;
  }

  if (!confirm(`确认将借用单【${borrowOrderId}】的全部图纸借给【${group.borrower.name}】吗？`)) return;

  // ── 出借管理人 = 当前登录用户 ────────────────────────────────────────
  const lendManagerName = currentUser.name || "";
  const lendManagerId   = currentUser.id   || "";

  fetch('/api/submit_order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      borrow_order_id:   borrowOrderId,
      borrower_name:     group.borrower.name,
      borrower_id:       group.borrower.id,
      lend_manager_name: lendManagerName,   // ← 新增
      lend_manager_id:   lendManagerId      // ← 新增
    })
  })
  .then(r => r.json())
  .then(res => {
    if (res.code === 0) {
      showToast("提交成功！", "success");
      setTimeout(() => {
        delete groupedData[borrowOrderId];
        renderList();
      }, 1000);
    } else {
      showAlert(res.msg || "提交失败，请重试");
    }
  })
  .catch(() => showAlert("网络异常，提交失败"));
}

// ── 选择借用人 ────────────────────────────────────────────────────────────
function selectBorrower(borrowOrderId) {
  if (!window.tt || !tt.chooseContact) {
    alert("请在飞书客户端中使用此功能");
    return;
  }
  tt.chooseContact({
    multi: false,
    externalContact: false,
    success(res) {
      if (res.data && res.data.length > 0) {
        groupedData[borrowOrderId].borrower = {
          name: res.data[0].name,
          id:   res.data[0].openId
        };
        renderList();
      }
    }
  });
}

// ── 渲染列表 ──────────────────────────────────────────────────────────────
function renderList() {
  const $list = $("#record-list");
  $list.empty();
  const keys = Object.keys(groupedData);

  const total = keys.reduce((acc, k) => acc + groupedData[k].items.length, 0);
  $("#record-count").text(total);

  if (keys.length === 0) {
    $list.append('<div class="empty-tip">暂无数据，请点击扫码按钮开始</div>');
    return;
  }

  keys.forEach(bNum => {
    const group    = groupedData[bNum];
    const borrower = group.borrower;

    const scannable    = group.items.filter(it => it.status !== '无图');
    const scannedCount = scannable.filter(it => it._scanned).length;
    const totalCount   = scannable.length;
    const allDone      = totalCount > 0 && scannedCount === totalCount;

    const borrowerLabel = borrower
      ? `<span class="borrower-selected">${borrower.name}</span>`
      : `<span class="borrower-unset">请点击选择借用人</span>`;

    const draftTag = group.savedAt
      ? `<span class="draft-tag">草稿 ${group.savedAt}</span>`
      : '';

    // 出借管理人展示行
    const managerName = currentUser.name && currentUser.name !== "获取中..."
      ? currentUser.name
      : "（登录中）";
    const managerTag = `
      <div class="manager-row">
        <span class="manager-label">出借管理人</span>
        <span class="manager-value">${managerName}</span>
      </div>`;

    const rowsHtml = group.items.map(item => {
      let displayStatus = item.status;
      if (item._scanned && item.status !== '无图') displayStatus = '已扫码';
      const { cls, label } = statusStyle(displayStatus);

      return `
        <tr class="item-row ${item._scanned && item.status !== '无图' ? 'row-scanned' : ''}">
          <td class="item-cell cell-seq">${item.seq_no || ''}</td>
          <td class="item-cell cell-chart">
            <div class="chart-no">${item.chart_no}</div>
            <div class="work-order">工作令：${item.work_order_id || '—'}</div>
          </td>
          <td class="item-cell cell-type">${item.drawing_type || '—'}</td>
          <td class="item-cell cell-purpose">${item.purpose || '—'}</td>
          <td class="item-cell cell-status">
            <span class="status-badge ${cls}">${label}</span>
          </td>
        </tr>`;
    }).join('');

    $list.append(`
      <div class="group-card" id="group-${bNum}">
        <div class="group-header">
          <div class="group-title-wrap">
            <div class="group-title">单号：${bNum}</div>
            ${draftTag}
          </div>
          <div class="group-progress ${allDone ? 'progress-done' : ''}">
            ${scannedCount} / ${totalCount}
            ${allDone ? ' ✓' : ''}
          </div>
        </div>

        <!-- 出借管理人（只读，当前登录用户） -->
        ${managerTag}

        <!-- 借用人行（可点击选择） -->
        <div class="borrower-row" onclick="selectBorrower('${bNum}')">
          <div class="borrower-row-left">
            <span class="borrower-row-label">借用人 <span class="required-star">*</span></span>
            ${borrowerLabel}
          </div>
          <div class="borrower-arrow">
            <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
              <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/>
            </svg>
          </div>
        </div>

        <table class="item-table">
          <thead>
            <tr>
              <th class="th-seq">序号</th>
              <th class="th-chart">图号 / 工作令</th>
              <th class="th-type">类型</th>
              <th class="th-purpose">用途</th>
              <th class="th-status">状态</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>

        <div class="group-actions">
          <button class="btn-save-draft" onclick="saveDraft('${bNum}')">
            💾 保存草稿
          </button>
          <button class="btn-submit-order ${allDone ? '' : 'btn-disabled'}"
                  onclick="submitOrder('${bNum}')"
                  ${allDone ? '' : 'disabled'}>
            ✅ 提交借出
          </button>
        </div>
      </div>`);
  });
}

// ── 状态样式映射 ──────────────────────────────────────────────────────────
function statusStyle(status) {
  switch (status) {
    case '已扫码':  return { cls: 'badge-scanned',   label: '已扫码' };
    case '草稿':    return { cls: 'badge-draft',      label: '草稿'   };
    case '已借出':  return { cls: 'badge-out',        label: '已借出' };
    case '已归还':  return { cls: 'badge-returned',   label: '已归还' };
    case '无图':    return { cls: 'badge-nodrawing',  label: '无图'   };
    default:        return { cls: 'badge-pending',    label: '待借出' };
  }
}

// ── 工具函数 ──────────────────────────────────────────────────────────────
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