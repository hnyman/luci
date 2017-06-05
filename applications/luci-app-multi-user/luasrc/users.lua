-- luci/openwrt multi user implementation V2 --
-- users.lua by Hostle 01/13/2016 --

module("luci.users", package.seeall)

--## General dependents ##--
require "luci.sys"
require("uci")

--## Add/Remove User files and dependants ##--
local fs = require "nixio.fs"
local util = require ("luci.util")
local uci = uci.cursor()
local passwd = "/etc/passwd"
local passwd2 = "/etc/passwd-"
local shadow = "/etc/shadow"
local shadow2 = "/etc/shadow-"
local groupy = "/etc/group"
local config = "/etc/config/users"
local homedir

--## global menu buffers ##--
local status = {}
local system = {}
local network = {}

--####################################### luci ui functions ###############################################--

--## login function to provide valid usernames, used by ndex and serviceclt ##--
function login()
local valid_users = {}
local i, pwent
for i, pwent in ipairs(nixio.getpw()) do
  if pwent.uid == 0 or (pwent.uid >= 1000 and pwent.uid < 65534) then
    valid_users[i] = pwent.name
  end
end
  return valid_users
end

--## fuction to add a new user ##--
function new_user()
  local user = uci:get("users", "new", "name")
  uci:rename("users.new="..user)
  uci:commit("users")
  uci:add("users", "user")
  uci:rename("users.@user[-1]=new")
  uci:commit("users")
  local shell = uci:get("users", user, "shell")
  if shell == "Enabled" then shell = "ash" else shell = "false" end
  local group = uci:get("users", user, "group")
  add_user(user,"users",shell)
 return
end

--## function to edit an existing user ##--
function edit_user(user)
  local shell = uci:get("users", user, "shell")
  if shell == "Enabled" then shell = "ash" else shell = "false" end
  local group = uci:get("users", user, "group")
  set_shell(user,shell)
  --set_group(user,group)
 return
end

--## set the users shell ##--
function set_shell(user,shell)
  local buf = {}
  load_file(passwd,buf)
  local upat = "home/%w+:"

  for i,v in pairs(buf) do
    for name in v:gmatch(upat) do
      name = name:sub(name:find("/")+1,name:find(":")-1)
      if name == user then
        name = v:gsub(v:sub(v:find("bin")+4,-1), shell)
        buf[i]= name
      end
    end
  end
  write_file(passwd, buf)
 return
end

--## Function to get the ui usernames ##--
function ui_users()
  local ui_usernames = {}
  uci:foreach("users", "user", function(s) if s.name ~= nil then ui_usernames[#ui_usernames+1]=s.name end end )
  return ui_usernames
end

--## function to find deleted ui users and remove them from the system ##--
function del_user(username)
  if username ~= nil and username ~= "root" then
      delete_user(username)
  else
    local ui_usernames = ui_users()
    local valid_users = login()
    for i,v in pairs(valid_users) do
      if not util.contains(ui_usernames,v) then
        if v ~= "root" then
         delete_user(v)
        end
      end
    end
  end
end

--## SPLIT STR into INDIVIDUAL TABLE ELEMENTS ##--
local function load_buf(str)
  local buf = {}
  for word in string.gmatch(str, "[^%s]+") do
   buf[#buf+1] = word
  end
 return buf
end

--## GET SUB MENUS ##--
local function get_menu_subs(user,menu)
  local menu_name = menu .."_subs"
  local str = uci:get("users", user, menu_name)
 return str
end

--## GET STATUS OF A MENU ##--
function get_menu_status(user,menu)
  local menu_name = menu .."_menus"
  local str = uci:get("users", user, menu_name)
 return str
end

--## GET A TABLE LOADED WITH the USERS AVAILABLE MENU ITEMS ##--
function hide_menus(user,menu)
  local buf = {}
  local str
  local menu_name = string.format("%s%s", menu,"_menus")
  if user == "nobody" then return buf end
  local str_menus = get_menu_status(user,menu)
  local str_subs = get_menu_subs(user,menu)
  if str_menus and str_subs then 
    str = string.format("%s %s", str_menus, str_subs)
  elseif str_menus then 
    str = string.format("%s", str_menus)
  end
  if str ~= nil then buf = load_buf(str) end
 return buf
end

--## function to set default password for new users ##--
function setpasswd(username,password)
  luci.sys.user.setpasswd(username, "openwrt")
end

--####################################### Ulitlity functions ###############################################--

function get_color(user)
  local tpl = require "luci.template.parser"
  local grp = uci:get("users", user, "group")
  if user and grp == "users" then
    return "#90f090"
  elseif user and grp == "admin" then
    return "#f09090"
  elseif user then
    math.randomseed(tpl.hash(user))

    local r   = math.random(128)
    local g   = math.random(128)
    local min = 0
    local max = 128

    if ( r + g ) < 128 then
      min = 128 - r - g
    else
      max = 255 - r - g
    end

    local b = min + math.floor( math.random() * ( max - min ) )
    return "#%02x%02x%02x" % { 0xFF - r, 0xFF - g, 0xFF - b }
  else
    return "#eeeeee"
  end
end

function clean_config()
  local file = assert(io.open(users_file, "w+"))
  file:close()
end

--## function to check if user exists ##--
function user_exist(username)
 if nixio.getsp(username) ~= nil then return true else return false end
end

--## function to check if path is a file ##--
local function isFile(path)
  if nixio.fs.stat(path, "type") == "reg" then return true else return false end
end

--## function to check if path is a directory ##--
local function isDir(path)
  if nixio.fs.access(path) then return true else return false end
end

--## function to get next available uid ##--
local function get_uid()
local uid = 1000
  while nixio.getpw(uid) do
    uid = uid + 1
  end
 return uid
end

--## function load file into buffer ##--
function load_file(name, buf)
  local i = 1
  local file = io.open(name, "r")

  for line in file:lines() do
    buf[i] = line
    i = i + 1
  end
  file:close()
 return(buf)
end

--## function to add new item to buffer ##--
function new_item(item, buf)
 buf[#buf+1]=item
 return buf
end

--## function to remove user from buffer ##--
function rem_user(user, buf)
  for i,v in pairs(buf) do
    if v:find(user) then
      table.remove(buf,i)
    end
  end
 return(buf)
end

--## function to write buffer back to file ##--
function write_file(name, buf)
  local file = io.open(name, "w+")

  for i,v in pairs(buf) do
    if(i < #buf) then
      file:write(v.."\n")
    else
      file:write(v)
    end
  end
  file:close()
end

--############################################### Add User Functions ######################################--

--## functio to prepare users home dir ##--
function create_homedir(name)
  local home = "/home/"
  local homedir = home .. name
 return homedir
end

--## function add user to passwds ##--
function add_passwd(name,uid,shell,homedir)
  local nuser = name..":x:"..uid..":"..uid..":"..name..":"..homedir..":".."/bin/"..shell
  local nuser2 = name..":*:"..uid..":"..uid..":"..name..":"..homedir..":".."/bin/"..shell
  local buf = {}

  if not user_exist(name) then
    load_file(passwd,buf)
    new_item(nuser,buf)
    write_file(passwd,buf)
    buf = { }
    load_file(passwd2,buf)
    new_item(nuser2,buf)
    write_file(passwd2,buf)
  else
    return
  end
end

--## function add user to shadows ##--
function add_shadow(name)
  local shad = name..":*:11647:0:99999:7:::"
  local buf = { }
  
  if name then
    load_file(shadow,buf)
    new_item(shad,buf)
    write_file(shadow,buf)
    buf = { }
    load_file(shadow2,buf)
    new_item(shad,buf)
    write_file(shadow2,buf)
  else
    return 
  end
end

--## function to add user to group ##--
function add_group(name,group,uid)
  local grp = group..":x:"..uid..":"
  local buf = { }
  return
  --if user_exist(name) then
    --load_file(groupy,buf)
    --new_item(grp,buf)
    --write_file(groupy,buf)
  --end
end

--## make the users home directory and set permissions to (755) ##--
function make_home_dirs(homedir,name,group)
  local home = "/home"
  if not isDir(home) then
    fs.mkdir(home, 755)
  end
  if not isDir(homedir) then
    fs.mkdir(homedir, 755)
  end
  local cmd = "find "..homedir.." -print | xargs chown "..name..":"..group
  os.execute(cmd)
end

--## function to add user to the system  ##--
function add_user(name, group, shell)
  local name = name
  local uid = get_uid()

  if user_exist(name) then 
    return
  elseif name and group and uid and shell then
    homedir = create_homedir(name,group)
    add_passwd(name,uid,shell,homedir)
    add_shadow(name)
    add_group(name,group,uid)
    make_home_dirs(homedir,name,group)
    setpasswd(name)
  end
 return
end

--################################### Remove User functions ###########################################--

--## function remove user from the system ##--
function delete_user(user)
  local buf = { ["passwd"] = {}, ["shadow"] = {}, ["group"] = {} }

  --## load files into indexed buffers ##--
  load_file(passwd, buf.passwd)
  load_file(shadow, buf.shadow)
  load_file(groupy, buf.group)

  --## remove user from buffers ##--
  rem_user(user, buf.passwd)
  rem_user(user, buf.shadow)
  rem_user(user, buf.group)

  --## write edited buffers back to the files ##--
  write_file(passwd, buf.passwd)
  write_file(passwd2, buf.passwd)
  write_file(shadow, buf.shadow)
  write_file(shadow2, buf.shadow)
  write_file(groupy, buf.group)
  luci.sys.call("rm -r -f /home/"..user.."/")
  fs.rmdir("/home/"..user)
end
