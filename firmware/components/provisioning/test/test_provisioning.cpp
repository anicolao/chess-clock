#include <catch2/catch_test_macros.hpp>
extern "C" {
#include "provisioning.h"
}
#include <string.h>

TEST_CASE("Provisioning Context Initialization", "[provisioning]") {
    prov_ctx_t ctx;
    prov_init(&ctx);
    REQUIRE(ctx.state == PROV_STATE_UNPROVISIONED);
}

TEST_CASE("Successful QR Payload Parsing", "[provisioning]") {
    prov_ctx_t ctx;
    prov_init(&ctx);

    const char* valid_json = "{\"ssid\":\"MyNetwork\",\"pass\":\"Secret123\",\"token\":\"abc123xyz\"}";
    bool success = prov_parse_qr_payload(&ctx, valid_json);

    REQUIRE(success == true);
    REQUIRE(ctx.state == PROV_STATE_CONNECTED);
    REQUIRE(strcmp(ctx.ssid, "MyNetwork") == 0);
    REQUIRE(strcmp(ctx.password, "Secret123") == 0);
    REQUIRE(strcmp(ctx.token, "abc123xyz") == 0);
}

TEST_CASE("Failed QR Payload Parsing - Invalid JSON", "[provisioning]") {
    prov_ctx_t ctx;
    prov_init(&ctx);

    const char* invalid_json = "{bad_json:";
    bool success = prov_parse_qr_payload(&ctx, invalid_json);

    REQUIRE(success == false);
    REQUIRE(ctx.state == PROV_STATE_ERROR);
}

TEST_CASE("Failed QR Payload Parsing - Missing Fields", "[provisioning]") {
    prov_ctx_t ctx;
    prov_init(&ctx);

    const char* missing_json = "{\"ssid\":\"MyNetwork\"}";
    bool success = prov_parse_qr_payload(&ctx, missing_json);

    REQUIRE(success == false);
    REQUIRE(ctx.state == PROV_STATE_ERROR);
}

TEST_CASE("Edge Cases - Null Pointers", "[provisioning]") {
    prov_ctx_t ctx;
    prov_init(&ctx);

    REQUIRE(prov_parse_qr_payload(NULL, "{}") == false);
    REQUIRE(prov_parse_qr_payload(&ctx, NULL) == false);
    REQUIRE(ctx.state == PROV_STATE_ERROR);
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
    REQUIRE(ctx.state == PROV_STATE_CONNECTED);
    REQUIRE(strcmp(ctx.ssid, "MyTestWiFi") == 0);
    REQUIRE(strcmp(ctx.password, "SuperSecret123") == 0);
    REQUIRE(strlen(ctx.token) > 0);
}
