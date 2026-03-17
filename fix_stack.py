import sys

file_path = "firmware/components/provisioning/src/provisioning.c"
with open(file_path, "r") as f:
    content = f.read()

new_func = """bool prov_decode_qr_image(prov_ctx_t *ctx, const uint8_t *image_data, int width, int height) {
    if (!ctx || !image_data) return false;

    struct quirc *q = quirc_new();
    if (!q) return false;

    if (quirc_resize(q, width, height) < 0) {
        quirc_destroy(q);
        return false;
    }

    int w, h;
    uint8_t *q_image = quirc_begin(q, &w, &h);
    memcpy(q_image, image_data, w * h);
    quirc_end(q);

    int num_codes = quirc_count(q);
    bool success = false;
    for (int i = 0; i < num_codes; i++) {
        struct quirc_code *code = malloc(sizeof(struct quirc_code));
        struct quirc_data *data = malloc(sizeof(struct quirc_data));
        
        if (!code || !data) {
            if (code) free(code);
            if (data) free(data);
            continue;
        }

        quirc_extract(q, i, code);

        quirc_decode_error_t err = quirc_decode(code, data);
        if (err == 0) {
            success = prov_parse_qr_payload(ctx, (const char *)data->payload);
            free(code);
            free(data);
            if (success) {
                break;
            }
        } else {
            free(code);
            free(data);
        }
    }

    quirc_destroy(q);
    return success;
}
"""

import re
# Find the start of the prov_decode_qr_image function and replace to the end
start_idx = content.find("bool prov_decode_qr_image(")
if start_idx != -1:
    content = content[:start_idx] + new_func
    with open(file_path, "w") as f:
        f.write(content)
    print("Patched successfully")
else:
    print("Could not find function")

