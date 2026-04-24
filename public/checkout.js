// ═══════════════════════════════════════════════════════════════════════════
//  图纸借出页面逻辑
//  状态机（内存）：待借出 → 已扫(scanned) → 提交后写库为已借出
//  草稿：保存时把已扫图号列表发给后端，写库为"草稿"；下次加载可识别
// ═══════════════════════════════════════════════════════════════════════════

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
$(document).ready(apiAuth);

function apiAuth() {
  if (!window.h5sdk) return;
  const url = encodeURIComponent(location.href.split("#")[0]);
  fetch(`/get_config_parameters?url=${url}`)
    .then(r => r.json())
    .then(res => {
      window.h5sdk.config({
        appId: res.appid, timestamp: res.timestamp,
        nonceStr: res.noncestr, signature: res.signature,
        jsApiList: ['scanCode', 'chooseContact', 'getUserInfo'],
        onSuccess: () => {
          window.h5sdk.ready(() => {
            tt.getUserInfo({
              success(res) {
                currentUser = {
                  name: res.userInfo.nickName,
                  id:   res.userInfo.openId || ""
                };
              }
            });
          });
        }
      });
    });
}

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

  // 拆分工作令号：按 PJ 前缀分割（PJ开头的工作令号）
  // 例："PJ0126001-JGPJ0124165-XS-AT001" → ["PJ0126001-JG","PJ0124165-XS-AT001"]
  // 空串（无工作令号）→ [] 表示匹配 work_order_id 为空的行
  const orderNums = parseOrderNums(rawOrderNum);

  // 已加载的单：直接处理命中逻辑
  if (groupedData[borrowOrderId]) {
    hitChart(borrowOrderId, chartNo, orderNums);
    return;
  }

  // 未加载：去后端拉取明细
  fetch(`/api/order/${encodeURIComponent(borrowOrderId)}`)
    .then(r => r.json())
    .then(res => {
      if (res.code !== 0) {
        showAlert(`借用单【${borrowOrderId}】不存在，请先在"借用单导入"中导入后再操作。`, () => startScan());
        return;
      }

      // 整单已全部借出 → 只提示，不加载明细
      if (res.all_out) {
        const outItem = res.data.find(it => it.status === '已借出');
        const info = outItem
          ? `该单已于 ${outItem.borrow_time} 借给【${outItem.borrower_name}】`
          : "该单已全部借出";
        showAlert(`借用单【${borrowOrderId}】\n${info}`, () => startScan());
        return;
      }

      // 加载明细到内存；草稿行的 _scanned 标为 true
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

/**
 * 将二维码中拼接的工作令号字符串拆分为数组。
 * 规则：以 "PJ" 作为每个工作令号的起始标志进行分割。
 *   "PJ0126001-JGPJ0124165-XS-AT001" → ["PJ0126001-JG", "PJ0124165-XS-AT001"]
 *   ""  → []   （无工作令号，匹配 work_order_id 为空的行）
 *   "PJ0126001-JG" → ["PJ0126001-JG"]
 *
 * 若将来工作令前缀不是 PJ，可在此处扩展正则。
 */
function parseOrderNums(raw) {
  if (!raw || !raw.trim()) return [];
  // 按 PJ 分割，过滤掉空字符串，再拼回 PJ 前缀
  const parts = raw.split(/(?=PJ)/);
  return parts.map(s => s.trim()).filter(Boolean);
}

// ── 命中某张图纸 ──────────────────────────────────────────────────────────
/**
 * @param {string}   borrowOrderId  借用单号
 * @param {string}   chartNo        图号
 * @param {string[]} orderNums      已拆分的工作令号数组
 *                                  [] 表示二维码中无工作令号，匹配 work_order_id 为空的行
 *
 * 匹配规则：
 *   - 先按 chartNo 过滤候选行（排除无图）
 *   - 再按 orderNums 精确匹配 work_order_id：
 *       · orderNums 非空 → 只标记 work_order_id 在 orderNums 中的行
 *       · orderNums 为空 → 只标记 work_order_id 为空/null 的行
 *   - 这样"不同借用单借同一图"各自只影响自己单号下对应工作令的行
 */
function hitChart(borrowOrderId, chartNo, orderNums) {
  let group = groupedData[borrowOrderId];

  // ① 该借用单下所有图号匹配的行（含无图）
  const byChart = group.items.filter(it => it.chart_no === chartNo);

  if (byChart.length === 0) {
    showAlert(`图号【${chartNo}】不在借用单【${borrowOrderId}】中，请核查。`, () => startScan());
    return;
  }

  // ② 全部是无图行
  if (byChart.every(it => it.status === '无图')) {
    showAlert(`图号【${chartNo}】幅面为【无图】，无实体图纸，无需借出操作。`, () => startScan());
    return;
  }

  // ③ 按工作令号精确匹配（排除无图行）
  const actionable = byChart.filter(it => it.status !== '无图' && matchOrderNum(it.work_order_id, orderNums));

  if (actionable.length === 0) {
    // 图号存在但工作令号对不上——可能是打印了两张图，扫到了另一张
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

  // ④ 命中的行是否已全部扫过
  if (actionable.every(it => it._scanned)) {
    const orders = actionable.map(it => it.work_order_id || '（无工作令）').join('、');
    showAlert(`图号【${chartNo}】（${orders}）已扫过，无需重复。`, () => startScan());
    return;
  }

  // ⑤ 标记命中行为已扫（仅内存，不写库）
  actionable.forEach(it => { it._scanned = true; });

  // 将命中的借用单置顶（移到 groupedData 第一位）
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

  // 检查该单是否已全部完成
  group      = groupedData[borrowOrderId];
  const scannable  = group.items.filter(it => it.status !== '无图');
  const allDone    = scannable.length > 0 && scannable.every(it => it._scanned);

  if (allDone) {
    // 整单扫完：提示完成，不自动续扫，等用户手动点扫码按钮
    showToast(toastMsg, "success");
    setTimeout(() => {
      showAlert(`借用单【${borrowOrderId}】全部图纸已扫完！\n请确认借用人后点击【提交借出】。`);
    }, 800);
  } else {
    showToast(toastMsg, "success");
    setTimeout(startScan, 1000);
  }
}

/**
 * 将指定借用单移到 groupedData 的第一位（置顶活跃单）。
 * JS 对象 key 的插入顺序在现代引擎中是稳定的，
 * 通过重建对象来实现重排。
 */
function promoteOrder(borrowOrderId) {
  if (!groupedData[borrowOrderId]) return;
  const entry  = groupedData[borrowOrderId];
  const others = Object.fromEntries(
    Object.entries(groupedData).filter(([k]) => k !== borrowOrderId)
  );
  groupedData = { [borrowOrderId]: entry, ...others };
}

/**
 * 判断某行的 work_order_id 是否与二维码中的工作令号列表匹配。
 *   - orderNums 非空：work_order_id 必须在列表中
 *   - orderNums 为空：work_order_id 必须为空/null/undefined
 */
function matchOrderNum(workOrderId, orderNums) {
  const wid = (workOrderId || "").trim();
  if (orderNums.length === 0) {
    // 二维码无工作令号 → 只匹配库中 work_order_id 为空的行
    return wid === "";
  }
  return orderNums.includes(wid);
}

// ── 草稿列表弹窗（iOS 轮盘选择器） ───────────────────────────────────────
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

/**
 * 显示 iOS 风格轮盘选择器
 * @param {Array} drafts  [{borrow_order_id, saved_at, draft_count}, ...]
 */
function showWheelPicker(drafts) {
  // 如果已有弹层则移除
  $('#draft-picker-mask').remove();

  const ITEM_H = 44;   // 每项高度 px
  const VISIBLE = 5;   // 可见行数（奇数，中间行为选中项）

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

  // ── 轮盘滚动逻辑 ──────────────────────────────────────────────────────
  const $wheel = $('#dp-wheel');
  let selectedIdx = 0;
  let startY = 0, lastY = 0, velocity = 0, rafId = null;
  let currentOffset = 0;   // 当前 translateY 偏移

  function clampIdx(idx) {
    return Math.max(0, Math.min(drafts.length - 1, idx));
  }

  function offsetForIdx(idx) {
    // 让 idx 项居中：中心位置 = VISIBLE/2 * ITEM_H
    return Math.floor(VISIBLE / 2) * ITEM_H - idx * ITEM_H;
  }

  function applyOffset(offset, animate) {
    $wheel.css({
      transition: animate ? 'transform 0.3s cubic-bezier(0.25,0.46,0.45,0.94)' : 'none',
      transform:  `translateY(${offset}px)`
    });
    currentOffset = offset;
  }

  function snapToNearest(offset) {
    // 由偏移反推最近的 index
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

  // 初始定位到第 0 项
  applyOffset(offsetForIdx(0), false);
  updateHighlight();

  // Touch 事件
  $wheel[0].addEventListener('touchstart', e => {
    cancelAnimationFrame(rafId);
    startY = lastY = e.touches[0].clientY;
    velocity = 0;
    $wheel.css('transition', 'none');
  }, { passive: true });

  $wheel[0].addEventListener('touchmove', e => {
    const y    = e.touches[0].clientY;
    const dy   = y - lastY;
    velocity   = dy;
    lastY      = y;
    currentOffset = Math.min(
      offsetForIdx(0),
      Math.max(offsetForIdx(drafts.length - 1), currentOffset + dy)
    );
    $wheel.css('transform', `translateY(${currentOffset}px)`);
  }, { passive: true });

  $wheel[0].addEventListener('touchend', () => {
    // 惯性滑动
    let inertiaOffset = currentOffset;
    function inertia() {
      if (Math.abs(velocity) < 0.5) {
        snapToNearest(inertiaOffset);
        return;
      }
      velocity    *= 0.92;
      inertiaOffset = Math.min(
        offsetForIdx(0),
        Math.max(offsetForIdx(drafts.length - 1), inertiaOffset + velocity)
      );
      $wheel.css('transform', `translateY(${inertiaOffset}px)`);
      rafId = requestAnimationFrame(inertia);
    }
    rafId = requestAnimationFrame(inertia);
  });

  // 鼠标滚轮（PC 调试用）
  $wheel[0].addEventListener('wheel', e => {
    e.preventDefault();
    selectedIdx = clampIdx(selectedIdx + (e.deltaY > 0 ? 1 : -1));
    applyOffset(offsetForIdx(selectedIdx), true);
    updateHighlight();
  }, { passive: false });

  // 点击某项直接选中
  $wheel.on('click', '.wp-item', function () {
    selectedIdx = parseInt($(this).data('index'), 10);
    applyOffset(offsetForIdx(selectedIdx), true);
    updateHighlight();
  });

  // 按钮事件
  $('#dp-cancel').on('click', () => mask.remove());
  $('#dp-confirm').on('click', () => {
    const chosen = drafts[selectedIdx];
    mask.remove();
    loadOrder(chosen.borrow_order_id);
  });

  // 点蒙层关闭
  mask.on('click', function (e) {
    if (e.target === this) mask.remove();
  });
}

// 加载单号明细到 groupedData（草稿列表点击或其他场景调用）
function loadOrder(borrowOrderId) {
  if (groupedData[borrowOrderId]) {
    showToast(`单号 ${borrowOrderId} 已加载`, "success");
    return;
  }
  fetch(`/api/order/${encodeURIComponent(borrowOrderId)}`)
    .then(r => r.json())
    .then(res => {
      if (res.code !== 0) {
        showAlert(res.msg);
        return;
      }
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
      showToast(`已加载单号 ${borrowOrderId}`, "success");
    })
    .catch(() => showAlert("加载失败，请重试"));
}

// ── 保存草稿（按单号） ────────────────────────────────────────────────────
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
    body: JSON.stringify({
      borrow_order_id: borrowOrderId,
      scanned_chart_nos: scannedNos
    })
  })
  .then(r => r.json())
  .then(res => {
    if (res.code === 0) {
      group.savedAt = res.saved_at;
      // 同步内存中已扫行的 status 为草稿，以便下次加载识别
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

// ── 提交借出（按单号） ────────────────────────────────────────────────────
function submitOrder(borrowOrderId) {
  const group = groupedData[borrowOrderId];
  if (!group) return;

  // 校验借用人
  if (!group.borrower) {
    showAlert(`请先为借用单【${borrowOrderId}】选择借用人！`);
    const el = document.getElementById(`group-${borrowOrderId}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  // 校验是否全部扫完（每行独立校验，同图号不同工作令各自需要扫到）
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

  fetch('/api/submit_order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      borrow_order_id: borrowOrderId,
      borrower_name:   group.borrower.name,
      borrower_id:     group.borrower.id
    })
  })
  .then(r => r.json())
  .then(res => {
    if (res.code === 0) {
      showToast("提交成功！", "success");
      // 从内存移除已完成的单，页面刷新
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

// ── 选择借用人（每个分组独立） ────────────────────────────────────────────
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

    // 进度统计：每行独立计算（同图号不同工作令是不同的行，各自要扫）
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

    const rowsHtml = group.items.map(item => {
      // 显示状态：已扫用"已扫码"替代数据库状态，让用户看到实时进度
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
        <!-- 分组头部 -->
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

        <!-- 借用人行 -->
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

        <!-- 明细表格 -->
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

        <!-- 单据操作按钮 -->
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

// ── 状态 → 样式映射 ───────────────────────────────────────────────────────
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

/**
 * @param {string}   msg        提示内容
 * @param {Function} [afterClose] 弹窗关闭后执行（用于重新触发扫码）
 */
function showAlert(msg, afterClose) {
  if (window.tt && tt.showModal) {
    tt.showModal({
      title: "提示",
      content: msg,
      showCancel: false,
      complete() {
        if (typeof afterClose === 'function') afterClose();
      }
    });
  } else {
    alert(msg);
    if (typeof afterClose === 'function') afterClose();
  }
}