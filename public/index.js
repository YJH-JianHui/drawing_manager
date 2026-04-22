let lang = window.navigator.language;

$("document").ready(apiAuth());

function apiAuth() {
  console.log("start apiAuth");
  if (!window.h5sdk) {
    console.log("invalid h5sdk");
    alert("please open in feishu");
    return;
  }

  // 调用config接口的当前网页url
  const url = encodeURIComponent(location.href.split("#")[0]);
  console.log("接入方前端将需要鉴权的url发给接入方服务端,url为:", url);
  // 向接入方服务端发起请求，获取鉴权参数（appId、timestamp、nonceStr、signature）
  fetch(`/get_config_parameters?url=${url}`)
    .then((response) =>
      response.json().then((res) => {
        console.log(
          "接入方服务端返回给接入方前端的结果(前端调用config接口的所需参数):", res
        );
        // 通过error接口处理API验证失败后的回调
        window.h5sdk.error((err) => {
          throw ("h5sdk error:", JSON.stringify(err));
        });
        // 调用config接口进行鉴权
        window.h5sdk.config({
          appId: res.appid,
          timestamp: res.timestamp,
          nonceStr: res.noncestr,
          signature: res.signature,
          jsApiList: [],
          //鉴权成功回调
          onSuccess: (res) => {
            console.log(`config success: ${JSON.stringify(res)}`);
          },
          //鉴权失败回调
          onFail: (err) => {
            throw `config failed: ${JSON.stringify(err)}`;
          },
        });
        // 完成鉴权后，便可在 window.h5sdk.ready 里调用 JSAPI
        window.h5sdk.ready(() => {
          // window.h5sdk.ready回调函数在环境准备就绪时触发
          // 调用 getUserInfo API 获取已登录用户的基本信息，详细文档参见https://open.feishu.cn/document/uYjL24iN/ucjMx4yNyEjL3ITM
          tt.getUserInfo({
            // getUserInfo API 调用成功回调
            success(res) {
              console.log(`getUserInfo success: ${JSON.stringify(res)}`);
              // 单独定义的函数showUser，用于将用户信息展示在前端页面上
              showUser(res.userInfo);
            },
            // getUserInfo API 调用失败回调
            fail(err) {
              console.log(`getUserInfo failed:`, JSON.stringify(err));
            },
          });
        });
      })
    )
    .catch(function (e) {
      console.error(e);
    });
}

function showUser(userInfo) {
  $("#user-avatar").attr("src", userInfo.avatarUrl);
  $("#user-name").text(userInfo.nickName);
  // 数据加载完毕后，取消隐藏用户卡片
  $("#user-info-card").removeClass("hidden");
}

// ====== 三个卡片的点击事件交互处理 ======

// 1. 处理“图纸借出”
function handleCheckout() {
  // 点击后不再直接扫码，而是跳转到借出专用页面
  window.location.href = "/checkout";
}

// 2. 处理“图纸归还”
function handleReturn() {
  if (window.tt && window.tt.scanCode) {
    tt.scanCode({
      scanType: ['barCode', 'qrCode'],
      success(res) {
        alert(`归还成功：识别到图纸编号\n${res.result}`);
        // TODO: 这里可以发请求给后端进行归还登记
      },
      fail(err) {
        console.error("扫码失败:", err);
      }
    });
  } else {
    alert("请在飞书客户端内打开以使用扫码功能！");
  }
}

// 3. 处理“统计分析”
function handleStats() {
  // TODO: 后续在这里做页面跳转
  alert("即将跳转到统计分析页面...");
  // window.location.href = "/statistics"; // 假设后端的路由
}

// 4. 处理“系统设置”
function handleSettings() {
  alert("即将进入系统设置...");
  // window.location.href = "/settings";
}
