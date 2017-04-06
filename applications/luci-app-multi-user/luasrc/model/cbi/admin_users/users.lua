-- Copyright 2008 Steven Barth <steven@midlink.org>
-- Copyright 2008 Jo-Philipp Wich <jow@openwrt.org>
-- Licensed to the public under the Apache License 2.0.

m = Map("users", translate("Users"))
m.pageaction = false
m:section(SimpleSection).template = "admin_users/users_overview"

return m
