cmake_minimum_required(VERSION 3.8)
project(tf2_web_republisher)

find_package(ament_cmake REQUIRED)
find_package(rosidl_default_generators REQUIRED)
find_package(geometry_msgs REQUIRED)
find_package(builtin_interfaces REQUIRED)
find_package(action_msgs REQUIRED)

rosidl_generate_interfaces(${PROJECT_NAME}
  "msg/TFArray.msg"
  "srv/RepublishTFs.srv"
  "action/TFSubscription.action"
  DEPENDENCIES geometry_msgs builtin_interfaces action_msgs
)

ament_package() 