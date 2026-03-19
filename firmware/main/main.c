#include <stdio.h>
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/event_groups.h"
#include "esp_netif.h"
#include "esp_event.h"
#include "esp_eth.h"
#include "esp_log.h"
#include "camera_hal.h"
#include "provisioning.h"
#include "http_server.h"
#include "wifi_prov.h"
#include "mdns.h"
#include "sdkconfig.h"

#if CONFIG_ETH_USE_OPENETH
#include "esp_eth_mac_openeth.h"
#endif

static const char *TAG = "main";

prov_ctx_t prov_ctx;
static bool server_started = false;
static bool self_test_done = false;

#if CONFIG_ETH_USE_OPENETH
#define ETH_GOT_IP_BIT BIT0
static EventGroupHandle_t s_eth_event_group;
static esp_ip4_addr_t s_device_ip;

static void eth_event_handler(void *arg, esp_event_base_t event_base,
                              int32_t event_id, void *event_data) {
    if (event_base == IP_EVENT && event_id == IP_EVENT_ETH_GOT_IP) {
        ip_event_got_ip_t *event = (ip_event_got_ip_t *)event_data;
        s_device_ip = event->ip_info.ip;
        ESP_LOGI(TAG, "Ethernet got IP: " IPSTR, IP2STR(&event->ip_info.ip));
        xEventGroupSetBits(s_eth_event_group, ETH_GOT_IP_BIT);
    }
}

static bool init_openeth(void) {
    s_eth_event_group = xEventGroupCreate();

    esp_event_handler_instance_t ip_handler;
    esp_event_handler_instance_register(IP_EVENT, IP_EVENT_ETH_GOT_IP,
                                        &eth_event_handler, NULL, &ip_handler);

    eth_mac_config_t mac_config = ETH_MAC_DEFAULT_CONFIG();
    esp_eth_mac_t *mac = esp_eth_mac_new_openeth(&mac_config);
    if (!mac) {
        ESP_LOGE(TAG, "Failed to create OpenETH MAC");
        return false;
    }

    eth_phy_config_t phy_config = ETH_PHY_DEFAULT_CONFIG();
    esp_eth_phy_t *phy = esp_eth_phy_new_dp83848(&phy_config);

    esp_eth_config_t eth_config = ETH_DEFAULT_CONFIG(mac, phy);
    esp_eth_handle_t eth_handle = NULL;
    if (esp_eth_driver_install(&eth_config, &eth_handle) != ESP_OK) {
        ESP_LOGE(TAG, "Ethernet driver install failed");
        return false;
    }

    esp_netif_config_t netif_cfg = ESP_NETIF_DEFAULT_ETH();
    esp_netif_t *eth_netif = esp_netif_new(&netif_cfg);
    esp_netif_attach(eth_netif, esp_eth_new_netif_glue(eth_handle));

    esp_eth_start(eth_handle);
    printf("OpenETH: Waiting for IP address...\n");

    EventBits_t bits = xEventGroupWaitBits(s_eth_event_group, ETH_GOT_IP_BIT,
                                           pdFALSE, pdFALSE, pdMS_TO_TICKS(10000));
    if (!(bits & ETH_GOT_IP_BIT)) {
        ESP_LOGE(TAG, "Timeout waiting for Ethernet IP");
        return false;
    }

    printf("OpenETH: Got IP " IPSTR "\n", IP2STR(&s_device_ip));
    return true;
}
#endif

#ifndef CONFIG_USE_REAL_WIFI_PROV
static bool wifi_connect_mock(const char *ssid, const char *password) {
    printf("Connecting to Wi-Fi SSID: %s\n", ssid);
    return true;
}

static bool credentials_save_mock(const char *ssid, const char *password, const char *token) {
    printf("Saving credentials to NVS: token=%s\n", token);
    return true;
}

static bool mdns_announce_mock(void) {
    printf("Announcing via mDNS...\n");
    return true;
}
#endif

static void run_hardware_self_test(void) {
    printf("=== Hardware Integration Self-Test ===\n");

    /* Test 1: NVS save/load roundtrip */
    printf("TEST NVS: Saving test credentials...\n");
    bool save_ok = wifi_prov_save_credentials("TestSSID", "TestPass123", "tok_selftest");
    if (save_ok) {
        printf("TEST NVS: Save OK\n");
    } else {
        printf("TEST NVS: Save FAILED\n");
    }

    char loaded_ssid[64] = {0};
    char loaded_pass[64] = {0};
    char loaded_token[64] = {0};
    bool load_ok = wifi_prov_load_credentials(loaded_ssid, sizeof(loaded_ssid),
                                              loaded_pass, sizeof(loaded_pass),
                                              loaded_token, sizeof(loaded_token));
    if (load_ok &&
        strcmp(loaded_ssid, "TestSSID") == 0 &&
        strcmp(loaded_pass, "TestPass123") == 0 &&
        strcmp(loaded_token, "tok_selftest") == 0) {
        printf("TEST NVS: Load roundtrip OK (ssid=%s, token=%s)\n", loaded_ssid, loaded_token);
    } else {
        printf("TEST NVS: Load roundtrip FAILED (ssid=%s, token=%s)\n", loaded_ssid, loaded_token);
    }

#if CONFIG_ETH_USE_OPENETH
    /* Test 2: Initialize QEMU Ethernet for network tests */
    printf("TEST NET: Initializing OpenETH...\n");
    bool net_ok = init_openeth();
    if (!net_ok) {
        printf("TEST NET: OpenETH init FAILED (no QEMU networking?)\n");
        printf("TEST mDNS: SKIPPED (no network)\n");
        printf("=== Self-Test Complete ===\n");
        return;
    }
    printf("TEST NET: OpenETH OK\n");

    /* Test 3: mDNS registration + discovery via network */
    printf("TEST mDNS: Registering service...\n");
    bool mdns_ok = wifi_prov_mdns_announce();
    if (!mdns_ok) {
        printf("TEST mDNS: Service registration FAILED\n");
        printf("=== Self-Test Complete ===\n");
        return;
    }
    printf("TEST mDNS: Service registered OK (chess-cam.local, _chessclock._tcp)\n");

    /* Verify hostname is registered in mDNS */
    printf("TEST mDNS: Checking hostname registration...\n");
    if (mdns_hostname_exists("chess-cam")) {
        printf("TEST mDNS: Hostname 'chess-cam' registered OK\n");
    } else {
        printf("TEST mDNS: Hostname 'chess-cam' NOT FOUND\n");
    }

    /* Look up our own service via the local mDNS state */
    printf("TEST mDNS: Looking up _chessclock._tcp service...\n");
    mdns_result_t *results = NULL;
    esp_err_t err = mdns_lookup_selfhosted_service(NULL, "_chessclock", "_tcp", 1, &results);
    if (err == ESP_OK && results) {
        const char *found_host = results->hostname ? results->hostname : "?";
        uint16_t found_port = results->port;
        printf("TEST mDNS: Service discovered: %s.local port=%u\n", found_host, found_port);

        bool host_ok = (strcmp(found_host, "chess-cam") == 0);
        bool port_ok = (found_port == 80);

        if (host_ok && port_ok) {
            printf("TEST mDNS: Discovery OK (host=%s, port=%u, device_ip=" IPSTR ")\n",
                   found_host, found_port, IP2STR(&s_device_ip));
        } else {
            printf("TEST mDNS: Discovery MISMATCH (host=%s, port=%u)\n",
                   found_host, found_port);
        }
        mdns_query_results_free(results);
    } else {
        printf("TEST mDNS: Service lookup FAILED (%s)\n", esp_err_to_name(err));
    }
#else
    /* No network available — just test mDNS API */
    printf("TEST mDNS: Registering service...\n");
    bool mdns_ok = wifi_prov_mdns_announce();
    if (mdns_ok) {
        printf("TEST mDNS: Service registered OK (chess-cam.local, _chessclock._tcp)\n");
    } else {
        printf("TEST mDNS: Service registration FAILED\n");
    }
#endif

    printf("=== Self-Test Complete ===\n");
}

void app_main(void)
{
    printf("ESP32S3 initialization complete.\n");

    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());

    prov_init(&prov_ctx);
#ifdef CONFIG_USE_REAL_WIFI_PROV
    prov_set_wifi_connect_cb(&prov_ctx, wifi_prov_connect);
    prov_set_credentials_save_cb(&prov_ctx, wifi_prov_save_credentials);
    prov_set_mdns_announce_cb(&prov_ctx, wifi_prov_mdns_announce);
#else
    prov_set_wifi_connect_cb(&prov_ctx, wifi_connect_mock);
    prov_set_credentials_save_cb(&prov_ctx, credentials_save_mock);
    prov_set_mdns_announce_cb(&prov_ctx, mdns_announce_mock);
#endif

    if (!camera_hal_init()) {
        printf("Failed to initialize camera HAL\n");
        return;
    }

    while (1) {
        if (prov_get_state(&prov_ctx) != PROV_STATE_PROVISIONED) {
            printf("Requesting camera frame...\n");
            camera_frame_t *frame = camera_hal_take_picture();
            if (frame) {
                printf("Frame received: %dx%d, len=%zu\n", frame->width, frame->height, frame->len);
                bool success = prov_decode_qr_image(&prov_ctx, frame->buf, frame->width, frame->height);
                if (success) {
                    printf("QR code decoded successfully!\n");
                    printf("Transitioned to PROV_STATE_PROVISIONED\n");
                } else {
                    printf("Failed to decode QR code. State: %d\n", prov_get_state(&prov_ctx));
                }
                camera_hal_return_picture(frame);
            } else {
                printf("Failed to acquire frame\n");
            }
        } else {
            if (!server_started) {
                printf("Device is provisioned. Starting HTTP server...\n");
                if (http_server_start()) {
                    server_started = true;
                    /* Verify camera-to-HTTP pipeline is wired correctly */
                    camera_frame_t *test_frame = camera_hal_take_picture();
                    if (test_frame) {
                        printf("Capture endpoint ready: %dx%d, %zu bytes available\n",
                               test_frame->width, test_frame->height, test_frame->len);
                        camera_hal_return_picture(test_frame);
                    }
                    /* Run hardware integration self-tests */
                    run_hardware_self_test();
                    self_test_done = true;
                } else {
                    printf("Failed to start HTTP server, will retry...\n");
                }
            }
        }
        vTaskDelay(2000 / portTICK_PERIOD_MS);
    }
}
