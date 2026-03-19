idf_component_register(SRCS "main.c"
                    INCLUDE_DIRS "."
                    REQUIRES http_server
                    PRIV_REQUIRES camera_hal provisioning wifi_prov esp_netif esp_event esp_eth)
