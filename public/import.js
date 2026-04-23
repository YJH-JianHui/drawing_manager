$(document).ready(function () {
  // H5 导入页面其实不需要进行 JSAPI 鉴权就能上传文件
  // 但如果你后续要用扫码，可以保留鉴权
  apiAuth();
});

function apiAuth() {
  if (!window.h5sdk) return;
  const url = location.href.split("#")[0];
  fetch(`/get_config_parameters?url=${url}`)
    .then(r => r.json())
    .then(res => {
      window.h5sdk.config({
        appId: res.appid, timestamp: res.timestamp, nonceStr: res.noncestr, signature: res.signature,
        jsApiList: ['scanCode'], // 导入页如果不需要扫码，这里可以为空
        onSuccess: () => { console.log("页面鉴权成功"); }
      });
    });
}

// 当用户选好文件后触发
function handleFileChange(input) {
  const file = input.files[0];
  if (!file) return;

  console.log("已选择文件:", file.name, "大小:", file.size);

  // 开始上传
  uploadFileViaWeb(file);
}

// 使用 Web 标准方式上传
function uploadFileViaWeb(file) {
  // 1. 显示加载中
  if (window.tt && tt.showToast) {
    tt.showToast({ title: '正在解析...', icon: 'loading', duration: 60000 });
  }

  const formData = new FormData();
  formData.append('file', file);
  formData.append('filename', file.name);

  fetch('/api/upload_excel', {
    method: 'POST',
    body: formData,
  })
  .then(response => response.json())
  .then(data => {
    // 【关键】：收到响应后立刻隐藏加载圈
    if (window.tt && tt.hideToast) tt.hideToast();

    if (data.code === 0) {
      // 成功提示
      if (window.tt && tt.showToast) {
         tt.showToast({ title: '导入成功', icon: 'success' });
      } else {
         alert("导入成功");
      }
      // 稍微延迟一下刷新，让用户看到“成功”的勾
      setTimeout(() => { location.reload(); }, 1500);
    } else {
      alert("错误：" + data.msg);
    }
  })
  .catch(error => {
    // 【关键】：网络失败也要隐藏加载圈
    if (window.tt && tt.hideToast) tt.hideToast();
    console.error("上传请求失败:", error);
    alert("网络异常，请检查后端服务");
  });
}