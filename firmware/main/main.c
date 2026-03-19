#include <stdio.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_netif.h"
#include "esp_event.h"
#include "camera_hal.h"
#include "provisioning.h"
#include "http_server.h"
#include "wifi_prov.h"
#include "sdkconfig.h"

prov_ctx_t prov_ctx;
static bool server_started = false;

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
                } else {
                    printf("Failed to start HTTP server, will retry...\n");
                }
            }
        }
        vTaskDelay(2000 / portTICK_PERIOD_MS);
    }
}
