if(CONFIG_USE_MOCK_CAMERA)
    set(CAMERA_HAL_SRC "camera_hal_mock.c")
else()
    set(CAMERA_HAL_SRC "camera_hal_physical.c")
endif()

idf_component_register(
    SRCS ${CAMERA_HAL_SRC}
    INCLUDE_DIRS "include"
)
