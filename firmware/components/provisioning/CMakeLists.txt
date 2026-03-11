if(ESP_PLATFORM)
    idf_component_register(SRCS "src/provisioning.c"
                           INCLUDE_DIRS "include"
                           REQUIRES json quirc)
else()
    add_library(provisioning src/provisioning.c)
    target_include_directories(provisioning PUBLIC include ../quirc)
    target_link_libraries(provisioning PRIVATE cjson quirc)

    add_executable(test_provisioning test/test_provisioning.cpp)
    target_include_directories(test_provisioning PRIVATE test)
    target_link_libraries(test_provisioning PRIVATE provisioning Catch2::Catch2WithMain cjson quirc)

    include(CTest)
    include(Catch)
    catch_discover_tests(test_provisioning)
endif()
