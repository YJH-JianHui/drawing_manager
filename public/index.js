$(document).ready(function () {
    if (!window.h5sdk) {
        $("#loading-screen p").text("请在飞书客户端内打开").css("color", "#f54a45");
        $(".loader").hide();
        return;
    }

    const cached = feishuGetUser();
    // 增加对 openId 的校验，防止拿到了旧缓存的假数据
    if (cached && cached.openId) {
        showUser(cached);
        enterApp();
        // 后台静默鉴权
        feishuAuth({ jsApiList:['filePicker'] });
        return;
    }

    // 无有效缓存：走完整鉴权 -> 请求 AuthCode -> 后端验证流程
    feishuAuth({
        jsApiList: ['filePicker'],
        onReady() {
            // 核心改变：调用免登接口
            tt.requestAuthCode({
                appId: window.FEISHU_APP_ID,
                success(res) {
                    $("#loading-screen p").text("获取授权成功，正在安全登录...");

                    // 将 code 发给后端换取用户信息
                    fetch('/api/login', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ code: res.code })
                    })
                    .then(r => r.json())
                    .then(loginRes => {
                        if (loginRes.code === 0) {
                            // 这里拿到的就是后端解析的、绝对安全的 openId 和姓名
                            feishuSaveUser(loginRes.data);
                            showUser(loginRes.data);
                            enterApp();
                        } else {
                            $("#loading-screen p").text("登录失败：" + loginRes.msg).css("color", "#f54a45");
                            $(".loader").hide();
                        }
                    })
                    .catch(err => {
                        $("#loading-screen p").text("网络异常，登录中断").css("color", "#f54a45");
                        $(".loader").hide();
                    });
                },
                fail(err) {
                    $("#loading-screen p").text("获取免登授权码失败").css("color", "#f54a45");
                    $(".loader").hide();
                    console.error("requestAuthCode 失败:", err);
                }
            });
        },
        onFail(err) {
            $("#loading-screen p").text("飞书环境鉴权失败，请重试").css("color", "#f54a45");
            $(".loader").hide();
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
    }, 300);
}

function handleCheckout() { window.location.href = "/checkout"; }
function handleQuery()    { window.location.href = "/query"; }
function handleImport()   { window.location.href = "/import"; }

function handleReturn() {
    window.location.href = "/return";
}

function handleStats()    { alert("即将跳转到统计分析页面..."); }
function handleSettings() { window.location.href = "/settings"; }
