$(document).ready(() => {
  feishuAuth({ jsApiList: ['scanCode'] });
});

function startQueryScan() {
  tt.scanCode({
    success(res) {
      let cleanStr = res.result.trim();
      if (cleanStr.endsWith('|')) cleanStr = cleanStr.slice(0, -1);
      try {
        const data = JSON.parse(cleanStr);
        $("#search-input").val(data.chartNum);
        executeSearch(data.chartNum);
      } catch (e) {
        $("#search-input").val(res.result);
        executeSearch(res.result);
      }
    }
  });
}

function executeSearch(keyword) {
  const val = keyword || $("#search-input").val().trim();
  if (!val) return;

  if (window.tt && tt.showToast) tt.showToast({ title: '查询中...', icon: 'loading' });

  setTimeout(() => {
    renderQueryResult({
      chartNum:    val,
      borrowedNum: "YZ0_38_964633",
      status:      Math.random() > 0.5 ? "IN" : "OUT",
      borrower:    "张三 (研发部)",
      purpose:     "项目A样机装配",
      lastUpdate:  "2023-10-27 14:30"
    });
  }, 500);
}

function renderQueryResult(data) {
  const $area = $("#result-area");
  $area.empty();
  const statusClass = data.status === "IN" ? "status-in" : "status-out";
  const statusText  = data.status === "IN" ? "在库" : "借出中";
  $area.append(`
    <div class="detail-card">
      <span class="status-tag ${statusClass}">${statusText}</span>
      <div class="info-item"><div class="info-label">图纸编号</div><div class="info-value">${data.chartNum}</div></div>
      <div class="info-item"><div class="info-label">当前借用单号</div><div class="info-value">${data.borrowedNum}</div></div>
      ${data.status === 'OUT' ? `
      <div class="info-item"><div class="info-label">当前借用人</div><div class="info-value">${data.borrower}</div></div>
      <div class="info-item"><div class="info-label">借用用途</div><div class="info-value">${data.purpose}</div></div>` : ''}
      <div class="info-item"><div class="info-label">最后更新时间</div><div class="info-value">${data.lastUpdate}</div></div>
      <div class="history-title">最近流转记录</div>
      <div style="font-size:12px;color:#8f959e;margin-top:10px;">
        • 2023-10-20: 由 李四 归还至 A1架<br>• 2023-10-15: 由 王五 借出 (工装制造)
      </div>
    </div>`);
}
