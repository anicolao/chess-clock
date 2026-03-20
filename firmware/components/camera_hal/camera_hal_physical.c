#include "camera_hal.h"
#include "esp_camera.h"
#include "esp_log.h"

static const char *TAG = "camera_hal";

/* XIAO ESP32S3 Sense camera pin definitions (OV2640) */
#define CAM_PIN_PWDN  -1
#define CAM_PIN_RESET -1
#define CAM_PIN_XCLK  10
#define CAM_PIN_SIOD  40
#define CAM_PIN_SIOC  39

#define CAM_PIN_D7    48
#define CAM_PIN_D6    11
#define CAM_PIN_D5    12
#define CAM_PIN_D4    14
#define CAM_PIN_D3    16
#define CAM_PIN_D2    18
#define CAM_PIN_D1    17
#define CAM_PIN_D0    15

#define CAM_PIN_VSYNC 38
#define CAM_PIN_HREF  47
#define CAM_PIN_PCLK  13

static camera_frame_t hal_frame;
static camera_fb_t *current_fb = NULL;
static camera_format_t current_format = CAMERA_FMT_GRAYSCALE;

/* Shared pin config used by both init and set_format */
static camera_config_t make_camera_config(pixformat_t pf, framesize_t fs, int fb_count) {
    camera_config_t config = {
        .pin_pwdn = CAM_PIN_PWDN,
        .pin_reset = CAM_PIN_RESET,
        .pin_xclk = CAM_PIN_XCLK,
        .pin_sccb_sda = CAM_PIN_SIOD,
        .pin_sccb_scl = CAM_PIN_SIOC,
        .pin_d7 = CAM_PIN_D7,
        .pin_d6 = CAM_PIN_D6,
        .pin_d5 = CAM_PIN_D5,
        .pin_d4 = CAM_PIN_D4,
        .pin_d3 = CAM_PIN_D3,
        .pin_d2 = CAM_PIN_D2,
        .pin_d1 = CAM_PIN_D1,
        .pin_d0 = CAM_PIN_D0,
        .pin_vsync = CAM_PIN_VSYNC,
        .pin_href = CAM_PIN_HREF,
        .pin_pclk = CAM_PIN_PCLK,
        .xclk_freq_hz = 10000000,            /* 10 MHz — stable for XIAO ESP32S3 */
        .ledc_timer = LEDC_TIMER_0,
        .ledc_channel = LEDC_CHANNEL_0,
        .pixel_format = pf,
        .frame_size = fs,
        .jpeg_quality = 12,
        .fb_count = fb_count,
        .fb_location = CAMERA_FB_IN_PSRAM,
        .grab_mode = (fb_count > 1) ? CAMERA_GRAB_LATEST : CAMERA_GRAB_WHEN_EMPTY,
    };
    return config;
}

bool camera_hal_init(void) {
    camera_config_t config = make_camera_config(
        PIXFORMAT_GRAYSCALE, FRAMESIZE_VGA, 1);

    esp_err_t err = esp_camera_init(&config);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Camera init failed: %s", esp_err_to_name(err));
        return false;
    }

    /* Neutral sensor settings — auto-exposure handles most conditions */
    sensor_t *s = esp_camera_sensor_get();
    if (s) {
        s->set_contrast(s, 0);       /* Neutral contrast */
        s->set_brightness(s, 0);     /* Neutral brightness */
        s->set_whitebal(s, 1);       /* Auto white balance on */
        s->set_gain_ctrl(s, 1);      /* Auto gain on */
        s->set_exposure_ctrl(s, 1);  /* Auto exposure on */
        s->set_aec2(s, 1);           /* DSP auto exposure on */
    }

    current_format = CAMERA_FMT_GRAYSCALE;
    ESP_LOGI(TAG, "OV2640 initialized (VGA, grayscale)");
    return true;
}

camera_frame_t *camera_hal_take_picture(void) {
    if (current_fb) {
        esp_camera_fb_return(current_fb);
        current_fb = NULL;
    }

    current_fb = esp_camera_fb_get();
    if (!current_fb) {
        ESP_LOGE(TAG, "Frame capture failed");
        return NULL;
    }

    hal_frame.buf = current_fb->buf;
    hal_frame.len = current_fb->len;
    hal_frame.width = current_fb->width;
    hal_frame.height = current_fb->height;
    hal_frame.format = current_format;

    return &hal_frame;
}

void camera_hal_return_picture(camera_frame_t *frame) {
    if (current_fb) {
        esp_camera_fb_return(current_fb);
        current_fb = NULL;
    }
}

bool camera_hal_set_format(camera_format_t fmt) {
    if (fmt == current_format) return true;

    /* Must deinit + reinit camera to reallocate DMA buffers for new format */
    if (current_fb) {
        esp_camera_fb_return(current_fb);
        current_fb = NULL;
    }
    esp_camera_deinit();

    pixformat_t pf;
    framesize_t fs;
    int fb_count;
    const char *desc;
    if (fmt == CAMERA_FMT_JPEG) {
        pf = PIXFORMAT_JPEG;
        fs = FRAMESIZE_SVGA;   /* 800x600 for HTTP serving */
        fb_count = 2;          /* Double-buffer needed for JPEG DMA pipeline */
        desc = "JPEG SVGA";
    } else {
        pf = PIXFORMAT_GRAYSCALE;
        fs = FRAMESIZE_VGA;    /* 640x480 for QR decode */
        fb_count = 1;
        desc = "grayscale VGA";
    }

    camera_config_t config = make_camera_config(pf, fs, fb_count);

    esp_err_t err = esp_camera_init(&config);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Camera reinit failed: %s", esp_err_to_name(err));
        return false;
    }

    current_format = fmt;
    ESP_LOGI(TAG, "Switched to %s output", desc);
    return true;
}
