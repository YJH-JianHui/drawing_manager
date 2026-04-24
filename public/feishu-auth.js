/**
 * feishu-auth.js  ── 飞书 JSAPI 鉴权公共模块
 *
 * 解决的问题：
 *   1. ticket/token 在后端缓存（auth.py），签名请求几乎瞬间返回
 *   2. 用户信息（nickName/avatarUrl/openId）缓存在 sessionStorage，
 *      子页面不再重复调 tt.getUserInfo（每次调用都有一次异步握手耗时）
 *
 * 使用方式：
 *   所有页面在 <head> 里引入本文件，然后调用：
 *
 *   feishuAuth({
 *     jsApiList: ['scanCode'],
 *     onReady() { ... }          // h5sdk.ready 后执行
 *   });
 *
 *   首页额外调用（拿到 userInfo 后）：
 *   feishuSaveUser(res.userInfo);
 *
 *   其他页面读缓存用户：
 *   const user = feishuGetUser();  // 可能为 null（首次或缓存过期）
 */

const FS_USER_KEY  = 'FS_USER_INFO';
const USER_TTL_MS  = 8 * 60 * 60 * 1000;  // 8 小时（一个工作日）

function _readUser() {
  try {
    const raw = sessionStorage.getItem(FS_USER_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (Date.now() - (obj._cachedAt || 0) > USER_TTL_MS) {
      sessionStorage.removeItem(FS_USER_KEY);
      return null;
    }
    return obj;
  } catch (e) { return null; }
}

window.feishuSaveUser = function(userInfo) {
  try {
    sessionStorage.setItem(FS_USER_KEY, JSON.stringify({
      ...userInfo,
      _cachedAt: Date.now()
    }));
  } catch (e) {}
};

window.feishuGetUser = function() {
  return _readUser();
};

/**
 * 执行 h5sdk.config 鉴权
 * 后端 ticket 已缓存，每次请求仅做签名运算（无外网调用），速度很快
 */
window.feishuAuth = function({ jsApiList = [], onReady, onFail } = {}) {
  if (!window.h5sdk) {
    console.warn('feishuAuth: 非飞书环境，跳过鉴权');
    onFail && onFail(new Error('非飞书环境'));
    return;
  }

  const url = encodeURIComponent(location.href.split('#')[0]);
  fetch(`/get_config_parameters?url=${url}`)
    .then(r => r.json())
    .then(params => {
      window.h5sdk.config({
        appId:     params.appid,
        timestamp: params.timestamp,
        nonceStr:  params.noncestr,
        signature: params.signature,
        jsApiList,
        onSuccess() {
          window.h5sdk.ready(() => { onReady && onReady(); });
        },
        onFail(err) {
          console.error('h5sdk.config 失败', err);
          onFail && onFail(err);
        }
      });
    })
    .catch(err => {
      console.error('获取鉴权参数失败', err);
      onFail && onFail(err);
    });
};
