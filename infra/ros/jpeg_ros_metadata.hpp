// SPDX-License-Identifier: Apache-2.0
// APP15 acquisition metadata for ordinary MJPEG/JPEG streams.
#pragma once
#include <cstdint>
#include <string>
#include <vector>

namespace roboboy {
inline void append_u32(std::vector<uint8_t> & out, uint32_t value) {
  for (int shift = 24; shift >= 0; shift -= 8) out.push_back(static_cast<uint8_t>(value >> shift));
}
// Source dimensions describe the full input image, before streamer resizing. Never
// attach this metadata after cropping/inversion: that would require an explicit pixel transform.
inline void add_ros_metadata(std::vector<uint8_t> & jpeg, int32_t sec, uint32_t nanosec,
  const std::string & frame, uint32_t width, uint32_t height) {
  if (jpeg.size() < 2 || jpeg[0] != 0xff || jpeg[1] != 0xd8 || sec < 0 || nanosec >= 1000000000 ||
      frame.empty() || frame.size() > 512 || !width || !height) return;
  for (unsigned char c : frame) if (c < 0x20 || c == 0x7f) return;
  // Marker (2), length (2), signature (8), stamp (8), source size (8), frame UTF-8.
  const uint16_t length = static_cast<uint16_t>(26 + frame.size());
  std::vector<uint8_t> marker = {0xff, 0xef, static_cast<uint8_t>(length >> 8), static_cast<uint8_t>(length)};
  const std::string signature = "RBROS001";
  marker.insert(marker.end(), signature.begin(), signature.end());
  append_u32(marker, static_cast<uint32_t>(sec)); append_u32(marker, nanosec);
  append_u32(marker, width); append_u32(marker, height);
  marker.insert(marker.end(), frame.begin(), frame.end());
  jpeg.insert(jpeg.begin() + 2, marker.begin(), marker.end());
}
}  // namespace roboboy
