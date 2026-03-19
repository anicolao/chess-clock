#ifndef HTTP_SERVER_H
#define HTTP_SERVER_H

#include <stdbool.h>

/**
 * Start the HTTP server after provisioning completes.
 * Registers /api/status and /capture endpoints.
 * Returns true on success, false on failure.
 */
bool http_server_start(void);

/**
 * Stop the HTTP server.
 */
void http_server_stop(void);

#endif // HTTP_SERVER_H
