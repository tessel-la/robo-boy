// Real BehaviorTree.CPP worker. ROS action IPC is asynchronous; control flow stays native.
#include <behaviortree_cpp/bt_factory.h>
#include <nlohmann/json.hpp>
#include <chrono>
#include <cstdlib>
#include <cmath>
#include <iostream>
#include <memory>
#include <mutex>
#include <sstream>
#include <unordered_map>

using Json = nlohmann::json;
using Clock = std::chrono::steady_clock;
static Json actions = Json::array(), cancellations = Json::array(), transitions = Json::array();
static std::unordered_map<std::string, Json> results;
static std::mutex transition_mutex;

static std::string id(const BT::TreeNode& node) { return std::to_string(node.UID()); }
static std::string native(BT::NodeStatus status) { return BT::toStr(status); }
static std::string normalized(BT::NodeStatus status) {
  switch(status) {
    case BT::NodeStatus::RUNNING: return "running";
    case BT::NodeStatus::SUCCESS: return "success";
    case BT::NodeStatus::FAILURE: return "failure";
    default: return "idle"; // SKIPPED retained in nativeStatus.
  }
}

class Wait : public BT::StatefulActionNode {
  Clock::time_point until_;
public:
  Wait(const std::string& name, const BT::NodeConfig& config) : StatefulActionNode(name, config) {}
  static BT::PortsList providedPorts() { return {BT::InputPort<double>("seconds", 0.2, "Wait duration in seconds")}; }
  BT::NodeStatus onStart() override {
    auto seconds = getInput<double>("seconds");
    if (!seconds || !std::isfinite(seconds.value()) || seconds.value() < 0) throw BT::RuntimeError("Invalid Wait seconds");
    until_ = Clock::now() + std::chrono::duration_cast<Clock::duration>(std::chrono::duration<double>(seconds.value()));
    return BT::NodeStatus::RUNNING;
  }
  BT::NodeStatus onRunning() override { return Clock::now() < until_ ? BT::NodeStatus::RUNNING : BT::NodeStatus::SUCCESS; }
  void onHalted() override {}
};

class RosAction : public BT::StatefulActionNode {
public:
  RosAction(const std::string& name, const BT::NodeConfig& config) : StatefulActionNode(name, config) {}
  static BT::PortsList providedPorts() {
    return {BT::InputPort<std::string>("action_name"), BT::InputPort<std::string>("action_type"),
      BT::InputPort<std::string>("goal", std::string("{}"), "JSON action goal"), BT::InputPort<double>("timeout", 30.0, "ROS action deadline in seconds"),
      BT::InputPort<std::string>("goal_b64", std::string(""), "Base64 JSON goal (for brace-safe XML ports)"),
      BT::OutputPort<std::string>("result")};
  }
  BT::NodeStatus onStart() override {
    const auto name = getInput<std::string>("action_name"), type = getInput<std::string>("action_type");
    const auto goal = getInput<std::string>("goal");
    const auto encoded = getInput<std::string>("goal_b64");
    const auto timeout = getInput<double>("timeout");
    if (!name || !type || !encoded || (!goal && encoded.value().empty()) || !timeout) throw BT::RuntimeError("RosAction requires valid action_name/action_type/goal/timeout ports");
    results.erase(id(*this));
    actions.push_back({{"id",id(*this)}, {"action_name", name.value()}, {"action_type", type.value()},
      {"goal", encoded.value().empty() ? Json::parse(goal.value()) : Json::object()}, {"goalB64",encoded.value()}, {"timeout",timeout.value()}});
    return BT::NodeStatus::RUNNING;
  }
  BT::NodeStatus onRunning() override {
    auto found = results.find(id(*this));
    if (found == results.end()) return BT::NodeStatus::RUNNING;
    auto result = found->second;
    results.erase(found);
    if (config().output_ports.count("result")) setOutput("result", result.value("result", Json::object()).dump());
    return result.value("success",false) ? BT::NodeStatus::SUCCESS : BT::NodeStatus::FAILURE;
  }
  void onHalted() override { cancellations.push_back(id(*this)); results.erase(id(*this)); }
};

class JsonGet : public BT::SyncActionNode {
public:
  JsonGet(const std::string& name, const BT::NodeConfig& config) : SyncActionNode(name, config) {}
  static BT::PortsList providedPorts() {
    return {BT::InputPort<std::string>("json"), BT::InputPort<std::string>("field"), BT::OutputPort<std::string>("value")};
  }
  BT::NodeStatus tick() override {
    auto json = getInput<std::string>("json"), field = getInput<std::string>("field");
    if (!json || !field) throw BT::RuntimeError("JsonGet requires json and field ports");
    auto object = Json::parse(json.value());
    if (!object.is_object()) throw BT::RuntimeError("JsonGet requires a JSON object");
    if (!object.contains(field.value())) return BT::NodeStatus::FAILURE;
    setOutput("value", object.at(field.value()).dump());
    return BT::NodeStatus::SUCCESS;
  }
};

class JsonSet : public BT::SyncActionNode {
public:
  JsonSet(const std::string& name, const BT::NodeConfig& config) : SyncActionNode(name, config) {}
  static BT::PortsList providedPorts() {
    return {BT::InputPort<std::string>("json", std::string(""), "Base JSON object (empty starts a new object)"),
      BT::InputPort<std::string>("field"), BT::InputPort<std::string>("value"), BT::OutputPort<std::string>("result")};
  }
  BT::NodeStatus tick() override {
    auto json = getInput<std::string>("json"), field = getInput<std::string>("field"), value = getInput<std::string>("value");
    if (!json || !field || !value) throw BT::RuntimeError("JsonSet requires valid json, field and value ports");
    auto object = json.value().empty() ? Json::object() : Json::parse(json.value());
    if (!object.is_object()) throw BT::RuntimeError("JsonSet requires a JSON object");
    object[field.value()] = Json::parse(value.value());
    setOutput("result", object.dump());
    return BT::NodeStatus::SUCCESS;
  }
};

int main() {
  std::ostream protocol(std::cout.rdbuf());
  std::cout.rdbuf(std::cerr.rdbuf()); // Node output belongs to logs, never the JSON channel.
  BT::BehaviorTreeFactory factory;
  factory.registerNodeType<Wait>("Wait");
  factory.registerNodeType<RosAction>("RosAction");
  factory.registerNodeType<JsonGet>("JsonGet");
  factory.registerNodeType<JsonSet>("JsonSet");
  // Operator-owned allowlist, never populated by an XML upload.
  if (const char* plugins = std::getenv("ROBOBOY_BTCPP_PLUGINS")) {
    std::stringstream paths(plugins);
    std::string path;
    while(std::getline(paths,path,':')) if(!path.empty()) factory.registerFromPlugin(path);
  }
  std::unique_ptr<BT::Tree> tree;
  std::vector<BT::TreeNode::StatusChangeSubscriber> subscriptions;
  auto snapshot = [&]() {
    Json nodes = Json::array();
    if (tree) {
      BT::applyRecursiveVisitor(tree->rootNode(), [&](BT::TreeNode* node) {
        Json ports = Json::object();
        for(const auto& port : static_cast<const BT::TreeNode*>(node)->config().input_ports) ports[port.first] = port.second;
        for(const auto& port : static_cast<const BT::TreeNode*>(node)->config().output_ports) ports[port.first] = port.second;
        nodes.push_back({{"id",id(*node)}, {"parentId",nullptr}, {"label",node->name()},
          {"type",node->registrationName()}, {"status",normalized(node->status())}, {"nativeStatus",native(node->status())}, {"feedback",""}, {"ports",ports}});
      });
      // Visitor topology retains native subtree instances and their IDs.
      BT::applyRecursiveVisitor(tree->rootNode(), [&](BT::TreeNode* parent) {
        auto assign = [&](BT::TreeNode* child) {
          for(auto& node : nodes) if(node["id"] == id(*child)) node["parentId"] = id(*parent);
        };
        if (auto control = dynamic_cast<BT::ControlNode*>(parent)) for(auto child:control->children()) assign(child);
        else if(auto decorator = dynamic_cast<BT::DecoratorNode*>(parent)) assign(decorator->child());
      });
    }
    Json observed;
    { std::lock_guard<std::mutex> guard(transition_mutex); observed = transitions; transitions.clear(); }
    Json response = {{"nodes",nodes},{"actions",actions},{"cancellations",cancellations},{"transitions",observed}};
    actions.clear(); cancellations.clear();
    return response;
  };
  std::string line;
  while(std::getline(std::cin,line)) {
    Json response;
    try {
      Json command = Json::parse(line);
      const auto name = command.at("command").get<std::string>();
      if(name == "discover") {
        Json nodes = Json::array();
        for(const auto& entry:factory.manifests()) nodes.push_back(entry.first);
        response = {{"version",BTCPP_LIBRARY_VERSION},{"nodes",nodes},{"rosIntegration","rclpy action bridge / trusted ROS2 plugins"}};
      } else if(name == "load") {
        subscriptions.clear(); tree.reset(); factory.clearRegisteredBehaviorTrees(); results.clear();
        factory.registerBehaviorTreeFromText(command.at("xml").get<std::string>());
        tree = std::make_unique<BT::Tree>(factory.createTree(command.at("mainTreeId").get<std::string>()));
        BT::applyRecursiveVisitor(tree->rootNode(), [&](BT::TreeNode* node) {
          subscriptions.push_back(node->subscribeToStatusChange([](BT::TimePoint, const BT::TreeNode& node, BT::NodeStatus, BT::NodeStatus status){
            std::lock_guard<std::mutex> guard(transition_mutex);
            transitions.push_back({{"id",id(node)},{"status",normalized(status)},{"nativeStatus",native(status)}});
          }));
        });
        response = snapshot();
      } else if(!tree) throw BT::RuntimeError("No tree loaded");
      else if(name == "tick") {
        auto status = tree->tickExactlyOnce(); response = snapshot(); response["result"] = normalized(status);
      } else if(name == "halt") { tree->haltTree(); response = snapshot(); }
      else if(name == "action_result") { results[command.at("id").get<std::string>()] = command; response = Json::object(); }
      else throw BT::RuntimeError("Unsupported worker command");
      response["ok"] = true;
    } catch(const std::exception& error) { response = {{"ok",false},{"error",error.what()}}; }
    protocol << response.dump() << std::endl;
  }
  if(tree) tree->haltTree();
}
