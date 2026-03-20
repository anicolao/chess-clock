#ifndef HTTP_SERVER_H
#define HTTP_SERVER_H

#include <stdbool.h>
#include "provisioning.h"

/**
 * Start the HTTP server.
 * If prov_ctx is non-NULL, registers provisioning endpoints (/, /provision).
 * Always registers /api/status and /capture.
 * Pass NULL after provisioning to restart in normal mode.
 */
bool http_server_start(prov_ctx_t *prov_ctx);

/**
 * Stop the HTTP server.
 */
void http_server_stop(void);

#endif // HTTP_SERVER_H
