module("luci.controller.firewall", package.seeall)

function index()
	local fs = require "nixio.fs"

         function user(val)
	   if not fs.access("/usr/lib/lua/luci/users.lua") then return true end

           local dsp = require "luci.dispatcher"
           local usw = require "luci.users"
           local user = dsp.get_user()
	   if user == "root" then return true end
	   local name = "Network"

	   local menu = {}
	   menu = usw.hide_menus(user,name) or {}
	   if menu and #menu <= 1 then
            return false
           end
  	   for i,v in pairs(menu) do
   	     if v == val then return true end
  	   end
  	   return false
	  end

	if user("Firewall") == true then
	entry({"admin", "network", "firewall"},
		alias("admin", "network", "firewall", "zones"),
		_("Firewall"), 60)

	entry({"admin", "network", "firewall", "zones"},
		arcombine(cbi("firewall/zones"), cbi("firewall/zone-details")),
		_("General Settings"), 10).leaf = true

	entry({"admin", "network", "firewall", "forwards"},
		arcombine(cbi("firewall/forwards"), cbi("firewall/forward-details")),
		_("Port Forwards"), 20).leaf = true

	entry({"admin", "network", "firewall", "rules"},
		arcombine(cbi("firewall/rules"), cbi("firewall/rule-details")),
		_("Traffic Rules"), 30).leaf = true

	entry({"admin", "network", "firewall", "custom"},
		cbi("firewall/custom"),
		_("Custom Rules"), 40).leaf = true
	end
end
