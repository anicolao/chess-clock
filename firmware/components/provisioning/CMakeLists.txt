add_library(provisioning src/provisioning.c)
target_include_directories(provisioning PUBLIC include)
target_link_libraries(provisioning PRIVATE cjson)

add_executable(test_provisioning test/test_provisioning.cpp)
target_link_libraries(test_provisioning PRIVATE provisioning Catch2::Catch2WithMain cjson)

include(CTest)
include(Catch)
catch_discover_tests(test_provisioning)
