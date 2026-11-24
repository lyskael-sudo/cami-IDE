#include "browser.h"

#include <algorithm>
#include <cstring>
#include <iostream>
#include <memory>

namespace cami {

gboolean poll_eval_result(gpointer data);
void finish_eval(EvalRequest* request, JsonNode* value, const char* error = nullptr);

WebKitWebView* get_view(Browser* browser, int page_id) {
  for (WebKitWebView* view : browser->views) {
    if (GPOINTER_TO_INT(g_object_get_data(G_OBJECT(view), "cami-page-id")) == page_id)
      return view;
  }
  return nullptr;
}


// Resolve (or reject) a navigation request left pending for this page, so the
// Node side never waits for its 30 s timeout. Returns true when one was pending.
bool cancel_navigation(Browser* browser, int page_id, const char* error) {
  const auto pending = browser->navigation_requests.find(page_id);
  if (pending == browser->navigation_requests.end()) return false;
  send_response(pending->second, nullptr, error ? error : "Navigation cancelled.");
  browser->navigation_requests.erase(pending);
  browser->navigation_targets.erase(page_id);
  browser->navigation_started.erase(page_id);
  return true;
}


void close_view(Browser* browser, WebKitWebView* view) {
  // A pending navigate() would otherwise hang until the client timeout.
  cancel_navigation(
      browser, GPOINTER_TO_INT(g_object_get_data(G_OBJECT(view), "cami-page-id")),
      "Browser page was closed during navigation.");

  JsonBuilder* builder = json_builder_new();
  json_builder_begin_object(builder);
  json_builder_set_member_name(builder, "event");
  json_builder_add_string_value(builder, "pageClosed");
  json_builder_set_member_name(builder, "pageId");
  json_builder_add_int_value(
      builder, GPOINTER_TO_INT(g_object_get_data(G_OBJECT(view), "cami-page-id")));
  json_builder_end_object(builder);
  JsonNode* root = json_builder_get_root(builder);
  write_json(root);
  json_node_free(root);
  g_object_unref(builder);

  if (browser->notebook) {
    const int page_num = gtk_notebook_page_num(browser->notebook, GTK_WIDGET(view));
    if (page_num >= 0) gtk_notebook_remove_page(browser->notebook, page_num);
  }
  browser->views.erase(
      std::remove(browser->views.begin(), browser->views.end(), view), browser->views.end());
  if (browser->views.empty() && browser->window) gtk_widget_destroy(browser->window);
}


void on_close_tab(GtkButton*, gpointer data) {
  auto* view = WEBKIT_WEB_VIEW(data);
  auto* browser = static_cast<Browser*>(g_object_get_data(G_OBJECT(view), "cami-browser"));
  if (browser) close_view(browser, view);
}


void finish_eval(EvalRequest* request, JsonNode* value, const char* error) {
  send_response(request->id, value, error);
  g_object_unref(request->view);
  delete request;
}


void on_eval_result_polled(GObject* object, GAsyncResult* result, gpointer data) {
  auto* request = static_cast<EvalRequest*>(data);
  GError* error = nullptr;
  JSCValue* value = webkit_web_view_evaluate_javascript_finish(
      WEBKIT_WEB_VIEW(object), result, &error);
  if (error) {
    finish_eval(request, nullptr, error->message);
    g_error_free(error);
    if (value) g_object_unref(value);
    return;
  }

  gchar* json = value && jsc_value_is_string(value)
      ? jsc_value_to_string(value)
      : nullptr;
  if (json && !g_str_equal(json, "null")) {
    JsonParser* parser = json_parser_new();
    if (!json_parser_load_from_data(parser, json, -1, &error)) {
      finish_eval(request, nullptr, error ? error->message : "Invalid JavaScript result.");
      if (error) g_error_free(error);
    } else {
      JsonNode* root = json_parser_get_root(parser);
      JsonObject* object_value = JSON_NODE_HOLDS_OBJECT(root)
          ? json_node_get_object(root)
          : nullptr;
      if (!object_value || !json_object_get_boolean_member(object_value, "ok")) {
        const char* message = object_value
            ? json_object_get_string_member(object_value, "error")
            : nullptr;
        finish_eval(request, nullptr, message ? message : "JavaScript evaluation failed.");
      } else {
        JsonNode* result = json_object_has_member(object_value, "value")
            ? json_node_copy(json_object_get_member(object_value, "value"))
            : nullptr;
        finish_eval(request, result);
        if (result) json_node_free(result);
      }
    }
    g_object_unref(parser);
    g_free(json);
    if (value) g_object_unref(value);
    return;
  }
  g_free(json);
  if (value) g_object_unref(value);
  g_timeout_add(20, poll_eval_result, request);
}


gboolean poll_eval_result(gpointer data) {
  auto* request = static_cast<EvalRequest*>(data);
  if (++request->attempts > 1500) {
    finish_eval(request, nullptr, "Timed out waiting for JavaScript evaluation.");
    return G_SOURCE_REMOVE;
  }
  const std::string script =
      "(()=>{const s=globalThis.__camiRpcResults;const r=s&&s." +
      request->key + ";if(r)delete s." + request->key + ";return r||null})()";
  webkit_web_view_evaluate_javascript(
      request->view, script.c_str(), -1, nullptr, nullptr, nullptr,
      on_eval_result_polled, request);
  return G_SOURCE_REMOVE;
}


void on_eval_started(GObject* object, GAsyncResult* result, gpointer data) {
  auto* request = static_cast<EvalRequest*>(data);
  GError* error = nullptr;
  JSCValue* value = webkit_web_view_evaluate_javascript_finish(
      WEBKIT_WEB_VIEW(object), result, &error);
  if (error) {
    finish_eval(request, nullptr, error->message);
    g_error_free(error);
    if (value) g_object_unref(value);
    return;
  }
  g_timeout_add(20, poll_eval_result, request);
  if (value) g_object_unref(value);
}


void on_snapshot_finished(GObject* object, GAsyncResult* result, gpointer data) {
  std::unique_ptr<Request> request(static_cast<Request*>(data));
  GError* error = nullptr;
  cairo_surface_t* surface = webkit_web_view_get_snapshot_finish(
      WEBKIT_WEB_VIEW(object), result, &error);
  if (!surface) {
    send_response(request->id, nullptr, error ? error->message : "Screenshot failed.");
    if (error) g_error_free(error);
    return;
  }

  GdkPixbuf* pixbuf = gdk_pixbuf_get_from_surface(
      surface, 0, 0, cairo_image_surface_get_width(surface),
      cairo_image_surface_get_height(surface));
  cairo_surface_destroy(surface);
  if (!pixbuf) {
    send_response(request->id, nullptr, "Could not encode browser screenshot.");
    return;
  }

  if (!gdk_pixbuf_save(pixbuf, request->path.c_str(), "png", &error, nullptr)) {
    send_response(request->id, nullptr, error ? error->message : "Could not save screenshot.");
    if (error) g_error_free(error);
  } else {
    send_string_response(request->id, "Screenshot saved.");
  }
  g_object_unref(pixbuf);
}


gboolean on_load_failed(WebKitWebView* view, WebKitLoadEvent, const gchar* failing_uri,
                        GError* error, gpointer data) {
  auto* browser = static_cast<Browser*>(data);
  if (!browser->ready_sent) send_ready_event(browser, "about:blank");
  const int page_id =
      GPOINTER_TO_INT(g_object_get_data(G_OBJECT(view), "cami-page-id"));
  cancel_navigation(browser, page_id,
                    error ? error->message : "Navigation failed.");
  std::cerr << "[cami-webkit] Navigation failed for "
            << (failing_uri ? failing_uri : "(unknown)") << ": "
            << (error ? error->message : "unknown error") << std::endl;
  JsonBuilder* builder = json_builder_new();
  json_builder_begin_object(builder);
  json_builder_set_member_name(builder, "event");
  json_builder_add_string_value(builder, "navigationError");
  json_builder_set_member_name(builder, "pageId");
  json_builder_add_int_value(builder, page_id);
  json_builder_set_member_name(builder, "error");
  json_builder_add_string_value(builder, error ? error->message : "Navigation failed.");
  json_builder_end_object(builder);
  JsonNode* root = json_builder_get_root(builder);
  write_json(root);
  json_node_free(root);
  g_object_unref(builder);
  return FALSE;
}


//
// Google (and every other OAuth provider) opens the sign-in form in a POPUP.
// Without handling the "create" signal, WebKitGTK silently drops that popup:
// the sign-in page never appears, and the session can never be established —
// which is exactly why the account looked "logged in then logged out".
// The popup is opened as a new tab of this same context, so it shares the
// cookie jar and the login actually sticks.
//
WebKitWebView* create_view(Browser* browser, int page_id);

static GtkWidget* on_create(WebKitWebView* view, WebKitNavigationAction* action, gpointer data) {
  (void)view;
  (void)action;
  auto* browser = static_cast<Browser*>(data);
  if (!browser || !browser->notebook) return nullptr;
  return GTK_WIDGET(create_view(browser, browser->next_page_id++));
}


WebKitWebView* create_view(Browser* browser, int page_id) {
  auto* view = WEBKIT_WEB_VIEW(webkit_web_view_new_with_context(browser->context));
  g_object_set_data(G_OBJECT(view), "cami-page-id", GINT_TO_POINTER(page_id));
  g_object_set_data(G_OBJECT(view), "cami-browser", browser);
  WebKitSettings* settings = webkit_web_view_get_settings(view);
  webkit_settings_set_enable_javascript(settings, TRUE);
  webkit_settings_set_enable_webgl(settings, TRUE);
  webkit_settings_set_enable_media_stream(settings, FALSE);
  GtkWidget* tab = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 5);
  GtkWidget* title = gtk_label_new("Nouvel onglet");
  GtkWidget* close = gtk_button_new_with_label("×");
  gtk_button_set_relief(GTK_BUTTON(close), GTK_RELIEF_NONE);
  gtk_widget_set_tooltip_text(close, "Fermer l’onglet");
  gtk_box_pack_start(GTK_BOX(tab), title, TRUE, TRUE, 0);
  gtk_box_pack_start(GTK_BOX(tab), close, FALSE, FALSE, 0);
  g_object_set_data(G_OBJECT(view), "cami-tab-title", title);
  g_signal_connect(close, "clicked", G_CALLBACK(on_close_tab), view);
  gtk_notebook_append_page(browser->notebook, GTK_WIDGET(view), tab);
  gtk_widget_show_all(tab);
  gtk_widget_show(GTK_WIDGET(view));
  browser->views.push_back(view);
  g_signal_connect(view, "load-changed", G_CALLBACK(on_load_changed), nullptr);
  g_signal_connect(view, "load-failed", G_CALLBACK(on_load_failed), browser);
  g_signal_connect(view, "create", G_CALLBACK(on_create), browser);
  gtk_notebook_set_current_page(browser->notebook,
                                gtk_notebook_page_num(browser->notebook, GTK_WIDGET(view)));
  return view;
}


void on_load_changed(WebKitWebView* view, WebKitLoadEvent event, gpointer) {
  const char* uri = webkit_web_view_get_uri(view);
  const int page_id =
      GPOINTER_TO_INT(g_object_get_data(G_OBJECT(view), "cami-page-id"));
  auto* browser = static_cast<Browser*>(
      g_object_get_data(G_OBJECT(view), "cami-browser"));
  if (event == WEBKIT_LOAD_FINISHED && !browser->ready_sent) {
    send_ready_event(browser, uri);
    return;
  }
  const auto pending = browser->navigation_requests.find(page_id);
  if (event == WEBKIT_LOAD_STARTED && pending != browser->navigation_requests.end()) {
    const std::string expected = browser->navigation_targets[page_id];
    const std::string actual = uri ? uri : "";
    const bool root_slash = expected.find("://") != std::string::npos &&
        expected.find('/', expected.find("://") + 3) == std::string::npos;
    const bool matches = actual == expected || (root_slash && actual == expected + "/");
    // A server redirect to another origin/host still belongs to our navigation:
    // keep waiting for it instead of leaving the request pending forever.
    const bool same_host = [&] {
      GError* e1 = nullptr;
      GError* e2 = nullptr;
      GUri* a = g_uri_parse(expected.c_str(), G_URI_FLAGS_NONE, &e1);
      GUri* b = g_uri_parse(actual.c_str(), G_URI_FLAGS_NONE, &e2);
      bool same = a && b && g_strcmp0(g_uri_get_host(a), g_uri_get_host(b)) == 0;
      if (e1) g_error_free(e1);
      if (e2) g_error_free(e2);
      if (a) g_uri_unref(a);
      if (b) g_uri_unref(b);
      return same;
    }();
    browser->navigation_started[page_id] = matches || same_host;
  }
  if (event != WEBKIT_LOAD_FINISHED) return;
  const auto started = browser->navigation_started.find(page_id);
  if (pending != browser->navigation_requests.end() &&
      started != browser->navigation_started.end() && started->second) {
    send_string_response(pending->second, "Navigation finished.");
    browser->navigation_requests.erase(pending);
    browser->navigation_targets.erase(page_id);
    browser->navigation_started.erase(page_id);
  }
  const char* title = webkit_web_view_get_title(view);
  auto* tab_title = GTK_LABEL(g_object_get_data(G_OBJECT(view), "cami-tab-title"));
  if (tab_title) gtk_label_set_text(tab_title, title && *title ? title : (uri ? uri : "Onglet"));
  JsonBuilder* builder = json_builder_new();
  json_builder_begin_object(builder);
  json_builder_set_member_name(builder, "event");
  json_builder_add_string_value(builder, "navigation");
  json_builder_set_member_name(builder, "url");
  json_builder_add_string_value(builder, uri ? uri : "");
  json_builder_set_member_name(builder, "pageId");
  json_builder_add_int_value(builder, page_id);
  json_builder_end_object(builder);
  JsonNode* root = json_builder_get_root(builder);
  write_json(root);
  json_node_free(root);
  g_object_unref(builder);
}


gboolean on_delete_event(GtkWidget*, GdkEvent*, gpointer) {
  gtk_main_quit();
  return FALSE;
}


void on_window_destroyed(GtkWidget*, gpointer data) {
  // Null the pointer: the stdin watch (HUP) and closeAll both destroy the
  // window, and a second gtk_widget_destroy() on a dead widget is a GTK
  // critical (and use-after-free at process teardown).
  auto* browser = static_cast<Browser*>(data);
  if (browser) {
    browser->window = nullptr;
    browser->notebook = nullptr;
    browser->views.clear();
  }
  gtk_main_quit();
}

}  // namespace cami
