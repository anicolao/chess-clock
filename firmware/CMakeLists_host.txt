cmake_minimum_required(VERSION 3.14)
project(esp32_firmware_tests)

enable_testing()

# Find cJSON
find_package(cJSON REQUIRED)

# Find Catch2
find_package(Catch2 3 REQUIRED)

add_subdirectory(components/quirc)
add_subdirectory(components/provisioning)
