cmake_minimum_required(VERSION 3.20)
project(cami_webkit_browser LANGUAGES CXX)

find_package(PkgConfig REQUIRED)
pkg_check_modules(GTK REQUIRED IMPORTED_TARGET gtk+-3.0)
pkg_check_modules(WEBKIT REQUIRED IMPORTED_TARGET webkit2gtk-4.1)
pkg_check_modules(JSON_GLIB REQUIRED IMPORTED_TARGET json-glib-1.0)

add_executable(cami-webkit-browser
  main.cpp
  protocol.cpp
  rpc.cpp
  webview.cpp
)
target_compile_features(cami-webkit-browser PRIVATE cxx_std_17)
target_compile_options(cami-webkit-browser PRIVATE -Wall -Wextra -Wpedantic)
target_link_libraries(cami-webkit-browser PRIVATE
  PkgConfig::GTK
  PkgConfig::WEBKIT
  PkgConfig::JSON_GLIB
)
