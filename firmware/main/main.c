#include <stdio.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "camera_hal.h"
#include "provisioning.h"

prov_ctx_t prov_ctx;

bool wifi_connect_mock(const char *ssid, const char *password) {
    printf("Connecting to Wi-Fi SSID: %s\n", ssid);
    return true;
}

bool credentials_save_mock(const char *ssid, const char *password, const char *token) {
    printf("Saving credentials to NVS: token=%s\n", token);
    return true;
}

bool mdns_announce_mock(void) {
    printf("Announcing via mDNS...\n");
    return true;
}

void app_main(void)
{
    printf("ESP32S3 initialization complete.\n");

    prov_init(&prov_ctx);
    prov_set_wifi_connect_cb(&prov_ctx, wifi_connect_mock);
    prov_set_credentials_save_cb(&prov_ctx, credentials_save_mock);
    prov_set_mdns_announce_cb(&prov_ctx, mdns_announce_mock);

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
            printf("Device is provisioned. Idling...\n");
        }
        vTaskDelay(2000 / portTICK_PERIOD_MS);
    }
}
