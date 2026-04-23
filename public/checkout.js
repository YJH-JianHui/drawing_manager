let currentUser = "获取中...";
let currentBorrower = null;
// 数据结构改为：{ "单号1": { purpose: "", items: [ {图号, 工作令}, ... ] }, "单号2": ... }
let groupedData = {};

$(document).ready(apiAuth);

function apiAuth() {
  if (!window.h5sdk) return;
  const url = encodeURIComponent(location.href.split("#")[0]);
  fetch(`/get_config_parameters?url=${url}`)
    .then(r => r.json())
    .then(res => {
      window.h5sdk.config({
        appId: res.appid, timestamp: res.timestamp, nonceStr: res.noncestr, signature: res.signature,
        jsApiList: ['scanCode', 'chooseContact', 'getUserInfo'],
        onSuccess: () => {
          window.h5sdk.ready(() => {
            tt.getUserInfo({ success: (res) => { currentUser = res.userInfo.nickName; } });
          });
        }
      });
    });
}

function selectBorrower() {
  tt.chooseContact({
    multi: false,
    externalContact: false,
    success(res) {
      if (res.data && res.data.length > 0) {
        currentBorrower = { name: res.data[0].name, id: res.data[0].openId };
        $("#borrower-name").text(currentBorrower.name).removeClass("unselected");
      }
    }
  });
}

function startScan() {
  if (!currentBorrower) {
    alert("请先选择借用人！");
    return;
  }

  if (!window.tt || !window.tt.scanCode) {
    alert("扫码组件未就绪，请在飞书客户端中打开");
    return;
  }

  // 弹出扫码界面
  tt.scanCode({
    scanType: ['barCode', 'qrCode'],
    // 注意：H5 环境下 keepAlive 可能失效，我们靠下面的 success 回调实现连续
    success(res) {
      // 1. 处理本次扫码的数据
      // 我们把重新触发扫码的逻辑写在处理函数里
      processScanData(res.result);
    },
    fail(err) {
      // 当用户点击扫码界面的“返回”或“关闭”按钮时，会走到这里
      console.log("用户停止了扫码");
      renderList();
    }
  });
}

function processScanData(resultStr) {
  try {
    let cleanStr = resultStr.trim();
    if (cleanStr.endsWith('|')) cleanStr = cleanStr.slice(0, -1);
    const data = JSON.parse(cleanStr);

    const bNum = data.borrowedNum || "未知单号";
    const cNum = data.chartNum || "无图号";
    const oNum = data.orderNum || "无";

    if (!groupedData[bNum]) {
      groupedData[bNum] = { purpose: "", items: [] };
    }

    const isDuplicate = groupedData[bNum].items.some(it => it.chartNum === cNum);

    if (isDuplicate) {
      // 【注意】：如果遇到重复，confirm 会中断连续扫码，等待用户点击
      if (!confirm(`单号 ${bNum} 下已存在图号 ${cNum}，是否重复添加？`)) {
        // 如果点取消，依然继续下一次扫码
        setTimeout(startScan, 300);
        return;
      }
    }

    // 添加数据
    groupedData[bNum].items.push({ chartNum: cNum, orderNum: oNum });

    // 成功提示：改用非阻塞的 Toast
    tt.showToast({
      title: `录入成功: ${cNum}`,
      icon: 'success',
      duration: 1000 // 提示 1 秒
    });

    renderList();

    // 【核心改进】：处理完当前数据后，自动触发下一次扫码
    // 使用 setTimeout 是为了给用户一点点“视觉缓冲”，防止界面切换太生硬
    setTimeout(() => {
      startScan();
    }, 300);

  } catch (error) {
    console.error(error);
    tt.showToast({
      title: "二维码解析失败",
      icon: 'fail',
      duration: 1500
    });
    // 解析失败也继续下一次，除非用户手动点关闭
    setTimeout(startScan, 500);
  }
}

// 渲染列表：按单号分组展示
function renderList() {
  const $list = $("#record-list");
  $list.empty();
  const keys = Object.keys(groupedData);

  // 计算总件数
  const totalItems = keys.reduce((acc, k) => acc + groupedData[k].items.length, 0);
  $("#record-count").text(totalItems);

  if (keys.length === 0) {
    $list.append('<div class="empty-tip">暂无数据，请扫码录入</div>');
    $("#footer-area").addClass("hidden");
    return;
  }
  $("#footer-area").removeClass("hidden");

  keys.forEach(bNum => {
    const group = groupedData[bNum];

    // --- 【新增逻辑】：统计当前单号下各图号出现的次数 ---
    const chartCounts = {};
    group.items.forEach(it => {
      chartCounts[it.chartNum] = (chartCounts[it.chartNum] || 0) + 1;
    });
    // ----------------------------------------------

    const groupHtml = `
      <div class="group-card">
        <div class="group-header">
          <div class="group-title">单号：${bNum}</div>
          <div class="btn-row-del" style="font-weight:bold" onclick="deleteGroup('${bNum}')">删除整单</div>
        </div>
        
        <div class="purpose-wrapper">
          <div class="purpose-label">用途 <span style="color:#f54a45">*</span></div>
          <input type="text" class="purpose-input" placeholder="请输入此单图纸的用途" 
            value="${group.purpose}" 
            oninput="updatePurpose('${bNum}', this.value)">
        </div>

        <table class="item-table">
          ${group.items.map((item, idx) => {
            // 判断当前图号是否重复
            const isDup = chartCounts[item.chartNum] > 1;
            
            return `
            <tr class="item-row ${isDup ? 'is-duplicate' : ''}">
              <td class="item-cell">
                <div class="cell-chart">
                  ${item.chartNum}
                  ${isDup ? '<span class="duplicate-badge">重复</span>' : ''}
                </div>
                <div class="cell-order">工作令：${item.orderNum}</div>
              </td>
              <td class="item-cell btn-row-del" onclick="deleteItem('${bNum}', ${idx})">移除</td>
            </tr>
            `;
          }).join('')}
        </table>
      </div>
    `;
    $list.append(groupHtml);
  });
}

// 实时保存用途输入内容
function updatePurpose(bNum, val) {
  groupedData[bNum].purpose = val;
}

function deleteItem(bNum, idx) {
  groupedData[bNum].items.splice(idx, 1);
  if (groupedData[bNum].items.length === 0) delete groupedData[bNum];
  renderList();
}

function deleteGroup(bNum) {
  if (confirm(`确定删除单号 ${bNum} 下的所有记录吗？`)) {
    delete groupedData[bNum];
    renderList();
  }
}

function submitRecords() {
  const keys = Object.keys(groupedData);
  if (keys.length === 0) return;

  // 【必填校验】：检查每个单号是否都填了用途
  for (let bNum of keys) {
    if (!groupedData[bNum].purpose.trim()) {
      alert(`请填写单号【${bNum}】的用途！`);
      return;
    }
  }

  if (confirm(`确认提交这些图纸借给【${currentBorrower.name}】吗？`)) {
    const payload = {
      borrower: currentBorrower,
      operator: currentUser,
      data: groupedData
    };
    console.log("提交数据：", payload);

    alert("提交成功！");
    groupedData = {};
    currentBorrower = null;
    $("#borrower-name").text("请点击选择借用人").addClass("unselected");
    renderList();
  }
}