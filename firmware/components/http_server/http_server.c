#include "http_server.h"
#include <stdio.h>
#include <string.h>
#include <esp_http_server.h>
#include <esp_log.h>
#include "camera_hal.h"

static const char *TAG = "http_server";
static httpd_handle_t server = NULL;

static esp_err_t status_handler(httpd_req_t *req) {
    const char *response = "{\"status\":\"ok\"}";
    httpd_resp_set_type(req, "application/json");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
    httpd_resp_send(req, response, strlen(response));
    return ESP_OK;
}

static esp_err_t capture_handler(httpd_req_t *req) {
    camera_frame_t *frame = camera_hal_take_picture();
    if (!frame) {
        const char *err = "{\"error\":\"capture failed\"}";
        httpd_resp_set_type(req, "application/json");
        httpd_resp_set_status(req, "500 Internal Server Error");
        httpd_resp_send(req, err, strlen(err));
        return ESP_FAIL;
    }

    httpd_resp_set_type(req, "image/jpeg");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");

    char dim_hdr[32];
    snprintf(dim_hdr, sizeof(dim_hdr), "%d", frame->width);
    httpd_resp_set_hdr(req, "X-Frame-Width", dim_hdr);

    char dim_hdr2[32];
    snprintf(dim_hdr2, sizeof(dim_hdr2), "%d", frame->height);
    httpd_resp_set_hdr(req, "X-Frame-Height", dim_hdr2);

    int w = frame->width;
    int h = frame->height;
    size_t len = frame->len;

    httpd_resp_send(req, (const char *)frame->buf, frame->len);
    camera_hal_return_picture(frame);

    ESP_LOGI(TAG, "Served frame: %dx%d, %zu bytes", w, h, len);
    return ESP_OK;
}

bool http_server_start(void) {
    if (server != NULL) {
        ESP_LOGW(TAG, "Server already running");
        return true;
    }

    httpd_config_t config = HTTPD_DEFAULT_CONFIG();
    config.server_port = 80;

    ESP_LOGI(TAG, "Starting HTTP server on port %d", config.server_port);
    esp_err_t err = httpd_start(&server, &config);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to start HTTP server: %s", esp_err_to_name(err));
        return false;
    }

    httpd_uri_t status_uri = {
        .uri = "/api/status",
        .method = HTTP_GET,
        .handler = status_handler,
    };
    httpd_register_uri_handler(server, &status_uri);

    httpd_uri_t capture_uri = {
        .uri = "/capture",
        .method = HTTP_GET,
        .handler = capture_handler,
    };
    httpd_register_uri_handler(server, &capture_uri);

    printf("HTTP server started on port 80\n");
    printf("Registered endpoints: /api/status, /capture\n");
    return true;
}

void http_server_stop(void) {
    if (server != NULL) {
        httpd_stop(server);
        server = NULL;
        ESP_LOGI(TAG, "HTTP server stopped");
    }
}
