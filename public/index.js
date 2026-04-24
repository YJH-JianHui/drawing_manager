let lang = window.navigator.language;

$(document).ready(function () {
  if (!window.h5sdk) {
    $("#loading-screen p").text("请在飞书客户端内打开").css("color", "#f54a45");
    $(".loader").hide();
    return;
  }

  feishuAuth({
    jsApiList: ['getUserInfo', 'filePicker'],
    onReady() {
      // 优先读缓存用户信息，避免重复握手
      const cached = feishuGetUser();
      if (cached) {
        showUser(cached);
        enterApp();
        return;
      }
      // 缓存没有时才调 getUserInfo
      tt.getUserInfo({
        success(res) {
          feishuSaveUser(res.userInfo);   // 写入缓存
          showUser(res.userInfo);
          enterApp();
        },
        fail(err) {
          $("#loading-screen p").text("获取用户信息失败");
          console.error(err);
        }
      });
    },
    onFail(err) {
      $("#loading-screen p").text("登录鉴权失败，请重试");
    }
  });
});

function showUser(userInfo) {
  $("#user-avatar").attr("src", userInfo.avatarUrl);
  $("#user-name").text(userInfo.nickName);
}

function enterApp() {
  $("#loading-screen").css("opacity", "0");
  setTimeout(() => {
    $("#loading-screen").addClass("hidden");
    $("#main-app").removeClass("hidden").addClass("fade-in");
  }, 500);
}

function handleCheckout() { window.location.href = "/checkout"; }
function handleQuery()    { window.location.href = "/query"; }
function handleImport()   { window.location.href = "/import"; }

function handleReturn() {
  if (window.tt && window.tt.scanCode) {
    tt.scanCode({
      scanType: ['barCode', 'qrCode'],
      success(res) { alert(`归还成功：识别到图纸编号\n${res.result}`); },
      fail(err)    { console.error("扫码失败:", err); }
    });
  } else {
    alert("请在飞书客户端内打开以使用扫码功能！");
  }
}

function handleStats()    { alert("即将跳转到统计分析页面..."); }
function handleSettings() { alert("即将进入系统设置..."); }
