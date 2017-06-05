-- Copyright 2008 Steven Barth <steven@midlink.org>
-- Copyright 2010-2015 Jo-Philipp Wich <jow@openwrt.org>
-- Licensed to the public under the Apache License 2.0.

local utl = require "luci.util"

m = Map("users", arg[1]:upper(), translate("User Configuration Options"))

local fs = require "nixio.fs"
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

o = s:option(Flag, "Status_menus", translate("Enable Status Menu"))
o.rmempty = true
o.disabled = "disabled" 
o.enabled = "Status_menus"

status_subs = s:option(MultiValue, "Status_subs")
status_subs.rmempty = true
status_subs:depends("Status_menus", "Status_menus")
--status_subs:value("Overview", "Overview")
status_subs:value("Firewall", "Firewall")
status_subs:value("Routes", "Routes")
status_subs:value("System_log", "System Log") 
status_subs:value("Kernel_log", "Kernel Log")
status_subs:value("Processes", "Processes")
status_subs:value("Realtime_graphs", "Realtime Graphs")

o = s:option(Flag, "System_menus", translate("Enable System Menu"))
o.rmempty = true 
o.disabled = "disabled" 
o.enabled = "System_menus"

system_subs = s:option(MultiValue, "System_subs")
system_subs.rmempty = true
system_subs:depends("System_menus", "System_menus")
system_subs:value("System", "System")
--system_subs:value("Administration", "Administration")
system_subs:value("Software", "Software")
system_subs:value("Startup", "Startup")
system_subs:value("Scheduled_tasks", "Scheduled Tasks")
system_subs:value("Leds", "LED Configuration")
system_subs:value("Firmware", "Backup / Flash Firmware")
system_subs:value("Reboot", "Reboot")

o = s:option(Flag, "Network_menus", translate("Enable Network Menu"))
o.rmempty = true 
o.disabled = "disabled" 
o.enabled = "Network_menus"

network_subs = s:option(MultiValue, "Network_subs")
network_subs.rmempty = true
network_subs:depends("Network_menus", "Network_menus")
network_subs:value("Interfaces", "Interfaces")
network_subs:value("Wifi", "Wifi")
network_subs:value("Switch", "Switch")
network_subs:value("Dhcp", "DHCP and DNS")
network_subs:value("Firewall", "Firewall")
network_subs:value("Diagnostics", "Diagnostics")

m.redirect = luci.dispatcher.build_url("admin/users/users")

return m
