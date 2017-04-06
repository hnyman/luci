-- Copyright 2008 Steven Barth <steven@midlink.org>
-- Copyright 2010-2015 Jo-Philipp Wich <jow@openwrt.org>
-- Licensed to the public under the Apache License 2.0.

local utl = require "luci.util"
local dsp = require "luci.dispatcher"

m = Map("users", arg[1]:upper(), translate("User Configuration Options"))

local fs = require "nixio.fs"
local menu = dsp.load_menus()
local groups = {"users", "admin", "other"}
local usw = require "luci.users"
require "uci"
local uci = uci.cursor()
local s,o

m.on_after_commit = function()
  usw.edit_user(arg[1])			
end

s = m:section(NamedSection, arg[1], "user")
s.addremove = false


function firstToUpper(str)
    return (str:gsub("^%l", string.upper))
end

function s.parse(self, ...)
  NamedSection.parse(self, ...)
end

o = s:option(ListValue, "group", translate("User Group"))
for k, v in ipairs(groups) do
	o:value(v)
end

o = s:option(ListValue, "shell", translate("SSH Access"))
o.rmempty = false
o:value("Enabled", "Enabled")
o:value("Disabled", "Disabled")
o.default = "Enabled"

network_menu = s:option(Flag, "network_menus", translate("Enable Network Menus"))
network_menu.rmempty = true 
network_menu.disabled = "disabled" 
network_menu.enabled = "Network_menus"

network_subs = s:option(MultiValue, "network_subs")
network_subs.rmempty = true
network_subs:depends("network_menus", "Network_menus")
network_subs:value("Interfaces", "Interfaces")
network_subs:value("Wifi", "Wifi")
network_subs:value("Switch", "Switch")
network_subs:value("Dhcp", "DHCP and DNS")
network_subs:value("Firewall", "Firewall")
network_subs:value("Diagnostics", "Diagnostics")

for i,v in pairs(menu) do
  o = s:option(Flag, i.."_menus", translate("Enable ".. firstToUpper(i).." Menus"))
  o.disabled = "disabled" 
  o.enabled = i:gsub("^%l", string.upper).."_menus"
  new = s:option(MultiValue, i.."_subs")
  for j,k in ipairs(v) do
    new:depends(i.."_menus", i:gsub("^%l", string.upper).."_menus")
   if k ~= "Status" and k ~= "Overview" and k ~= "Services" then
     new:value(k)
   end
  end
end

m.redirect = luci.dispatcher.build_url("admin/users/users")

return m
