#include "provisioning.h"
#include <string.h>
#include <stdio.h>
#include <cjson/cJSON.h>
#include "quirc.h"

void prov_init(prov_ctx_t *ctx) {
    if (!ctx) return;
    memset(ctx, 0, sizeof(prov_ctx_t));
    ctx->state = PROV_STATE_UNPROVISIONED;
}

bool prov_parse_qr_payload(prov_ctx_t *ctx, const char *json_payload) {
    if (!ctx || !json_payload) {
        if (ctx) ctx->state = PROV_STATE_ERROR;
        return false;
    }

    ctx->state = PROV_STATE_PROVISIONING;

    cJSON *json = cJSON_Parse(json_payload);
    if (!json) {
        ctx->state = PROV_STATE_ERROR;
        return false;
    }

    cJSON *ssid = cJSON_GetObjectItemCaseSensitive(json, "ssid");
    cJSON *password = cJSON_GetObjectItemCaseSensitive(json, "pass");
    cJSON *token = cJSON_GetObjectItemCaseSensitive(json, "token");

    bool success = false;
    if (cJSON_IsString(ssid) && (ssid->valuestring != NULL) &&
        cJSON_IsString(password) && (password->valuestring != NULL) &&
        cJSON_IsString(token) && (token->valuestring != NULL)) {
        
        strncpy(ctx->ssid, ssid->valuestring, sizeof(ctx->ssid) - 1);
        ctx->ssid[sizeof(ctx->ssid) - 1] = '\0';
        
        strncpy(ctx->password, password->valuestring, sizeof(ctx->password) - 1);
        ctx->password[sizeof(ctx->password) - 1] = '\0';
        
        strncpy(ctx->token, token->valuestring, sizeof(ctx->token) - 1);
        ctx->token[sizeof(ctx->token) - 1] = '\0';

        ctx->state = PROV_STATE_CONNECTED;
        success = true;
    } else {
        ctx->state = PROV_STATE_ERROR;
    }

    cJSON_Delete(json);
    return success;
}

prov_state_t prov_get_state(const prov_ctx_t *ctx) {
    if (!ctx) return PROV_STATE_ERROR;
    return ctx->state;
}

bool prov_decode_qr_image(prov_ctx_t *ctx, const uint8_t *image_data, int width, int height) {
    if (!ctx || !image_data) return false;

    struct quirc *q = quirc_new();
    if (!q) return false;

    if (quirc_resize(q, width, height) < 0) {
        quirc_destroy(q);
        return false;
    }

    int w, h;
    uint8_t *q_image = quirc_begin(q, &w, &h);
    memcpy(q_image, image_data, w * h);
    quirc_end(q);

    int num_codes = quirc_count(q);
    for (int i = 0; i < num_codes; i++) {
        struct quirc_code code;
        struct quirc_data data;

        quirc_extract(q, i, &code);

        quirc_decode_error_t err = quirc_decode(&code, &data);
        if (err == 0) {
            bool success = prov_parse_qr_payload(ctx, (const char *)data.payload);
            quirc_destroy(q);
            return success;
        } else {
        }
    }

    quirc_destroy(q);
    return false;
}
