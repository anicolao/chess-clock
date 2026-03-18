#include "provisioning.h"
#include <string.h>
#include <stdio.h>
#ifdef ESP_PLATFORM
#include "cJSON.h"
#else
#include <cjson/cJSON.h>
#endif
#include "quirc.h"

void prov_init(prov_ctx_t *ctx) {
    if (!ctx) return;
    memset(ctx, 0, sizeof(prov_ctx_t));
    ctx->state = PROV_STATE_UNPROVISIONED;
}

void prov_set_wifi_connect_cb(prov_ctx_t *ctx, bool (*cb)(const char*, const char*)) {
    if (ctx) ctx->wifi_connect = cb;
}

void prov_set_credentials_save_cb(prov_ctx_t *ctx, bool (*cb)(const char*, const char*, const char*)) {
    if (ctx) ctx->credentials_save = cb;
}

void prov_set_mdns_announce_cb(prov_ctx_t *ctx, bool (*cb)(void)) {
    if (ctx) ctx->mdns_announce = cb;
}

bool prov_parse_qr_payload(prov_ctx_t *ctx, const char *json_payload) {
    if (!ctx || !json_payload) {
        if (ctx) ctx->state = PROV_STATE_ERROR_PAYLOAD;
        return false;
    }

    ctx->state = PROV_STATE_PROVISIONING;

    cJSON *json = cJSON_Parse(json_payload);
    if (!json) {
        ctx->state = PROV_STATE_ERROR_PAYLOAD;
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

        if (ctx->wifi_connect && !ctx->wifi_connect(ctx->ssid, ctx->password)) {
            ctx->state = PROV_STATE_ERROR_WIFI;
            cJSON_Delete(json);
            return false;
        }

        if (ctx->credentials_save && !ctx->credentials_save(ctx->ssid, ctx->password, ctx->token)) {
            ctx->state = PROV_STATE_ERROR_NVS;
            cJSON_Delete(json);
            return false;
        }

        if (ctx->mdns_announce && !ctx->mdns_announce()) {
            ctx->state = PROV_STATE_ERROR_MDNS;
            cJSON_Delete(json);
            return false;
        }

        ctx->state = PROV_STATE_PROVISIONED;
        success = true;
    } else {
        ctx->state = PROV_STATE_ERROR_PAYLOAD;
    }

    cJSON_Delete(json);
    return success;
}

prov_state_t prov_get_state(const prov_ctx_t *ctx) {
    if (!ctx) return PROV_STATE_ERROR;
    return ctx->state;
}

bool prov_decode_qr_image(prov_ctx_t *ctx, const uint8_t *image_data, int width, int height) {
    printf("prov_decode_qr_image: width=%d, height=%d\n", width, height);
    if (!ctx || !image_data) return false;

    struct quirc *q = quirc_new();
    if (!q) {
        printf("quirc_new failed\n");
        return false;
    }

    if (quirc_resize(q, width, height) < 0) {
        printf("quirc_resize failed\n");
        quirc_destroy(q);
        return false;
    }

    int w, h;
    uint8_t *q_image = quirc_begin(q, &w, &h);
    printf("quirc_begin returned w=%d, h=%d\n", w, h);
    
    memcpy(q_image, image_data, w * h);
    quirc_end(q);

    int num_codes = quirc_count(q);
    printf("quirc_count: %d\n", num_codes);
    bool success = false;
    
    for (int i = 0; i < num_codes; i++) {
        printf("Processing code %d\n", i);
        struct quirc_code *code = calloc(1, sizeof(struct quirc_code));
        struct quirc_data *data = calloc(1, sizeof(struct quirc_data));
        
        printf("Allocated code=%p, data=%p (sizeof code=%zu, data=%zu)\n", code, data, sizeof(struct quirc_code), sizeof(struct quirc_data));
        
        if (!code || !data) {
            printf("Allocation failed\n");
            if (code) free(code);
            if (data) free(data);
            continue;
        }

        printf("Calling quirc_extract...\n");
        quirc_extract(q, i, code);

        printf("Calling quirc_decode...\n");
        quirc_decode_error_t err = quirc_decode(code, data);
        printf("quirc_decode returned %d\n", err);
        
        if (err == 0) {
            printf("Payload len: %d\n", data->payload_len);
            if (data->payload_len < sizeof(data->payload)) {
                data->payload[data->payload_len] = '\0';
            } else {
                data->payload[sizeof(data->payload) - 1] = '\0';
            }
            
            printf("Payload: %s\n", data->payload);
            success = prov_parse_qr_payload(ctx, (const char *)data->payload);
            printf("prov_parse_qr_payload success=%d\n", success);
            
            printf("Freeing code...\n");
            free(code);
            printf("Freeing data...\n");
            free(data);
            if (success) {
                break;
            }
        } else {
            printf("Freeing code (err)...\n");
            free(code);
            printf("Freeing data (err)...\n");
            free(data);
        }
    }

    printf("Destroying quirc...\n");
    quirc_destroy(q);
    return success;
}
