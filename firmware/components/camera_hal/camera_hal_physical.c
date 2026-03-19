#include "camera_hal.h"

bool camera_hal_init(void) {
    // Stub for physical initialization logic
    return true;
}

camera_frame_t* camera_hal_take_picture(void) {
    // Stub for physical capture logic
    return NULL;
}

void camera_hal_return_picture(camera_frame_t *frame) {
    // Stub for physical return logic
}
