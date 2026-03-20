#include "http_server.h"
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <esp_http_server.h>
#include <esp_log.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include "camera_hal.h"

static const char *TAG = "http_server";
static httpd_handle_t server = NULL;
static prov_ctx_t *s_prov_ctx = NULL;

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

    if (frame->format == CAMERA_FMT_JPEG) {
        httpd_resp_set_type(req, "image/jpeg");
    } else {
        /* Serve raw grayscale as 8-bit BMP (universally supported by browsers) */
        int w = frame->width;
        int h = frame->height;
        int row_stride = (w + 3) & ~3;  /* BMP rows padded to 4 bytes */
        int palette_size = 256 * 4;     /* 256-entry RGBX grayscale palette */
        int pixel_offset = 54 + palette_size;
        int file_size = pixel_offset + row_stride * h;

        /* BMP file header (14 bytes) + DIB header (40 bytes) */
        uint8_t hdr[54];
        memset(hdr, 0, sizeof(hdr));
        /* File header */
        hdr[0] = 'B'; hdr[1] = 'M';
        hdr[2] = file_size; hdr[3] = file_size >> 8;
        hdr[4] = file_size >> 16; hdr[5] = file_size >> 24;
        hdr[10] = pixel_offset; hdr[11] = pixel_offset >> 8;
        /* DIB header (BITMAPINFOHEADER) */
        hdr[14] = 40;  /* header size */
        hdr[18] = w; hdr[19] = w >> 8;
        /* BMP stores height as negative for top-down */
        int neg_h = -h;
        hdr[22] = neg_h & 0xFF; hdr[23] = (neg_h >> 8) & 0xFF;
        hdr[24] = (neg_h >> 16) & 0xFF; hdr[25] = (neg_h >> 24) & 0xFF;
        hdr[26] = 1;   /* planes */
        hdr[28] = 8;   /* bits per pixel */
        hdr[46] = 0;   /* colors used (0 = 256) */

        httpd_resp_set_type(req, "image/bmp");
        httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
        httpd_resp_send_chunk(req, (const char *)hdr, 54);

        /* Grayscale palette: 256 entries of (B, G, R, 0) */
        uint8_t palette[256 * 4];
        for (int i = 0; i < 256; i++) {
            palette[i * 4] = i;      /* B */
            palette[i * 4 + 1] = i;  /* G */
            palette[i * 4 + 2] = i;  /* R */
            palette[i * 4 + 3] = 0;  /* reserved */
        }
        httpd_resp_send_chunk(req, (const char *)palette, sizeof(palette));

        /* Pixel data — send row by row with padding */
        uint8_t pad[3] = {0, 0, 0};
        int pad_bytes = row_stride - w;
        for (int y = 0; y < h; y++) {
            httpd_resp_send_chunk(req, (const char *)&frame->buf[y * w], w);
            if (pad_bytes > 0) {
                httpd_resp_send_chunk(req, (const char *)pad, pad_bytes);
            }
        }
        httpd_resp_send_chunk(req, NULL, 0);
        camera_hal_return_picture(frame);
        return ESP_OK;
    }

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

#define STREAM_BOUNDARY "frameboundary"
#define STREAM_CONTENT_TYPE "multipart/x-mixed-replace;boundary=" STREAM_BOUNDARY
#define STREAM_PART_HDR "--" STREAM_BOUNDARY "\r\nContent-Type: image/jpeg\r\nContent-Length: %zu\r\n\r\n"

static esp_err_t stream_handler(httpd_req_t *req) {
    httpd_resp_set_type(req, STREAM_CONTENT_TYPE);
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
    httpd_resp_set_hdr(req, "Cache-Control", "no-cache");

    char part_hdr[128];
    esp_err_t res = ESP_OK;

    ESP_LOGI(TAG, "Stream started");

    while (res == ESP_OK) {
        camera_frame_t *frame = camera_hal_take_picture();
        if (!frame) {
            ESP_LOGE(TAG, "Stream: capture failed");
            vTaskDelay(100 / portTICK_PERIOD_MS);
            continue;
        }

        int hdr_len = snprintf(part_hdr, sizeof(part_hdr), STREAM_PART_HDR, frame->len);
        res = httpd_resp_send_chunk(req, part_hdr, hdr_len);
        if (res == ESP_OK) {
            res = httpd_resp_send_chunk(req, (const char *)frame->buf, frame->len);
        }
        if (res == ESP_OK) {
            res = httpd_resp_send_chunk(req, "\r\n", 2);
        }
        camera_hal_return_picture(frame);
    }

    ESP_LOGI(TAG, "Stream ended");
    return res;
}

/* Inline HTML for the provisioning form with live camera preview */
static const char PROV_HTML[] =
    "<!DOCTYPE html><html><head>"
    "<meta name='viewport' content='width=device-width,initial-scale=1'>"
    "<title>ChessCam Setup</title>"
    "<style>"
    "body{font-family:sans-serif;max-width:480px;margin:20px auto;padding:0 16px}"
    "h1{font-size:1.4em}"
    "label{display:block;margin-top:12px;font-weight:bold}"
    "input[type=text],input[type=password]{width:100%;padding:8px;box-sizing:border-box;"
    "font-size:1em;border:1px solid #ccc;border-radius:4px}"
    "button{margin-top:16px;padding:10px 24px;font-size:1em;background:#2563eb;"
    "color:white;border:none;border-radius:4px;cursor:pointer}"
    "button:hover{background:#1d4ed8}"
    "#preview{width:100%;max-width:640px;border:1px solid #ccc;margin-top:8px}"
    "#status{margin-top:12px;padding:8px;display:none;border-radius:4px}"
    ".ok{background:#dcfce7;color:#166534;display:block!important}"
    ".err{background:#fef2f2;color:#991b1b;display:block!important}"
    "</style></head><body>"
    "<h1>ChessCam WiFi Setup</h1>"
    "<h2>Camera Preview</h2>"
    "<img id='preview' src='/capture' alt='Camera preview'>"
    "<br><button type='button' onclick='document.getElementById(\"preview\").src="
    "\"/capture?\"+Date.now()'>Refresh</button>"
    "<hr>"
    "<form method='POST' action='/provision' id='pform'>"
    "<label>WiFi SSID</label>"
    "<input type='text' name='ssid' required>"
    "<label>WiFi Password</label>"
    "<div style='display:flex;gap:4px'>"
    "<input type='password' name='password' id='pw' required style='flex:1'>"
    "<button type='button' onclick=\"var p=document.getElementById('pw');"
    "p.type=p.type==='password'?'text':'password';"
    "this.textContent=p.type==='password'?'Show':'Hide'\""
    " style='padding:8px 12px;font-size:0.9em;border:1px solid #ccc;"
    "border-radius:4px;background:#f3f4f6;cursor:pointer'>Show</button>"
    "</div>"
    "<label>Pairing Token</label>"
    "<input type='text' name='token' value='manual' required>"
    "<button type='submit'>Connect</button>"
    "</form>"
    "<div id='status'></div>"
    "<script>"
    "document.getElementById('pform').onsubmit=function(e){"
    "e.preventDefault();"
    "var f=new FormData(this);"
    "var s=document.getElementById('status');"
    "s.className='';s.style.display='none';s.textContent='Connecting...';"
    "s.style.display='block';"
    "fetch('/provision',{method:'POST',body:new URLSearchParams(f)})"
    ".then(r=>r.json()).then(d=>{"
    "if(d.ok){s.className='ok';s.textContent='Connected! Device will restart.'}"
    "else{s.className='err';s.textContent='Error: '+(d.error||'unknown')}"
    "}).catch(e=>{s.className='err';s.textContent='Request failed: '+e});"
    "};"
    "</script></body></html>";

static esp_err_t prov_form_handler(httpd_req_t *req) {
    httpd_resp_set_type(req, "text/html");
    httpd_resp_send(req, PROV_HTML, strlen(PROV_HTML));
    return ESP_OK;
}

/* URL-decode a string in-place. Returns decoded length. */
static int url_decode(char *str) {
    char *src = str, *dst = str;
    while (*src) {
        if (*src == '%' && src[1] && src[2]) {
            char hex[3] = {src[1], src[2], 0};
            *dst++ = (char)strtol(hex, NULL, 16);
            src += 3;
        } else if (*src == '+') {
            *dst++ = ' ';
            src++;
        } else {
            *dst++ = *src++;
        }
    }
    *dst = '\0';
    return dst - str;
}

/* Extract a form field value from URL-encoded body. Caller must free result. */
static char *get_form_field(const char *body, const char *field) {
    size_t flen = strlen(field);
    const char *p = body;
    while ((p = strstr(p, field)) != NULL) {
        /* Ensure it's at start or after '&', and followed by '=' */
        if ((p == body || *(p - 1) == '&') && p[flen] == '=') {
            const char *val = p + flen + 1;
            const char *end = strchr(val, '&');
            size_t vlen = end ? (size_t)(end - val) : strlen(val);
            char *result = malloc(vlen + 1);
            if (result) {
                memcpy(result, val, vlen);
                result[vlen] = '\0';
                url_decode(result);
            }
            return result;
        }
        p += flen;
    }
    return NULL;
}

static esp_err_t prov_submit_handler(httpd_req_t *req) {
    char body[512];
    int len = httpd_req_recv(req, body, sizeof(body) - 1);
    if (len <= 0) {
        httpd_resp_set_type(req, "application/json");
        httpd_resp_send(req, "{\"ok\":false,\"error\":\"empty body\"}", HTTPD_RESP_USE_STRLEN);
        return ESP_OK;
    }
    body[len] = '\0';

    char *ssid = get_form_field(body, "ssid");
    char *password = get_form_field(body, "password");
    char *token = get_form_field(body, "token");

    if (!ssid || !password || !token || strlen(ssid) == 0) {
        free(ssid); free(password); free(token);
        httpd_resp_set_type(req, "application/json");
        httpd_resp_send(req, "{\"ok\":false,\"error\":\"missing fields\"}", HTTPD_RESP_USE_STRLEN);
        return ESP_OK;
    }

    ESP_LOGI(TAG, "Provisioning via web form: SSID=%s", ssid);

    /* Store credentials directly in the prov context.
     * Do NOT call prov_parse_qr_payload here — it triggers wifi_connect
     * which kills the AP and disconnects the browser before we can respond.
     * Instead, set state to PROVISIONED and let the main loop handle
     * the WiFi transition. */
    bool ok = false;
    if (s_prov_ctx) {
        strncpy(s_prov_ctx->ssid, ssid, sizeof(s_prov_ctx->ssid) - 1);
        s_prov_ctx->ssid[sizeof(s_prov_ctx->ssid) - 1] = '\0';
        strncpy(s_prov_ctx->password, password, sizeof(s_prov_ctx->password) - 1);
        s_prov_ctx->password[sizeof(s_prov_ctx->password) - 1] = '\0';
        strncpy(s_prov_ctx->token, token, sizeof(s_prov_ctx->token) - 1);
        s_prov_ctx->token[sizeof(s_prov_ctx->token) - 1] = '\0';
        s_prov_ctx->state = PROV_STATE_PROVISIONED;
        ok = true;
        printf("Web provisioning: credentials saved, SSID=%s token=%s\n", ssid, token);
    }

    free(ssid); free(password); free(token);

    httpd_resp_set_type(req, "application/json");
    if (ok) {
        httpd_resp_send(req, "{\"ok\":true}", HTTPD_RESP_USE_STRLEN);
    } else {
        httpd_resp_send(req, "{\"ok\":false,\"error\":\"no context\"}", HTTPD_RESP_USE_STRLEN);
    }
    return ESP_OK;
}

bool http_server_start(prov_ctx_t *prov_ctx) {
    if (server != NULL) {
        ESP_LOGW(TAG, "Server already running");
        return true;
    }

    s_prov_ctx = prov_ctx;

    httpd_config_t config = HTTPD_DEFAULT_CONFIG();
    config.server_port = 80;
    config.max_uri_handlers = 8;

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

    httpd_uri_t stream_uri = {
        .uri = "/stream",
        .method = HTTP_GET,
        .handler = stream_handler,
    };
    httpd_register_uri_handler(server, &stream_uri);

    /* Register provisioning endpoints if context provided */
    if (prov_ctx) {
        httpd_uri_t form_uri = {
            .uri = "/",
            .method = HTTP_GET,
            .handler = prov_form_handler,
        };
        httpd_register_uri_handler(server, &form_uri);

        httpd_uri_t submit_uri = {
            .uri = "/provision",
            .method = HTTP_POST,
            .handler = prov_submit_handler,
        };
        httpd_register_uri_handler(server, &submit_uri);

        printf("HTTP server started on port 80 (provisioning mode)\n");
        printf("Endpoints: /, /provision, /capture, /api/status\n");
    } else {
        printf("HTTP server started on port 80\n");
        printf("Endpoints: /api/status, /capture, /stream\n");
    }

    return true;
}

void http_server_stop(void) {
    if (server != NULL) {
        httpd_stop(server);
        server = NULL;
        s_prov_ctx = NULL;
        ESP_LOGI(TAG, "HTTP server stopped");
    }
}
