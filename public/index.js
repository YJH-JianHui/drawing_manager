$(document).ready(function () {
    if (!window.h5sdk) {
        $("#loading-screen p").text("请在飞书客户端内打开").css("color", "#f54a45");
        $(".loader").hide();
        return;
    }

    // ✅ 修复：有缓存用户时，先立即渲染用户信息 + 进入 App，
    // 再在后台静默完成 h5sdk.config（为了后续 JSAPI 可用）。
    // 这样从导入页返回时不会出现白屏转圈。
    const cached = feishuGetUser();
    if (cached) {
        showUser(cached);
        enterApp();
        // 后台静默鉴权（保证 JSAPI 可用，但不阻塞 UI）
        feishuAuth({ jsApiList: ['getUserInfo', 'filePicker'] });
        return;
    }

    // 无缓存：走完整鉴权流程（首次打开）
    feishuAuth({
        jsApiList: ['getUserInfo', 'filePicker'],
        onReady() {
            tt.getUserInfo({
                success(res) {
                    feishuSaveUser(res.userInfo);
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
    }, 300); // ✅ 从 500ms 缩短到 300ms，有缓存时几乎感知不到
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
function handleSettings() { window.location.href = "/settings"; }
