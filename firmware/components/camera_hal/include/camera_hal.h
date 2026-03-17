#ifndef CAMERA_HAL_H
#define CAMERA_HAL_H

#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>

typedef struct {
    uint8_t *buf;
    size_t len;
    int width;
    int height;
} camera_frame_t;

bool camera_hal_init(void);
camera_frame_t* camera_hal_take_picture(void);
void camera_hal_return_picture(camera_frame_t *frame);

#endif // CAMERA_HAL_H
