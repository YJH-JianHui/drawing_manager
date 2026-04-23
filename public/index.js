let lang = window.navigator.language;

$("document").ready(apiAuth());

function apiAuth() {
  if (!window.h5sdk) {
    // 如果不在飞书内，显示错误提示并停止
    $("#loading-screen p").text("请在飞书客户端内打开").css("color", "#f54a45");
    $(".loader").hide();
    return;
  }

  const url = encodeURIComponent(location.href.split("#")[0]);

  fetch(`/get_config_parameters?url=${url}`)
    .then((response) => response.json())
    .then((res) => {
      window.h5sdk.config({
        appId: res.appid,
        timestamp: res.timestamp,
        nonceStr: res.noncestr,
        signature: res.signature,
        jsApiList: ['getUserInfo'],
        onSuccess: (res) => {
          console.log("鉴权成功");
        },
        onFail: (err) => {
          $("#loading-screen p").text("登录鉴权失败，请重试");
        }
      });

      window.h5sdk.ready(() => {
        tt.getUserInfo({
          success(res) {
            console.log("登录成功");
            // 1. 填充用户信息
            showUser(res.userInfo);

            // 2. 隐藏加载屏，显示主程序
            enterApp();
          },
          fail(err) {
            $("#loading-screen p").text("获取用户信息失败");
            console.error(err);
          },
        });
      });
    })
    .catch((e) => {
      $("#loading-screen p").text("网络连接异常");
    });
}

function showUser(userInfo) {
  $("#user-avatar").attr("src", userInfo.avatarUrl);
  $("#user-name").text(userInfo.nickName);
}

// 核心控制函数：进入应用
function enterApp() {
  // 1. 先淡出加载层
  $("#loading-screen").css("opacity", "0");

  setTimeout(() => {
    // 2. 彻底移除加载层
    $("#loading-screen").addClass("hidden");

    // 3. 显示主模块并添加一个舒适的渐显动画
    $("#main-app").removeClass("hidden").addClass("fade-in");
  }, 500); // 等待淡出动画完成
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

function handleQuery() {
  window.location.href = "/query";
}
