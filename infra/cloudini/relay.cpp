#include <cloudini_lib/cloudini.hpp>
#include <point_cloud_interfaces/msg/compressed_point_cloud2.hpp>
#include <rclcpp/rclcpp.hpp>
#include <chrono>
#include <map>
#include "xyz.hpp"

using Raw = sensor_msgs::msg::PointCloud2;
using Compressed = point_cloud_interfaces::msg::CompressedPointCloud2;

class PointCloudRelay : public rclcpp::Node {
  struct Stream {
    rclcpp::Publisher<Compressed>::SharedPtr publisher;
    rclcpp::Subscription<Raw>::SharedPtr subscription;
    Cloudini::PointcloudEncoderCache encoder;
  };
  std::map<std::string, Stream> streams_;
  rclcpp::TimerBase::SharedPtr discovery_;

  void publish(Stream& stream, const Raw& raw) {
    try {
      const auto points = roboboy::xyz(raw);
      Compressed message;
      message.header = raw.header;
      message.width = points.size() / 12;
      message.height = 1;
      message.point_step = 12;
      message.row_step = message.width * 12;
      message.is_bigendian = false;
      message.is_dense = raw.is_dense;
      message.format = "cloudini";
      Cloudini::EncodingInfo info;
      info.width = message.width;
      info.point_step = 12;
      info.use_threads = false;
      for (int axis = 0; axis < 3; ++axis) {
        sensor_msgs::msg::PointField field;
        field.name = std::string(1, "xyz"[axis]);
        field.offset = axis * 4;
        field.datatype = 7;
        field.count = 1;
        message.fields.push_back(field);
        info.fields.push_back({field.name, field.offset, Cloudini::FieldType::FLOAT32, 0.001f});
      }
      if (!points.empty()) stream.encoder.get(info).encode({points.data(), points.size()}, message.compressed_data);
      stream.publisher->publish(message);
    } catch (const std::exception& error) {
      RCLCPP_WARN_THROTTLE(get_logger(), *get_clock(), 5000, "Cloud compression: %s", error.what());
    }
  }

  void discover() {
    const auto topics = get_topic_names_and_types();
    for (auto it = streams_.begin(); it != streams_.end();) {
      if (!topics.contains(it->first) || get_publishers_info_by_topic(it->first).empty()) it = streams_.erase(it);
      else ++it;
    }
    for (const auto& [name, types] : topics) {
      if (streams_.size() >= 64) break;
      if (name.starts_with("/roboboy/cloudini/") || streams_.contains(name) ||
          std::find(types.begin(), types.end(), "sensor_msgs/msg/PointCloud2") == types.end() ||
          get_publishers_info_by_topic(name).empty()) continue;
      auto& stream = streams_[name];
      stream.publisher = create_publisher<Compressed>("/roboboy/cloudini" + name,
          rclcpp::QoS(1).reliable().transient_local());
    }
    for (auto& [name, stream] : streams_) {
      if (!stream.publisher->get_subscription_count()) {
        stream.subscription.reset();
        stream.encoder = Cloudini::PointcloudEncoderCache();
      } else if (!stream.subscription) {
        auto qos = rclcpp::SensorDataQoS().keep_last(1);
        const auto offers = get_publishers_info_by_topic(name);
        if (!offers.empty() && std::all_of(offers.begin(), offers.end(), [](const auto& offer) {
              return offer.qos_profile().durability() == rclcpp::DurabilityPolicy::TransientLocal;
            })) qos.transient_local();
        stream.subscription = create_subscription<Raw>(name, qos,
            [this, &stream](const Raw::ConstSharedPtr& message) { publish(stream, *message); });
      }
    }
  }
public:
  PointCloudRelay() : Node("roboboy_pointcloud_relay") {
    discovery_ = create_wall_timer(std::chrono::seconds(1), [this] { discover(); });
    discover();
  }
};

int main(int argc, char** argv) {
  rclcpp::init(argc, argv);
  rclcpp::spin(std::make_shared<PointCloudRelay>());
  rclcpp::shutdown();
}
