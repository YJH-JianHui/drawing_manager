let currentUser = "获取中..."; // 当前操作人（拿手机扫码的人）
let currentBorrower = null;    // 当前借用人（所选中的人）
let scannedRecords =[];       // 存储扫码数据的数组

$(document).ready(function () {
  apiAuth();
});

// ==== 飞书鉴权与用户信息获取 ====
function apiAuth() {
  if (!window.h5sdk) {
    alert("请在飞书内打开");
    return;
  }
  const url = encodeURIComponent(location.href.split("#")[0]);
  fetch(`/get_config_parameters?url=${url}`)
    .then((response) => response.json())
    .then((res) => {
      window.h5sdk.error((err) => { console.error("h5sdk error:", err); });
      window.h5sdk.config({
        appId: res.appid,
        timestamp: res.timestamp,
        nonceStr: res.noncestr,
        signature: res.signature,
        jsApiList:['scanCode', 'chooseContact', 'getUserInfo'],
        onSuccess: (res) => { console.log("鉴权成功"); }
      });
      window.h5sdk.ready(() => {
        tt.getUserInfo({
          success(infoRes) {
            currentUser = infoRes.userInfo.nickName;
            console.log("当前操作人:", currentUser);
          }
        });
      });
    });
}

// ==== 1. 选择借用人逻辑 ====
function selectBorrower() {
  if (!window.tt || !window.tt.chooseContact) {
    alert("请在飞书客户端内打开以使用选人功能！");
    return;
  }

  tt.chooseContact({
    multi: false,
    ignore: false,
    externalContact: false,
    enableChooseDepartment: false,
    success(res) {
      if (res.data && res.data.length > 0) {
        const user = res.data[0];
        currentBorrower = {
          name: user.name,
          id: user.openId
        };
        // 将选中的名字更新到页面上，并移除未选择的灰色样式
        $("#borrower-name").text(currentBorrower.name).removeClass("unselected");
      }
    },
    fail(err) {
      console.log("选人取消或失败:", err);
    }
  });
}

// ==== 2. 扫码逻辑 ====
function startScan() {
  // 【关键】：校验是否已选择借用人
  if (!currentBorrower) {
    alert("请先在上方选择【借用人】后再进行扫码！");
    return;
  }

  if (!window.tt || !window.tt.scanCode) {
    alert("扫码组件未就绪，请在飞书客户端中打开");
    return;
  }

  tt.scanCode({
    scanType:['barCode', 'qrCode'],
    success(res) {
      processScanData(res.result);
    },
    fail(err) {
      console.log("取消扫码或扫码失败", err);
    }
  });
}

// ==== 3. 解析扫码数据并查重 ====
function processScanData(resultStr) {
  try {
    let cleanStr = resultStr.trim();
    if (cleanStr.endsWith('|')) {
      cleanStr = cleanStr.slice(0, -1);
    }

    const data = JSON.parse(cleanStr);

    const newRecord = {
      borrowedNum: data.borrowedNum || "无",
      chartNum: data.chartNum || "无",
      orderNum: data.orderNum || "无",
      operator: currentUser
    };

    const isDuplicate = scannedRecords.some(
      (record) => record.borrowedNum === newRecord.borrowedNum && record.chartNum === newRecord.chartNum
    );

    if (isDuplicate) {
      const confirmAdd = confirm(`借用单号: ${newRecord.borrowedNum}\n图号: ${newRecord.chartNum}\n已存在，是否确认重复录入？`);
      if (!confirmAdd) {
        return;
      }
    }

    scannedRecords.push(newRecord);
    renderList();

  } catch (error) {
    console.error("JSON解析错误:", error);
    alert("无法解析该二维码内容！\n内容：" + resultStr);
  }
}

// ==== 4. 渲染列表到页面 ====
function renderList() {
  const $list = $("#record-list");
  $list.empty();
  $("#record-count").text(scannedRecords.length);

  if (scannedRecords.length === 0) {
    $list.append('<div class="empty-tip" id="empty-tip">暂无数据，请点击上方按钮扫码</div>');
    $("#footer-area").addClass("hidden");
    return;
  }

  $("#footer-area").removeClass("hidden");

  scannedRecords.forEach((record, index) => {
    const cardHtml = `
      <div class="record-card">
        <div class="btn-delete" onclick="deleteRecord(${index})">删除</div>
        <div class="record-row"><div class="record-label">借用单号:</div><div class="record-value">${record.borrowedNum}</div></div>
        <div class="record-row"><div class="record-label">图 号:</div><div class="record-value">${record.chartNum}</div></div>
        <div class="record-row"><div class="record-label">工作令号:</div><div class="record-value">${record.orderNum}</div></div>
        <div class="record-row"><div class="record-label">操 作 人:</div><div class="record-value">${record.operator}</div></div>
      </div>
    `;
    $list.append(cardHtml);
  });
}

// ==== 5. 删除指定记录 ====
function deleteRecord(index) {
  scannedRecords.splice(index, 1);
  renderList();
}

// ==== 6. 提交数据逻辑 ====
function submitRecords() {
  if (scannedRecords.length === 0) return;
  if (!currentBorrower) {
    alert("借用人信息丢失，请重新选择！");
    return;
  }

  if (confirm(`确认将这 ${scannedRecords.length} 份图纸借给【${currentBorrower.name}】吗？`)) {

    // 打包最终要传给后端的数据
    const payload = {
      borrowerName: currentBorrower.name,
      borrowerId: currentBorrower.id,
      operator: currentUser,
      records: scannedRecords
    };

    console.log("准备发送给后端的数据:", JSON.stringify(payload));

    // ======== 前端模拟提交成功交互 ========
    alert(`提交成功！\n图纸已成功登记借给：${currentBorrower.name}`);

    // 提交成功后，重置数据和页面状态，准备下一批次扫描
    scannedRecords = [];         // 清空扫描记录数组
    currentBorrower = null;      // 重置借用人对象

    // 恢复界面显示状态
    $("#borrower-name").text("请点击选择借用人").addClass("unselected");
    renderList(); // 重新渲染列表（此时会显示“暂无数据”并隐藏提交按钮）

    /*
    // 后期对接真实后端 API 示例：
    fetch('/api/submit_checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    .then(res => res.json())
    .then(data => {
       alert("后台存储成功！");
       // 执行清空逻辑...
    });
    */
  }
}