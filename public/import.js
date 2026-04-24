// 导入页：不调用 feishuAuth（无需任何 JSAPI），用页面内 UI 显示提示
$(document).ready(function () {
    // 无需鉴权
});

function handleFileChange(input) {
    const file = input.files[0];
    if (!file) return;
    // 选完文件后清空 input，避免同名文件第二次选不触发 change
    input.value = "";
    uploadFileViaWeb(file);
}

function uploadFileViaWeb(file) {
    showResult("loading", "正在解析，请稍候...");

    const formData = new FormData();
    formData.append('file', file);
    formData.append('filename', file.name);

    fetch('/api/upload_excel', { method: 'POST', body: formData })
        .then(r => r.json())
        .then(data => {
            if (data.code === 0) {
                showResult("success", data.msg || "导入成功！");
            } else {
                showResult("error", data.msg || "导入失败，请重试");
            }
        })
        .catch(err => {
            console.error("上传请求失败:", err);
            showResult("error", "网络异常，请检查后端服务后重试");
        });
}

/**
 * 在页面内显示结果提示
 * @param {"loading"|"success"|"error"} type
 * @param {string} msg
 */
function showResult(type, msg) {
    const $box = $("#result-box");
    $box.removeClass("hidden result-success result-error result-loading");

    if (type === "loading") {
        $box.addClass("result-loading");
        $box.html(`<span class="result-icon">⏳</span><span class="result-msg">${msg}</span>`);
    } else if (type === "success") {
        $box.addClass("result-success");
        $box.html(`<span class="result-icon">✅</span><span class="result-msg">${msg}</span>`);
    } else {
        $box.addClass("result-error");
        $box.html(`<span class="result-icon">❌</span><span class="result-msg">${msg}</span>`);
    }
}
