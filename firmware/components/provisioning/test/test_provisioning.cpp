#include <catch2/catch_test_macros.hpp>
extern "C" {
#include "provisioning.h"
}
#include <string.h>

TEST_CASE("Provisioning Context Initialization", "[provisioning]") {
    prov_ctx_t ctx;
    prov_init(&ctx);
    REQUIRE(ctx.state == PROV_STATE_UNPROVISIONED);
    REQUIRE(ctx.wifi_connect == NULL);
    REQUIRE(ctx.credentials_save == NULL);
    REQUIRE(ctx.mdns_announce == NULL);
}

static int wifi_connect_calls = 0;
static int credentials_save_calls = 0;
static int mdns_announce_calls = 0;

static bool mock_wifi_connect(const char* ssid, const char* pass) {
    wifi_connect_calls++;
    return true;
}

static bool mock_credentials_save(const char* ssid, const char* pass, const char* token) {
    credentials_save_calls++;
    return true;
}

static bool mock_mdns_announce(void) {
    mdns_announce_calls++;
    return true;
}

TEST_CASE("Successful QR Payload Parsing", "[provisioning]") {
    prov_ctx_t ctx;
    prov_init(&ctx);

    const char* valid_json = "{\"ssid\":\"MyNetwork\",\"pass\":\"Secret123\",\"token\":\"abc123xyz\"}";
    bool success = prov_parse_qr_payload(&ctx, valid_json);

    REQUIRE(success == true);
    REQUIRE(ctx.state == PROV_STATE_PROVISIONED);
    REQUIRE(strcmp(ctx.ssid, "MyNetwork") == 0);
    REQUIRE(strcmp(ctx.password, "Secret123") == 0);
    REQUIRE(strcmp(ctx.token, "abc123xyz") == 0);
}

TEST_CASE("Successful QR Payload Parsing with Callbacks", "[provisioning]") {
    prov_ctx_t ctx;
    prov_init(&ctx);

    wifi_connect_calls = 0;
    credentials_save_calls = 0;
    mdns_announce_calls = 0;

    prov_set_wifi_connect_cb(&ctx, mock_wifi_connect);
    prov_set_credentials_save_cb(&ctx, mock_credentials_save);
    prov_set_mdns_announce_cb(&ctx, mock_mdns_announce);

    const char* valid_json = "{\"ssid\":\"MyNetwork\",\"pass\":\"Secret123\",\"token\":\"abc123xyz\"}";
    bool success = prov_parse_qr_payload(&ctx, valid_json);

    REQUIRE(success == true);
    REQUIRE(ctx.state == PROV_STATE_PROVISIONED);
    REQUIRE(wifi_connect_calls == 1);
    REQUIRE(credentials_save_calls == 1);
    REQUIRE(mdns_announce_calls == 1);
}

TEST_CASE("Failed Callback Propagation - WiFi", "[provisioning]") {
    prov_ctx_t ctx;
    prov_init(&ctx);

    auto mock_fail = [](const char* s, const char* p) -> bool { return false; };
    prov_set_wifi_connect_cb(&ctx, mock_fail);

    const char* valid_json = "{\"ssid\":\"MyNetwork\",\"pass\":\"Secret123\",\"token\":\"abc123xyz\"}";
    bool success = prov_parse_qr_payload(&ctx, valid_json);

    REQUIRE(success == false);
    REQUIRE(ctx.state == PROV_STATE_ERROR_WIFI);
}

TEST_CASE("Failed Callback Propagation - NVS", "[provisioning]") {
    prov_ctx_t ctx;
    prov_init(&ctx);

    prov_set_wifi_connect_cb(&ctx, [](const char*, const char*) { return true; });
    prov_set_credentials_save_cb(&ctx, [](const char*, const char*, const char*) { return false; });

    const char* valid_json = "{\"ssid\":\"MyNetwork\",\"pass\":\"Secret123\",\"token\":\"abc123xyz\"}";
    bool success = prov_parse_qr_payload(&ctx, valid_json);

    REQUIRE(success == false);
    REQUIRE(ctx.state == PROV_STATE_ERROR_NVS);
}

TEST_CASE("Failed Callback Propagation - mDNS", "[provisioning]") {
    prov_ctx_t ctx;
    prov_init(&ctx);

    prov_set_wifi_connect_cb(&ctx, [](const char*, const char*) { return true; });
    prov_set_credentials_save_cb(&ctx, [](const char*, const char*, const char*) { return true; });
    prov_set_mdns_announce_cb(&ctx, []() { return false; });

    const char* valid_json = "{\"ssid\":\"MyNetwork\",\"pass\":\"Secret123\",\"token\":\"abc123xyz\"}";
    bool success = prov_parse_qr_payload(&ctx, valid_json);

    REQUIRE(success == false);
    REQUIRE(ctx.state == PROV_STATE_ERROR_MDNS);
}

TEST_CASE("Failed QR Payload Parsing - Invalid JSON", "[provisioning]") {
    prov_ctx_t ctx;
    prov_init(&ctx);

    const char* invalid_json = "{bad_json:";
    bool success = prov_parse_qr_payload(&ctx, invalid_json);

    REQUIRE(success == false);
    REQUIRE(ctx.state == PROV_STATE_ERROR_PAYLOAD);
}

TEST_CASE("Failed QR Payload Parsing - Missing Fields", "[provisioning]") {
    prov_ctx_t ctx;
    prov_init(&ctx);

    const char* missing_json = "{\"ssid\":\"MyNetwork\"}";
    bool success = prov_parse_qr_payload(&ctx, missing_json);

    REQUIRE(success == false);
    REQUIRE(ctx.state == PROV_STATE_ERROR_PAYLOAD);
}

TEST_CASE("Edge Cases - Null Pointers", "[provisioning]") {
    prov_ctx_t ctx;
    prov_init(&ctx);

    REQUIRE(prov_parse_qr_payload(NULL, "{}") == false);
    REQUIRE(prov_parse_qr_payload(&ctx, NULL) == false);
    REQUIRE(ctx.state == PROV_STATE_ERROR_PAYLOAD);
}

TEST_CASE("Get State Helper", "[provisioning]") {
    prov_ctx_t ctx;
    prov_init(&ctx);
    REQUIRE(prov_get_state(&ctx) == PROV_STATE_UNPROVISIONED);
    REQUIRE(prov_get_state(NULL) == PROV_STATE_ERROR);
}

#include "qr_test_image.h"
#include <iostream>

TEST_CASE("Successful QR Decoding from Image", "[provisioning]") {
    prov_ctx_t ctx;
    prov_init(&ctx);

    bool success = prov_decode_qr_image(&ctx, qr_test_image, qr_test_image_width, qr_test_image_height);

    if (!success) {
        std::cout << "QR decoding failed" << std::endl;
    } else {
        std::cout << "QR decoded! SSID: " << ctx.ssid << ", Pass: " << ctx.password << ", Token: " << ctx.token << std::endl;
    }

    REQUIRE(success == true);
    REQUIRE(ctx.state == PROV_STATE_PROVISIONED);
    REQUIRE(strcmp(ctx.ssid, "MyTestWiFi") == 0);
    REQUIRE(strcmp(ctx.password, "SuperSecret123") == 0);
    REQUIRE(strlen(ctx.token) > 0);
}
