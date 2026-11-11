local KeyValuePage = require("ui/widget/keyvaluepage")
local ConfirmBox = require("ui/widget/confirmbox")
local DataStorage = require("datastorage")
local InfoMessage = require("ui/widget/infomessage")
local InputDialog = require("ui/widget/inputdialog")
local LuaSettings = require("luasettings")
local NetworkMgr = require("ui/network/manager")
local UIManager = require("ui/uimanager")
local WidgetContainer = require("ui/widget/container/widgetcontainer")
local http = require("socket.http")
local https = require("ssl.https")
local json = require("json")
local logger = require("logger")
local ltn12 = require("ltn12")
local socketutil = require("socketutil")
local util = require("util")
local _ = require("gettext")

local Larder = WidgetContainer:extend{
    name = "larder",
    is_doc_only = false,
}

local SETTINGS_FILE = "larder.lua"
local CACHE_FILE = "larder.json"

function Larder:init()
    self.settings = LuaSettings:open(DataStorage:getSettingsDir() .. "/" .. SETTINGS_FILE)
    self.cache_file = DataStorage:getDataDir() .. "/" .. CACHE_FILE
    self.ui.menu:registerToMainMenu(self)
end

function Larder:addToMainMenu(menu_items)
    menu_items.larder_list = {
        text = _("Larder"),
        sorting_hint = "main",
        callback = function()
            self:openList()
        end,
    }
    menu_items.larder_settings = {
        text = _("Larder 设置"),
        sorting_hint = "more_tools",
        sub_item_table = {
            {
                text = _("服务器地址"),
                keep_menu_open = true,
                callback = function() self:editSetting("server", _("服务器地址"), "https://") end,
            },
            {
                text = _("密码"),
                keep_menu_open = true,
                callback = function() self:editSetting("password", _("密码"), "", true) end,
            },
        },
    }
end

function Larder:editSetting(key, title, hint, password)
    local dialog
    dialog = InputDialog:new{
        title = title,
        input = password and "" or (self.settings:readSetting(key) or hint),
        text_type = password and "password" or nil,
        input_hint = password and _("输入后会保存在这台 Kindle 上") or nil,
        buttons = {{
            {
                text = _("取消"),
                callback = function() UIManager:close(dialog) end,
            },
            {
                text = _("保存"),
                callback = function()
                    local value = util.trim(dialog:getInputText() or "")
                    self.settings:saveSetting(key, value ~= "" and value or nil)
                    self.settings:flush()
                    if key == "password" then self:clearToken() end
                    UIManager:close(dialog)
                end,
            },
        }},
    }
    UIManager:show(dialog)
    dialog:onShowKeyboard()
end

function Larder:openList()
    if not self.settings:readSetting("server") or not self.settings:readSetting("password") then
        self:showMessage(_("先在「Larder 设置」里填写服务器地址和密码。"))
        return
    end
    local function refresh()
        local payload, err = self:fetchItems()
        self:showList(payload, err)
    end
    if NetworkMgr:willRerunWhenOnline(refresh) then return end
    refresh()
end

function Larder:fetchItems()
    local cached = self:readCache()
    local ok, payload = self:request("GET", "/api/items")
    if ok then
        payload.cached = false
        payload.fetched_at = os.date("%Y-%m-%d %H:%M")
        self:writeCache(payload)
        return payload
    end
    if cached then
        cached.cached = true
        cached.warning = payload
        return cached
    end
    return nil, payload
end

function Larder:showList(payload, err)
    if not payload then
        self:showMessage(err or _("清单获取失败"))
        return
    end
    local items = self.due_only and self:dueWithin(payload.items or {}) or (payload.items or {})
    local pairs = {
        {
            self.due_only and _("查看全部") or _("7 天内到期"),
            "",
            callback = function()
                self.due_only = not self.due_only
                if self.page then UIManager:close(self.page) end
                self:showList(payload)
            end,
        },
    }
    if #items == 0 then
        table.insert(pairs, { self.due_only and _("这七天没有要到期的") or _("还是空的"), "" })
    end
    for _, item in ipairs(items) do
        local expiry = item.expires_on or _("无到期日")
        table.insert(pairs, {
            item.name,
            string.format("×%d  %s", item.quantity, expiry),
            callback = function() self:confirmRemove(item) end,
        })
    end
    local title = _("Larder")
    if payload.cached then
        title = string.format("%s · %s %s", title, _("离线缓存"), payload.fetched_at or "")
    end
    self.page = KeyValuePage:new{
        title = title,
        kv_pairs = pairs,
        return_button = true,
        value_align = "right",
    }
    UIManager:show(self.page)
end

function Larder:confirmRemove(item)
    UIManager:show(ConfirmBox:new{
        text = string.format("%s\n%s", item.name, _("用完了，从清单里去掉？")),
        ok_text = _("去掉"),
        ok_callback = function()
            if NetworkMgr:willRerunWhenOnline(function() self:removeItem(item) end) then return end
            self:removeItem(item)
        end,
    })
end

function Larder:removeItem(item)
    local ok, message = self:request("DELETE", "/api/items/" .. item.id)
    if not ok then
        self:showMessage(message or _("删除失败"))
        return
    end
    if self.page then UIManager:close(self.page) end
    self:openList()
end

function Larder:dueWithin(items)
    local today = os.date("%Y-%m-%d")
    local limit = os.date("%Y-%m-%d", os.time() + 7 * 86400)
    local matched = {}
    for _, item in ipairs(items) do
        local expiry = item.expires_on
        if expiry and expiry ~= "" and expiry >= today and expiry <= limit then
            table.insert(matched, item)
        end
    end
    return matched
end

function Larder:request(method, path, body)
    local server = self.settings:readSetting("server")
    if not server then return false, _("没有服务器地址") end
    local token = self.settings:readSetting("token")
    if not token then
        local logged_in, login_error = self:login()
        if not logged_in then return false, login_error end
        token = self.settings:readSetting("token")
    end

    local ok, status, response = self:http(method, server .. path, body, token)
    if status == 401 then
        self:clearToken()
        local logged_in, login_error = self:login()
        if not logged_in then return false, login_error end
        ok, status, response = self:http(method, server .. path, body, self.settings:readSetting("token"))
    end
    if not ok or status < 200 or status >= 300 then
        return false, response or _("网络请求失败")
    end
    return true, response
end

function Larder:login()
    local server = self.settings:readSetting("server")
    local password = self.settings:readSetting("password")
    local ok, status, response = self:http("POST", server .. "/api/login", { password = password })
    if not ok or status ~= 200 or not response or not response.token then
        return false, response or _("登录失败")
    end
    self.settings:saveSetting("token", response.token)
    self.settings:flush()
    return true
end

function Larder:http(method, url, body, token)
    local payload = body and json.encode(body) or nil
    local response = {}
    local headers = { ["accept"] = "application/json" }
    if payload then
        headers["content-type"] = "application/json"
        headers["content-length"] = tostring(#payload)
    end
    if token then headers["authorization"] = "Bearer " .. token end

    socketutil:set_timeout(5, 15)
    local client = url:match("^https://") and https or http
    local _, status = client.request{
        url = url,
        method = method,
        headers = headers,
        source = payload and ltn12.source.string(payload) or nil,
        sink = ltn12.sink.table(response),
    }
    socketutil:reset_timeout()

    local text = table.concat(response)
    local decoded = nil
    if text ~= "" then
        local parse_ok, parsed = pcall(json.decode, text)
        decoded = parse_ok and parsed or text
    end
    if type(decoded) == "table" and decoded.error then
        return false, status or 0, decoded.error
    end
    if not status then
        logger.dbg("Larder request failed", url)
        return false, 0, _("连不上服务器")
    end
    return true, status, decoded
end

function Larder:readCache()
    if not util.fileExists(self.cache_file) then return nil end
    local parse_ok, parsed = pcall(json.decode, util.readFromFile(self.cache_file) or "")
    if parse_ok and type(parsed) == "table" then return parsed end
    return nil
end

function Larder:writeCache(payload)
    util.writeToFile(json.encode({
        items = payload.items,
        fetched_at = payload.fetched_at,
    }), self.cache_file)
end

function Larder:clearToken()
    self.settings:delSetting("token")
    self.settings:flush()
end

function Larder:showMessage(text)
    UIManager:show(InfoMessage:new{ text = text, timeout = 3 })
end

return Larder
