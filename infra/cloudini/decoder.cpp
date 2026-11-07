#include <cloudini_lib/cloudini.hpp>
#include <cmath>
#include <cstring>
#include <set>
#include <string>

// Validate the embedded layout BEFORE handing any output memory to the codec.
// The caller supplies the canonical outer ROS layout and its exact allocated size.
extern "C" int roboboy_cloudini_decode(const uint8_t* input, uint32_t input_size,
    uint8_t* output, uint32_t capacity, const char* layout, uint32_t layout_size) {
  try {
    if (!input_size || input_size > 8 * 1024 * 1024 || layout_size > 16384) return -1;
    Cloudini::ConstBufferView data(input, input_size);
    const auto info = Cloudini::DecodeHeader(data);
    const uint64_t points = uint64_t(info.width) * info.height;
    const uint64_t size = points * info.point_step;
    if (points > 1'000'000 || !info.point_step || info.point_step > 256 ||
        size > 32 * 1024 * 1024 || size != capacity ||
        info.fields.empty() || info.fields.size() > 64 || info.version < 4 || info.version > 6) return -1;
    std::string expected = std::to_string(info.width) + ":" + std::to_string(info.height) + ":" +
        std::to_string(info.point_step) + ";";
    std::set<std::string> names;
    constexpr uint32_t sizes[] = {0, 1, 1, 2, 2, 4, 4, 4, 8};
    for (const auto& field : info.fields) {
      const auto type = static_cast<uint32_t>(field.type);
      if (!type || type > 8 || field.name.empty() || field.name.size() > 128 ||
          !names.insert(field.name).second || field.offset > info.point_step ||
          sizes[type] > info.point_step - field.offset ||
          (field.resolution && (!std::isfinite(*field.resolution) || *field.resolution <= 0))) return -1;
      expected += std::to_string(field.name.size()) + ":" + field.name + ":" +
          std::to_string(field.offset) + ":" + std::to_string(type) + ";";
    }
    if (expected != std::string_view(layout, layout_size)) return -1;
    // Padding is not encoded; never expose earlier WASM allocations through it.
    std::memset(output, 0, capacity);
    if (points) {
      Cloudini::PointcloudDecoder decoder;
      decoder.decode(info, data, Cloudini::BufferView(output, capacity));
    }
    return static_cast<int>(capacity);
  } catch (...) {
    return -1;
  }
}
