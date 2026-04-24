import requests
import logging
import time

TENANT_ACCESS_TOKEN_URI = "/open-apis/auth/v3/tenant_access_token/internal"
JSAPI_TICKET_URI        = "/open-apis/jssdk/ticket/get"

class Auth(object):
    def __init__(self, feishu_host, app_id, app_secret):
        self.feishu_host         = feishu_host
        self.app_id              = app_id
        self.app_secret          = app_secret
        self.tenant_access_token = ""
        self._token_expire_at    = 0   # epoch seconds

        self._ticket             = ""
        self._ticket_expire_at   = 0   # epoch seconds

    # ── jsapi ticket（带缓存，提前 5 分钟刷新）────────────────────────────
    def get_ticket(self):
        now = time.time()
        if self._ticket and now < self._ticket_expire_at - 300:
            return self._ticket          # 缓存命中，直接返回

        self._refresh_token_if_needed()
        url     = "{}{}".format(self.feishu_host, JSAPI_TICKET_URI)
        headers = {
            "Authorization": "Bearer " + self.tenant_access_token,
            "Content-Type":  "application/json",
        }
        resp = requests.post(url=url, headers=headers, timeout=8)
        Auth._check_error_response(resp)
        data = resp.json().get("data", {})
        self._ticket           = data.get("ticket", "")
        # 飞书文档：ticket 有效期 7200 秒
        self._ticket_expire_at = now + data.get("expire_in", 7200)
        return self._ticket

    # ── tenant_access_token（带缓存）──────────────────────────────────────
    def _refresh_token_if_needed(self):
        now = time.time()
        if self.tenant_access_token and now < self._token_expire_at - 300:
            return                       # 未过期，直接复用

        url      = "{}{}".format(self.feishu_host, TENANT_ACCESS_TOKEN_URI)
        req_body = {"app_id": self.app_id, "app_secret": self.app_secret}
        response = requests.post(url, req_body, timeout=8)
        Auth._check_error_response(response)
        body = response.json()
        self.tenant_access_token = body.get("tenant_access_token", "")
        # 飞书文档：token 有效期字段为 expire（秒）
        self._token_expire_at    = now + body.get("expire", 7200)

    # 保留旧接口名兼容 server.py 调用
    def authorize_tenant_access_token(self):
        self._refresh_token_if_needed()

    @staticmethod
    def _check_error_response(resp):
        if resp.status_code != 200:
            raise resp.raise_for_status()
        response_dict = resp.json()
        code = response_dict.get("code", -1)
        if code != 0:
            logging.error(response_dict)
            raise FeishuException(code=code, msg=response_dict.get("msg"))


class FeishuException(Exception):
    def __init__(self, code=0, msg=None):
        self.code = code
        self.msg  = msg

    def __str__(self):
        return "{}:{}".format(self.code, self.msg)

    __repr__ = __str__
