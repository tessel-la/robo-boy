#pragma once
#include <sensor_msgs/msg/point_cloud2.hpp>
#include <algorithm>
#include <array>
#include <bit>
#include <cmath>
#include <cstring>
#include <limits>
#include <stdexcept>
#include <vector>

namespace roboboy {
template<class T> double read_coordinate(const uint8_t* data, bool big) {
  std::array<uint8_t, sizeof(T)> bytes;
  std::copy_n(data, sizeof(T), bytes.begin());
  if (big != (std::endian::native == std::endian::big)) std::reverse(bytes.begin(), bytes.end());
  T value;
  std::memcpy(&value, bytes.data(), sizeof(T));
  return value;
}

// Only the derived visualization stream is reduced to XYZ. Raw ROS messages stay untouched.
inline std::vector<uint8_t> xyz(const sensor_msgs::msg::PointCloud2& cloud) {
  constexpr uint32_t sizes[] = {0, 1, 1, 2, 2, 4, 4, 4, 8};
  if (!cloud.point_step || uint64_t(cloud.width) * cloud.point_step > cloud.row_step ||
      uint64_t(cloud.row_step) * cloud.height > cloud.data.size())
    throw std::runtime_error("Invalid PointCloud2 dimensions or strides");
  std::array<sensor_msgs::msg::PointField, 3> fields;
  const char* names[] = {"x", "y", "z"};
  for (int axis = 0; axis < 3; ++axis) {
    const auto it = std::find_if(cloud.fields.begin(), cloud.fields.end(),
        [&](const auto& f) { return f.name == names[axis]; });
    if (it == cloud.fields.end() || !it->datatype || it->datatype > 8 || it->count != 1 ||
        uint64_t(it->offset) + sizes[it->datatype] > cloud.point_step)
      throw std::runtime_error("Invalid PointCloud2 XYZ fields");
    fields[axis] = *it;
  }
  const size_t count = std::min<uint64_t>(uint64_t(cloud.width) * cloud.height, 1'000'000);
  std::vector<uint8_t> output(count * 12);
  for (size_t i = 0; i < count; ++i) {
    const auto* point = cloud.data.data() + (i / cloud.width) * cloud.row_step + (i % cloud.width) * cloud.point_step;
    for (size_t axis = 0; axis < 3; ++axis) {
      const auto& f = fields[axis];
      const auto* p = point + f.offset;
      double value;
      switch (f.datatype) {
        case 1: value = read_coordinate<int8_t>(p, cloud.is_bigendian); break;
        case 2: value = read_coordinate<uint8_t>(p, cloud.is_bigendian); break;
        case 3: value = read_coordinate<int16_t>(p, cloud.is_bigendian); break;
        case 4: value = read_coordinate<uint16_t>(p, cloud.is_bigendian); break;
        case 5: value = read_coordinate<int32_t>(p, cloud.is_bigendian); break;
        case 6: value = read_coordinate<uint32_t>(p, cloud.is_bigendian); break;
        case 7: value = read_coordinate<float>(p, cloud.is_bigendian); break;
        case 8: value = read_coordinate<double>(p, cloud.is_bigendian); break;
        default: throw std::runtime_error("Invalid XYZ datatype");
      }
      const float coordinate = std::isfinite(value) && std::abs(value) <= std::numeric_limits<float>::max()
          ? static_cast<float>(value) : std::numeric_limits<float>::quiet_NaN();
      std::memcpy(output.data() + i * 12 + axis * 4, &coordinate, 4);
    }
  }
  return output;
}
}
