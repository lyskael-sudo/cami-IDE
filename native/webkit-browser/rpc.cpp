#include "browser.h"

#include <cstring>
#include <iostream>

namespace cami {

void handle_request(Browser* browser, JsonObject* object) {
  const char* id_value = get_string_member(object, "id");
  const char* method = get_string_member(object, "method");
  if (!id_value || !method) return;
  const std::string id(id_value);
  JsonObject* params = json_object_has_member(object, "params")
      ? json_object_get_object_member(object, "params")
      : nullptr;
  const int page_id = get_page_id(params);
  WebKitWebView* view = get_view(browser, page_id);

  if (g_str_equal(method, "newPage")) {
    if (!browser->notebook) {
      send_response(id, nullptr, "The browser window is closed.");
      return;
    }
    const int new_id = browser->next_page_id++;
    create_view(browser, new_id);
    JsonNode* result = json_node_new(JSON_NODE_VALUE);
    json_node_set_int(result, new_id);
    send_response(id, result);
    json_node_free(result);
    return;
  }
  if (g_str_equal(method, "closeAll")) {
    // Reply before tearing the window down; only destroy it while it is alive.
    send_string_response(id, "OK");
    if (browser->window) gtk_widget_destroy(browser->window);
    return;
  }
  if (!view) {
    send_response(id, nullptr, "Browser page no longer exists.");
    return;
  }

  if (g_str_equal(method, "navigate")) {
    const char* url = params ? get_string_member(params, "url") : nullptr;
    if (!valid_web_url(url)) {
      send_response(id, nullptr, "Only http, https and about URLs are allowed.");
      return;
    }
    browser->navigation_requests[page_id] = id;
    browser->navigation_targets[page_id] = url;
    browser->navigation_started[page_id] = false;
    webkit_web_view_load_uri(view, url);
    return;
  }
  if (g_str_equal(method, "evaluate")) {
    const char* script = params ? get_string_member(params, "script") : nullptr;
    if (!script || std::strlen(script) > 2 * 1024 * 1024) {
      send_response(id, nullptr, "Invalid or oversized JavaScript request.");
      return;
    }
    const std::string key = "cami_" + std::to_string(browser->next_eval_id++);
    const std::string wrapped =
        "(()=>{const key='" + key +
        "';globalThis.__camiRpcResults ||= Object.create(null);"
        "Promise.resolve().then(()=>(" + script +
        "\n)).then(value=>{try{globalThis.__camiRpcResults[key]="
        "JSON.stringify({ok:true,value})}catch(error){"
        "globalThis.__camiRpcResults[key]=JSON.stringify({ok:false,error:String(error)})}},"
        "error=>{globalThis.__camiRpcResults[key]="
        "JSON.stringify({ok:false,error:String(error)})});return key})()";
    auto* request = new EvalRequest{id, key, WEBKIT_WEB_VIEW(g_object_ref(view))};
    webkit_web_view_evaluate_javascript(
        view, wrapped.c_str(), -1, nullptr, nullptr, nullptr,
        on_eval_started, request);
    return;
  }
  if (g_str_equal(method, "screenshot")) {
    const char* path = params ? get_string_member(params, "path") : nullptr;
    if (!path || !*path) {
      send_response(id, nullptr, "A screenshot path is required.");
      return;
    }
    webkit_web_view_get_snapshot(
        view, WEBKIT_SNAPSHOT_REGION_VISIBLE,
        WEBKIT_SNAPSHOT_OPTIONS_NONE, nullptr, on_snapshot_finished,
        new Request{id, path, page_id});
    return;
  }
  if (g_str_equal(method, "back")) {
    if (!webkit_web_view_can_go_back(view)) {
      send_response(id, nullptr, "No previous page in history.");
      return;
    }
    webkit_web_view_go_back(view);
    send_string_response(id, "OK");
    return;
  }
  if (g_str_equal(method, "forward")) {
    if (!webkit_web_view_can_go_forward(view)) {
      send_response(id, nullptr, "No next page in history.");
      return;
    }
    webkit_web_view_go_forward(view);
    send_string_response(id, "OK");
    return;
  }
  if (g_str_equal(method, "reload")) {
    webkit_web_view_reload(view);
    send_string_response(id, "OK");
    return;
  }
  if (g_str_equal(method, "close")) {
    send_string_response(id, "OK");
    close_view(browser, view);
    return;
  }
  if (g_str_equal(method, "url")) {
    send_string_response(id, webkit_web_view_get_uri(view));
    return;
  }
  if (g_str_equal(method, "title")) {
    send_string_response(id, webkit_web_view_get_title(view));
    return;
  }
  if (g_str_equal(method, "focus")) {
    if (!browser->window || !browser->notebook) {
      send_response(id, nullptr, "The browser window is closed.");
      return;
    }
    gtk_notebook_set_current_page(browser->notebook,
                                  gtk_notebook_page_num(browser->notebook, GTK_WIDGET(view)));
    gtk_window_present(GTK_WINDOW(browser->window));
    send_string_response(id, "OK");
    return;
  }
  send_response(id, nullptr, "Unknown browser command.");
}


gboolean on_stdin_ready(GIOChannel* channel, GIOCondition condition, gpointer data) {
  auto* browser = static_cast<Browser*>(data);
  if (condition & (G_IO_HUP | G_IO_ERR)) {
    if (browser->window) gtk_widget_destroy(browser->window);
    else gtk_main_quit();
    return G_SOURCE_REMOVE;
  }

  gchar* line = nullptr;
  gsize length = 0;
  GError* error = nullptr;
  const GIOStatus status = g_io_channel_read_line(channel, &line, &length, nullptr, &error);
  if (status == G_IO_STATUS_EOF) {
    if (browser->window) gtk_widget_destroy(browser->window);
    else gtk_main_quit();
    g_free(line);
    if (error) g_error_free(error);
    return G_SOURCE_REMOVE;
  }
  if (status != G_IO_STATUS_NORMAL || !line) {
    if (error) g_error_free(error);
    g_free(line);
    return G_SOURCE_CONTINUE;
  }

  // Guard against a runaway/oversized control message: the JS evaluator caps
  // scripts at 2 MB, so anything far beyond that is not a legitimate request.
  if (length > 4u * 1024u * 1024u) {
    std::cerr << "[cami-webkit] Dropping oversized control message ("
              << length << " bytes)." << std::endl;
    g_free(line);
    return G_SOURCE_CONTINUE;
  }

  JsonParser* parser = json_parser_new();
  if (json_parser_load_from_data(parser, line, static_cast<gssize>(length), &error)) {
    JsonNode* root = json_parser_get_root(parser);
    if (JSON_NODE_HOLDS_OBJECT(root)) {
      handle_request(browser, json_node_get_object(root));
    }
  } else {
    std::cerr << "[cami-webkit] Invalid control message: "
              << (error ? error->message : "invalid JSON") << std::endl;
  }
  if (error) g_error_free(error);
  g_object_unref(parser);
  g_free(line);
  return G_SOURCE_CONTINUE;
}

}  // namespace cami
