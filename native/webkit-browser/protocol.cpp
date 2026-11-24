#include "browser.h"

#include <cstring>
#include <iostream>

namespace cami {

int get_page_id(JsonObject* params) {
  if (!params || !json_object_has_member(params, "pageId")) return 0;
  return static_cast<int>(json_object_get_int_member(params, "pageId"));
}


void write_json(JsonNode* node) {
  JsonGenerator* generator = json_generator_new();
  json_generator_set_root(generator, node);
  gsize length = 0;
  gchar* data = json_generator_to_data(generator, &length);
  if (data) {
    std::cout.write(data, static_cast<std::streamsize>(length));
    std::cout << std::endl;
    g_free(data);
  }
  g_object_unref(generator);
}


void send_response(const std::string& id, JsonNode* result, const char* error) {
  JsonBuilder* builder = json_builder_new();
  json_builder_begin_object(builder);
  json_builder_set_member_name(builder, "id");
  json_builder_add_string_value(builder, id.c_str());
  if (error) {
    json_builder_set_member_name(builder, "error");
    json_builder_add_string_value(builder, error);
  } else {
    json_builder_set_member_name(builder, "result");
    if (result) {
      json_builder_add_value(builder, json_node_copy(result));
    } else {
      json_builder_add_null_value(builder);
    }
  }
  json_builder_end_object(builder);
  JsonNode* root = json_builder_get_root(builder);
  write_json(root);
  json_node_free(root);
  g_object_unref(builder);
}


void send_string_response(const std::string& id, const char* value) {
  JsonNode* result = json_node_new(JSON_NODE_VALUE);
  json_node_set_string(result, value ? value : "");
  send_response(id, result);
  json_node_free(result);
}


void send_ready_event(Browser* browser, const char* uri) {
  if (browser->ready_sent) return;
  browser->ready_sent = true;
  JsonBuilder* builder = json_builder_new();
  json_builder_begin_object(builder);
  json_builder_set_member_name(builder, "event");
  json_builder_add_string_value(builder, "ready");
  json_builder_set_member_name(builder, "url");
  json_builder_add_string_value(builder, uri ? uri : "about:blank");
  json_builder_end_object(builder);
  JsonNode* root = json_builder_get_root(builder);
  write_json(root);
  json_node_free(root);
  g_object_unref(builder);
}


bool valid_web_url(const char* raw_url) {
  if (!raw_url || !*raw_url) return false;
  GError* error = nullptr;
  GUri* uri = g_uri_parse(raw_url, G_URI_FLAGS_NONE, &error);
  if (error) g_error_free(error);
  if (!uri) return false;
  const char* scheme = g_uri_get_scheme(uri);
  const bool allowed = scheme &&
      (g_ascii_strcasecmp(scheme, "http") == 0 ||
       g_ascii_strcasecmp(scheme, "https") == 0 ||
       g_ascii_strcasecmp(scheme, "about") == 0);
  g_uri_unref(uri);
  return allowed;
}


const char* get_string_member(JsonObject* object, const char* name) {
  if (!json_object_has_member(object, name)) return nullptr;
  JsonNode* node = json_object_get_member(object, name);
  return JSON_NODE_HOLDS_VALUE(node) &&
      json_node_get_value_type(node) == G_TYPE_STRING
      ? json_node_get_string(node)
      : nullptr;
}

}  // namespace cami
