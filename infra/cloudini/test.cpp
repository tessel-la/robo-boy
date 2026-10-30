#include <cloudini_lib/cloudini.hpp>
#include <fstream>
#include <iostream>
#include "xyz.hpp"

extern "C" int roboboy_cloudini_decode(const uint8_t*, uint32_t, uint8_t*, uint32_t, const char*, uint32_t);
void check(bool condition) { if (!condition) throw std::runtime_error("Cloudini boundary check failed"); }

template<class T> void put(std::vector<uint8_t>& bytes, size_t offset, T value, bool big) {
  std::array<uint8_t, sizeof(T)> data;
  std::memcpy(data.data(), &value, sizeof(T));
  if (big != (std::endian::native == std::endian::big)) std::reverse(data.begin(), data.end());
  std::copy(data.begin(), data.end(), bytes.begin() + offset);
}

int main(int argc, char** argv) try {
  for (bool big : {false, true}) {
    sensor_msgs::msg::PointCloud2 raw;
    raw.width = 2; raw.height = 2; raw.point_step = 32; raw.row_step = 72;
    raw.is_bigendian = big;
    raw.data.resize(144);
    for (const auto& [name, offset, type] : {std::tuple("x", 0, 7), {"y", 8, 8}, {"z", 20, 3}}) {
      sensor_msgs::msg::PointField field;
      field.name = name; field.offset = offset; field.datatype = type; field.count = 1;
      raw.fields.push_back(field);
    }
    for (size_t i = 0; i < 4; ++i) {
      const auto base = (i / 2) * 72 + (i % 2) * 32;
      put<float>(raw.data, base, 1 + i, big);
      put<double>(raw.data, base + 8, 2 + i, big);
      put<int16_t>(raw.data, base + 20, -3 - i, big);
    }
    const auto xyz = roboboy::xyz(raw);
    check(xyz.size() == 48);
    for (size_t i = 0; i < 4; ++i) {
      float values[3]; std::memcpy(values, xyz.data() + i * 12, 12);
      check(values[0] == 1 + i && values[1] == 2 + i && values[2] == -3 - double(i));
    }
    raw.row_step = 1;
    bool rejected = false;
    try { roboboy::xyz(raw); } catch (const std::runtime_error&) { rejected = true; }
    check(rejected);
  }
  Cloudini::EncodingInfo info;
  info.width = 3; info.point_step = 12; info.use_threads = false;
  info.fields = {{"x", 0, Cloudini::FieldType::FLOAT32, 0.001f},
                 {"y", 4, Cloudini::FieldType::FLOAT32, 0.001f},
                 {"z", 8, Cloudini::FieldType::FLOAT32, 0.001f}};
  const float coordinates[] = {1.1234f, 2.9876f, -3.5432f, 4, 5, 6,
      std::numeric_limits<float>::quiet_NaN(), 7, 8};
  std::vector<uint8_t> encoded;
  Cloudini::PointcloudEncoder(info).encode({reinterpret_cast<const uint8_t*>(coordinates), sizeof(coordinates)}, encoded);
  const std::string layout = "3:1:12;1:x:0:7;1:y:4:7;1:z:8:7;";
  std::vector<uint8_t> output(sizeof(coordinates), 0xab);
  auto decode = [&](size_t input, uint32_t capacity, const std::string& expected) {
    return roboboy_cloudini_decode(encoded.data(), input, output.data(), capacity, expected.data(), expected.size());
  };
  check(decode(encoded.size(), output.size() - 1, layout) == -1);
  check(output.front() == 0xab && output.back() == 0xab);
  check(decode(encoded.size(), output.size(), "wrong layout") == -1);
  check(decode(8, output.size(), layout) == -1);
  check(decode(encoded.size(), output.size(), layout) == sizeof(coordinates));
  for (size_t i = 0; i < 7; ++i) {
    float value; std::memcpy(&value, output.data() + i * 4, 4);
    if (std::isfinite(coordinates[i])) check(std::abs(value - coordinates[i]) <= 0.000502);
    else check(!std::isfinite(value));
  }
  if (argc == 2) {
    std::ofstream fixture(argv[1], std::ios::binary);
    fixture.write(reinterpret_cast<const char*>(encoded.data()), encoded.size());
    check(bool(fixture));
  }
  std::cout << "XYZ layouts/endian/row padding and bounded Cloudini decoding: passed\n";
} catch (const std::exception& error) {
  std::cerr << error.what() << '\n'; return 1;
}
