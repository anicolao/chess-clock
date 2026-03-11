#include "provisioning.h"
#include <string.h>
#include <cjson/cJSON.h>

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
