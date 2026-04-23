$(document).ready(() => { apiAuth(); });

function apiAuth() {
  const url = encodeURIComponent(location.href.split("#")[0]);
  fetch(`/get_config_parameters?url=${url}`).then(r => r.json()).then(res => {
    window.h5sdk.config({
      appId: res.appid, timestamp: res.timestamp, nonceStr: res.noncestr, signature: res.signature,
      jsApiList: ['scanCode'],
      onSuccess: () => { console.log("查询页面鉴权成功"); }
    });
  });
}

function startQueryScan() {
  tt.scanCode({
    success(res) {
      let cleanStr = res.result.trim();
      if (cleanStr.endsWith('|')) cleanStr = cleanStr.slice(0, -1);
      try {
        const data = JSON.parse(cleanStr);
        $("#search-input").val(data.chartNum); // 扫码后自动填入图号并搜索
        executeSearch(data.chartNum);
      } catch(e) {
        $("#search-input").val(res.result);
        executeSearch(res.result);
      }
    }
  });
}

function executeSearch(keyword) {
  const val = keyword || $("#search-input").val().trim();
  if (!val) return;

  // 模拟搜索反馈
  tt.showToast({ title: '查询中...', icon: 'loading' });

  // 此处模拟后端返回的查询结果
  setTimeout(() => {
    renderQueryResult({
      chartNum: val,
      borrowedNum: "YZ0_38_964633",
      status: Math.random() > 0.5 ? "IN" : "OUT", // 随机模拟状态
      borrower: "张三 (研发部)",
      purpose: "项目A样机装配",
      lastUpdate: "2023-10-27 14:30"
    });
  }, 500);
}

function renderQueryResult(data) {
  const $area = $("#result-area");
  $area.empty();

  const statusClass = data.status === "IN" ? "status-in" : "status-out";
  const statusText = data.status === "IN" ? "在库" : "借出中";

  const html = `
    <div class="detail-card">
      <span class="status-tag ${statusClass}">${statusText}</span>
      <div class="info-item">
        <div class="info-label">图纸编号</div>
        <div class="info-value">${data.chartNum}</div>
      </div>
      <div class="info-item">
        <div class="info-label">当前借用单号</div>
        <div class="info-value">${data.borrowedNum}</div>
      </div>
      ${data.status === 'OUT' ? `
      <div class="info-item">
        <div class="info-label">当前借用人</div>
        <div class="info-value">${data.borrower}</div>
      </div>
      <div class="info-item">
        <div class="info-label">借用用途</div>
        <div class="info-value">${data.purpose}</div>
      </div>
      ` : ''}
      <div class="info-item">
        <div class="info-label">最后更新时间</div>
        <div class="info-value">${data.lastUpdate}</div>
      </div>
      
      <div class="history-title">最近流转记录</div>
      <div style="font-size: 12px; color: #8f959e; margin-top:10px;">
        • 2023-10-20: 由 李四 归还至 A1架<br>
        • 2023-10-15: 由 王五 借出 (工装制造)
      </div>
    </div>
  `;
  $area.append(html);
}