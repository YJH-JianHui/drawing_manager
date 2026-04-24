$(document).ready(function () {
  // 导入页不需要扫码，鉴权仅为了让飞书 WebView 正常工作
  feishuAuth({ jsApiList: [] });
});

function handleFileChange(input) {
  const file = input.files[0];
  if (!file) return;
  uploadFileViaWeb(file);
}

function uploadFileViaWeb(file) {
  if (window.tt && tt.showToast) {
    tt.showToast({ title: '正在解析...', icon: 'loading', duration: 60000 });
  }

  const formData = new FormData();
  formData.append('file', file);
  formData.append('filename', file.name);

  fetch('/api/upload_excel', { method: 'POST', body: formData })
    .then(r => r.json())
    .then(data => {
      if (window.tt && tt.hideToast) tt.hideToast();
      if (data.code === 0) {
        if (window.tt && tt.showToast) {
          tt.showToast({ title: '导入成功', icon: 'success' });
        } else {
          alert("导入成功");
        }
        setTimeout(() => location.reload(), 1500);
      } else {
        alert("错误：" + data.msg);
      }
    })
    .catch(error => {
      if (window.tt && tt.hideToast) tt.hideToast();
      console.error("上传请求失败:", error);
      alert("网络异常，请检查后端服务");
    });
}
