#pragma once

#include <gtk/gtk.h>
#include <webkit2/webkit2.h>
#include <json-glib/json-glib.h>

#include <string>
#include <unordered_map>
#include <vector>

namespace cami {

struct Browser {
  GtkWidget* window = nullptr;
  GtkNotebook* notebook = nullptr;
  WebKitWebContext* context = nullptr;
  std::vector<WebKitWebView*> views;
  GIOChannel* input = nullptr;
  guint input_watch = 0;
  int next_page_id = 1;
  std::string profile_path;
  bool ready_sent = false;
  unsigned int next_eval_id = 1;
  std::unordered_map<int, std::string> navigation_requests;
  std::unordered_map<int, std::string> navigation_targets;
  std::unordered_map<int, bool> navigation_started;
};

struct Request {
  std::string id;
  std::string path;
  int page_id = 0;
};

struct EvalRequest {
  std::string id;
  std::string key;
  WebKitWebView* view = nullptr;
  unsigned int attempts = 0;
};

WebKitWebView* get_view(Browser* browser, int page_id);
int get_page_id(JsonObject* params);
void write_json(JsonNode* node);
void send_response(const std::string& id, JsonNode* result, const char* error = nullptr);
void send_string_response(const std::string& id, const char* value);
void send_ready_event(Browser* browser, const char* uri);
bool valid_web_url(const char* raw_url);
const char* get_string_member(JsonObject* object, const char* name);
WebKitWebView* create_view(Browser* browser, int page_id);
void on_load_changed(WebKitWebView* view, WebKitLoadEvent event, gpointer data);
gboolean on_load_failed(WebKitWebView* view, WebKitLoadEvent event, const gchar* failing_uri,
                        GError* error, gpointer data);
void on_eval_started(GObject* object, GAsyncResult* result, gpointer data);
void on_snapshot_finished(GObject* object, GAsyncResult* result, gpointer data);
gboolean on_delete_event(GtkWidget* widget, GdkEvent* event, gpointer data);
void on_window_destroyed(GtkWidget* widget, gpointer data);
void close_view(Browser* browser, WebKitWebView* view);
void handle_request(Browser* browser, JsonObject* object);
gboolean on_stdin_ready(GIOChannel* channel, GIOCondition condition, gpointer data);

}  // namespace cami
