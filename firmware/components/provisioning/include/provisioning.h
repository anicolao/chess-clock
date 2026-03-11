#ifndef PROVISIONING_H
#define PROVISIONING_H

#include <stdbool.h>

typedef enum {
    PROV_STATE_UNPROVISIONED,
    PROV_STATE_PROVISIONING,
    PROV_STATE_CONNECTED,
    PROV_STATE_ERROR
} prov_state_t;

typedef struct {
    char ssid[64];
    char password[64];
    char token[64];
    prov_state_t state;
} prov_ctx_t;

void prov_init(prov_ctx_t *ctx);
bool prov_parse_qr_payload(prov_ctx_t *ctx, const char *json_payload);
prov_state_t prov_get_state(const prov_ctx_t *ctx);

#endif
