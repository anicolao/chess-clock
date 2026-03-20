#ifndef WIFI_PROV_H
#define WIFI_PROV_H

#include <stdbool.h>
#include <stddef.h>

/**
 * Start WiFi in AP mode for provisioning.
 * Creates an open AP named "ChessCam-XXXX" (last 2 bytes of MAC).
 * Initializes NVS and WiFi if not already done.
 */
bool wifi_prov_ap_start(void);

/**
 * Stop AP mode and deinit WiFi.
 */
void wifi_prov_ap_stop(void);

/**
 * Real WiFi STA connection callback for provisioning.
 * Stops AP mode if running, then connects to the given AP.
 * Blocks until connected or timeout (10s).
 */
bool wifi_prov_connect(const char *ssid, const char *password);

/**
 * Real NVS credential storage callback for provisioning.
 * Stores ssid, password, and pairing token in NVS namespace "prov".
 */
bool wifi_prov_save_credentials(const char *ssid, const char *password, const char *token);

/**
 * Real mDNS announcement callback for provisioning.
 * Announces _chessclock._tcp service via mDNS as chess-cam.local.
 */
bool wifi_prov_mdns_announce(void);

/**
 * Load previously saved credentials from NVS.
 * Returns true if credentials were found and loaded into the output buffers.
 */
bool wifi_prov_load_credentials(char *ssid, size_t ssid_len,
                                char *password, size_t pass_len,
                                char *token, size_t token_len);

#endif // WIFI_PROV_H
