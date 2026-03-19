if(CONFIG_USE_MOCK_CAMERA)
    set(CAMERA_HAL_SRC "camera_hal_mock.c")
    set(CAMERA_HAL_REQUIRES "")
else()
    set(CAMERA_HAL_SRC "camera_hal_physical.c")
    set(CAMERA_HAL_REQUIRES "esp32-camera")
endif()

idf_component_register(
    SRCS ${CAMERA_HAL_SRC}
    INCLUDE_DIRS "include"
    PRIV_REQUIRES ${CAMERA_HAL_REQUIRES}
)
