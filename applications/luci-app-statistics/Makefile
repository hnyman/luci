#
# Copyright (C) 2008-2014 The LuCI Team <luci@lists.subsignal.org>
#
# This is free software, licensed under the Apache License, Version 2.0 .
#

include $(TOPDIR)/rules.mk

LUCI_TITLE:=LuCI Statistics Application

PKG_CONFIG_DEPENDS:= \
	LUCI_NEW_RRDTOOL \
	LUCI_OLD_RRDTOOL

LUCI_DEPENDS:= \
	+luci-base \
	+collectd \
	+LUCI_OLD_RRDTOOL:rrdtool1 \
	+LUCI_NEW_RRDTOOL:rrdtool \
	+collectd-mod-rrdtool \
	+collectd-mod-iwinfo \
	+collectd-mod-cpu \
	+collectd-mod-memory \
	+collectd-mod-interface \
	+collectd-mod-load \
	+collectd-mod-network

define Package/luci-app-statistics/config
    choice
      prompt "RRDtool version"
	depends on PACKAGE_luci-app-statistics
	default LUCI_OLD_RRDTOOL

	config LUCI_NEW_RRDTOOL
		bool "New RRDtool 1.8+, enhanced graphics"

	config LUCI_OLD_RRDTOOL
		bool "Default RRDtool 1.0.50, small size"
    endchoice

endef

define Package/luci-app-statistics/conffiles
/etc/config/luci_statistics
endef

include ../../luci.mk

# call BuildPackage - OpenWrt buildroot signature
