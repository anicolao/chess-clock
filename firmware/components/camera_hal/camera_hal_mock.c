#include "camera_hal.h"
#include "mock_qr_image.h"

static camera_frame_t mock_frame;

bool camera_hal_init(void) {
    mock_frame.buf = (uint8_t *)MOCK_QR_IMAGE;
    mock_frame.len = MOCK_QR_WIDTH * MOCK_QR_HEIGHT;
    mock_frame.width = MOCK_QR_WIDTH;
    mock_frame.height = MOCK_QR_HEIGHT;
    return true;
}

camera_frame_t* camera_hal_take_picture(void) {
    return &mock_frame;
}

void camera_hal_return_picture(camera_frame_t *frame) {
    // No-op for mock
}
