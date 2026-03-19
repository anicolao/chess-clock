#ifndef CAMERA_HAL_H
#define CAMERA_HAL_H

#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>

typedef enum {
    CAMERA_FMT_GRAYSCALE,
    CAMERA_FMT_JPEG
} camera_format_t;

typedef struct {
    uint8_t *buf;
    size_t len;
    int width;
    int height;
    camera_format_t format;
} camera_frame_t;

bool camera_hal_init(void);
camera_frame_t* camera_hal_take_picture(void);
void camera_hal_return_picture(camera_frame_t *frame);

/* Switch output format. Init defaults to GRAYSCALE for QR provisioning.
   Call with CAMERA_FMT_JPEG before starting HTTP server. */
bool camera_hal_set_format(camera_format_t fmt);

#endif // CAMERA_HAL_H
