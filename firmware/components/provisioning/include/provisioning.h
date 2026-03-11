#ifndef PROVISIONING_H
#define PROVISIONING_H

#include <stdbool.h>
#include <stdint.h>

typedef enum {
    PROV_STATE_UNPROVISIONED,
    PROV_STATE_PROVISIONING,
    PROV_STATE_PROVISIONED,
    PROV_STATE_ERROR_PAYLOAD,
    PROV_STATE_ERROR_WIFI,
    PROV_STATE_ERROR_NVS,
    PROV_STATE_ERROR_MDNS,
    PROV_STATE_ERROR
} prov_state_t;

typedef struct {
    char ssid[64];
    char password[64];
    char token[64];
    prov_state_t state;
    
    // Callbacks for step 5 hardware abstractions
    bool (*wifi_connect)(const char *ssid, const char *password);
    bool (*credentials_save)(const char *ssid, const char *password, const char *token);
    bool (*mdns_announce)(void);
} prov_ctx_t;

void prov_init(prov_ctx_t *ctx);
bool prov_parse_qr_payload(prov_ctx_t *ctx, const char *json_payload);
prov_state_t prov_get_state(const prov_ctx_t *ctx);
bool prov_decode_qr_image(prov_ctx_t *ctx, const uint8_t *image_data, int width, int height);

void prov_set_wifi_connect_cb(prov_ctx_t *ctx, bool (*cb)(const char*, const char*));
void prov_set_credentials_save_cb(prov_ctx_t *ctx, bool (*cb)(const char*, const char*, const char*));
void prov_set_mdns_announce_cb(prov_ctx_t *ctx, bool (*cb)(void));

#endif
