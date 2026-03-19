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

bool camera_hal_init(void) {
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
        .pixel_format = PIXFORMAT_GRAYSCALE,  /* Start in grayscale for QR provisioning */
        .frame_size = FRAMESIZE_QVGA,         /* 320x240 — sufficient for QR decode */
        .jpeg_quality = 12,
        .fb_count = 1,                        /* Single buffer for grayscale */
        .fb_location = CAMERA_FB_IN_PSRAM,
        .grab_mode = CAMERA_GRAB_WHEN_EMPTY,
    };

    esp_err_t err = esp_camera_init(&config);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Camera init failed: %s", esp_err_to_name(err));
        return false;
    }

    current_format = CAMERA_FMT_GRAYSCALE;
    ESP_LOGI(TAG, "OV2640 initialized (QVGA, grayscale)");
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
    sensor_t *s = esp_camera_sensor_get();
    if (!s) return false;

    if (fmt == CAMERA_FMT_JPEG) {
        s->set_pixformat(s, PIXFORMAT_JPEG);
        s->set_framesize(s, FRAMESIZE_SVGA);  /* 800x600 for HTTP serving */
        current_format = CAMERA_FMT_JPEG;
        ESP_LOGI(TAG, "Switched to JPEG SVGA output");
    } else {
        s->set_pixformat(s, PIXFORMAT_GRAYSCALE);
        s->set_framesize(s, FRAMESIZE_QVGA);  /* 320x240 for QR decode */
        current_format = CAMERA_FMT_GRAYSCALE;
        ESP_LOGI(TAG, "Switched to grayscale QVGA output");
    }
    return true;
}
