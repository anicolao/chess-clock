#include "wifi_prov.h"
#include <string.h>
#include <stdio.h>
#include <esp_wifi.h>
#include <esp_event.h>
#include <esp_log.h>
#include <esp_netif.h>
#include <nvs_flash.h>
#include <nvs.h>
#include <mdns.h>
#include <freertos/FreeRTOS.h>
#include <freertos/event_groups.h>

static const char *TAG = "wifi_prov";
#define NVS_NAMESPACE "prov"
#define WIFI_CONNECTED_BIT BIT0
#define WIFI_FAIL_BIT      BIT1

static EventGroupHandle_t s_wifi_event_group;

static void wifi_event_handler(void *arg, esp_event_base_t event_base,
                               int32_t event_id, void *event_data) {
    if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
    } else if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_DISCONNECTED) {
        xEventGroupSetBits(s_wifi_event_group, WIFI_FAIL_BIT);
    } else if (event_base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t *event = (ip_event_got_ip_t *)event_data;
        ESP_LOGI(TAG, "Got IP: " IPSTR, IP2STR(&event->ip_info.ip));
        xEventGroupSetBits(s_wifi_event_group, WIFI_CONNECTED_BIT);
    }
}

bool wifi_prov_connect(const char *ssid, const char *password) {
    if (!ssid || !password) return false;

    s_wifi_event_group = xEventGroupCreate();

    esp_netif_create_default_wifi_sta();

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    esp_err_t err = esp_wifi_init(&cfg);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "WiFi init failed: %s", esp_err_to_name(err));
        vEventGroupDelete(s_wifi_event_group);
        return false;
    }

    esp_event_handler_instance_t instance_any_id;
    esp_event_handler_instance_t instance_got_ip;
    esp_event_handler_instance_register(WIFI_EVENT, ESP_EVENT_ANY_ID,
                                        &wifi_event_handler, NULL, &instance_any_id);
    esp_event_handler_instance_register(IP_EVENT, IP_EVENT_STA_GOT_IP,
                                        &wifi_event_handler, NULL, &instance_got_ip);

    wifi_config_t wifi_config = {0};
    strncpy((char *)wifi_config.sta.ssid, ssid, sizeof(wifi_config.sta.ssid) - 1);
    strncpy((char *)wifi_config.sta.password, password, sizeof(wifi_config.sta.password) - 1);

    esp_wifi_set_mode(WIFI_MODE_STA);
    esp_wifi_set_config(WIFI_IF_STA, &wifi_config);
    esp_wifi_start();

    printf("Connecting to Wi-Fi SSID: %s\n", ssid);

    EventBits_t bits = xEventGroupWaitBits(s_wifi_event_group,
                                           WIFI_CONNECTED_BIT | WIFI_FAIL_BIT,
                                           pdFALSE, pdFALSE,
                                           pdMS_TO_TICKS(10000));

    esp_event_handler_instance_unregister(IP_EVENT, IP_EVENT_STA_GOT_IP, instance_got_ip);
    esp_event_handler_instance_unregister(WIFI_EVENT, ESP_EVENT_ANY_ID, instance_any_id);
    vEventGroupDelete(s_wifi_event_group);

    if (bits & WIFI_CONNECTED_BIT) {
        ESP_LOGI(TAG, "Connected to AP SSID: %s", ssid);
        return true;
    }

    ESP_LOGE(TAG, "Failed to connect to SSID: %s", ssid);
    return false;
}

bool wifi_prov_save_credentials(const char *ssid, const char *password, const char *token) {
    if (!ssid || !password || !token) return false;

    esp_err_t err = nvs_flash_init();
    if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        nvs_flash_erase();
        err = nvs_flash_init();
    }
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "NVS flash init failed: %s", esp_err_to_name(err));
        return false;
    }

    nvs_handle_t handle;
    err = nvs_open(NVS_NAMESPACE, NVS_READWRITE, &handle);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "NVS open failed: %s", esp_err_to_name(err));
        return false;
    }

    bool success = true;
    if (nvs_set_str(handle, "ssid", ssid) != ESP_OK) success = false;
    if (nvs_set_str(handle, "password", password) != ESP_OK) success = false;
    if (nvs_set_str(handle, "token", token) != ESP_OK) success = false;
    if (success) {
        err = nvs_commit(handle);
        if (err != ESP_OK) success = false;
    }

    nvs_close(handle);

    if (success) {
        printf("Saving credentials to NVS: token=%s\n", token);
    } else {
        ESP_LOGE(TAG, "Failed to save credentials to NVS");
    }

    return success;
}

bool wifi_prov_mdns_announce(void) {
    esp_err_t err = mdns_init();
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "mDNS init failed: %s", esp_err_to_name(err));
        return false;
    }

    mdns_hostname_set("chess-cam");
    mdns_instance_name_set("Chess Camera");

    err = mdns_service_add("Chess Camera", "_chessclock", "_tcp", 80, NULL, 0);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "mDNS service add failed: %s", esp_err_to_name(err));
        return false;
    }

    printf("Announcing via mDNS...\n");
    ESP_LOGI(TAG, "mDNS: chess-cam.local, service _chessclock._tcp on port 80");
    return true;
}

bool wifi_prov_load_credentials(char *ssid, size_t ssid_len,
                                char *password, size_t pass_len,
                                char *token, size_t token_len) {
    esp_err_t err = nvs_flash_init();
    if (err != ESP_OK) return false;

    nvs_handle_t handle;
    err = nvs_open(NVS_NAMESPACE, NVS_READONLY, &handle);
    if (err != ESP_OK) return false;

    bool success = true;
    if (nvs_get_str(handle, "ssid", ssid, &ssid_len) != ESP_OK) success = false;
    if (nvs_get_str(handle, "password", password, &pass_len) != ESP_OK) success = false;
    if (nvs_get_str(handle, "token", token, &token_len) != ESP_OK) success = false;

    nvs_close(handle);
    return success;
}
