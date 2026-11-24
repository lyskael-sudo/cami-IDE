#include "browser.h"

#include <climits>
#include <cerrno>
#include <cstdlib>
#include <iostream>
#include <unistd.h>

namespace {
bool read_environment_int(const char* name, int* value, bool* present) {
  const char* raw = std::getenv(name);
  *present = raw != nullptr;
  if (!raw) return true;

  char* end = nullptr;
  const long parsed = std::strtol(raw, &end, 10);
  if (end == raw || *end != '\0' || parsed < INT_MIN || parsed > INT_MAX) {
    std::cerr << "[cami-webkit] Invalid " << name << " value." << std::endl;
    return false;
  }

  *value = static_cast<int>(parsed);
  return true;
}

}  // namespace

int main(int argc, char** argv) {
  if (argc < 2 || !*argv[1]) {
    std::cerr << "Usage: cami-webkit-browser PROFILE_DIRECTORY [URL]" << std::endl;
    return 2;
  }

  gtk_init(&argc, &argv);
  int companion_x = 0;
  int companion_y = 0;
  int companion_width = 1280;
  int companion_height = 800;
  bool has_x = false;
  bool has_y = false;
  bool has_width = false;
  bool has_height = false;
  if (!read_environment_int("CAMI_COMPANION_X", &companion_x, &has_x) ||
      !read_environment_int("CAMI_COMPANION_Y", &companion_y, &has_y) ||
      !read_environment_int("CAMI_COMPANION_WIDTH", &companion_width, &has_width) ||
      !read_environment_int("CAMI_COMPANION_HEIGHT", &companion_height, &has_height)) {
    return 2;
  }
  if (has_x != has_y || has_width != has_height ||
      (has_width && (companion_width < 320 || companion_width > 8192)) ||
      (has_height && (companion_height < 240 || companion_height > 8192))) {
    std::cerr << "[cami-webkit] Invalid companion window geometry." << std::endl;
    return 2;
  }

  cami::Browser browser;
  browser.profile_path = argv[1];
  if (g_mkdir_with_parents(browser.profile_path.c_str(), 0700) != 0) {
    std::cerr << "[cami-webkit] Cannot create profile directory: "
              << g_strerror(errno) << std::endl;
    return 2;
  }
  const std::string cache_path = browser.profile_path + "/cache";
  if (g_mkdir_with_parents(cache_path.c_str(), 0700) != 0) {
    std::cerr << "[cami-webkit] Cannot create cache directory: "
              << g_strerror(errno) << std::endl;
    return 2;
  }

  WebKitWebsiteDataManager* data_manager =
      webkit_website_data_manager_new("base-data-directory",
                                      browser.profile_path.c_str(),
                                      "base-cache-directory",
                                      cache_path.c_str(),
                                      nullptr);
  browser.context = webkit_web_context_new_with_website_data_manager(data_manager);
  g_object_unref(data_manager);

  browser.window = gtk_window_new(GTK_WINDOW_TOPLEVEL);
  gtk_window_set_title(GTK_WINDOW(browser.window), "Cami — Navigateur WebKit");
  gtk_window_set_default_size(
      GTK_WINDOW(browser.window), companion_width, companion_height);
  gtk_window_set_keep_above(GTK_WINDOW(browser.window), TRUE);
  if (has_x && has_y) {
    gtk_window_move(GTK_WINDOW(browser.window), companion_x, companion_y);
  }
  browser.notebook = GTK_NOTEBOOK(gtk_notebook_new());
  gtk_container_add(GTK_CONTAINER(browser.window), GTK_WIDGET(browser.notebook));
  g_signal_connect(browser.window, "delete-event", G_CALLBACK(cami::on_delete_event), nullptr);
  g_signal_connect(browser.window, "destroy", G_CALLBACK(cami::on_window_destroyed), &browser);
  WebKitWebView* initial_view = cami::create_view(&browser, 0);
  gtk_widget_show_all(browser.window);
  gtk_window_present(GTK_WINDOW(browser.window));

  browser.input = g_io_channel_unix_new(STDIN_FILENO);
  g_io_channel_set_encoding(browser.input, nullptr, nullptr);
  g_io_channel_set_buffered(browser.input, TRUE);
  browser.input_watch = g_io_add_watch(
      browser.input, static_cast<GIOCondition>(G_IO_IN | G_IO_HUP | G_IO_ERR),
      cami::on_stdin_ready, &browser);

  const char* initial_url = argc > 2 ? argv[2] : "about:blank";
  if (cami::valid_web_url(initial_url)) {
    webkit_web_view_load_uri(initial_view, initial_url);
  }
  gtk_main();
  if (browser.input_watch) g_source_remove(browser.input_watch);
  if (browser.input) g_io_channel_unref(browser.input);
  g_object_unref(browser.context);
  return 0;
}
