if(ESP_PLATFORM)
    idf_component_register(SRCS "decode.c" "identify.c" "quirc.c" "version_db.c"
                           INCLUDE_DIRS ".")
else()
    add_library(quirc decode.c identify.c quirc.c version_db.c)
    target_include_directories(quirc PUBLIC .)
    target_link_libraries(quirc m)
endif()
