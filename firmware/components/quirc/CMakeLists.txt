add_library(quirc decode.c identify.c quirc.c version_db.c)
target_include_directories(quirc PUBLIC .)
# Note: quirc might need math library depending on system, but usually fine.
target_link_libraries(quirc m)
