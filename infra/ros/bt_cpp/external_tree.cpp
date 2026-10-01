// Independent robot application: no Robo Boy worker protocol or lifecycle manager.
#include <behaviortree_cpp/bt_factory.h>
#include <behaviortree_cpp/loggers/groot2_publisher.h>
#include <chrono>
#include <thread>

class RobotWait : public BT::StatefulActionNode {
public:
  RobotWait(const std::string& name, const BT::NodeConfig& config) : StatefulActionNode(name, config) {}
  static BT::PortsList providedPorts() { return {BT::InputPort<double>("seconds", 1.0, "Operation duration")}; }
  BT::NodeStatus onStart() override {
    deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(int(getInput<double>("seconds").value() * 1000));
    return BT::NodeStatus::RUNNING;
  }
  BT::NodeStatus onRunning() override { return std::chrono::steady_clock::now() < deadline ? BT::NodeStatus::RUNNING : BT::NodeStatus::SUCCESS; }
  void onHalted() override {}
private:
  std::chrono::steady_clock::time_point deadline;
};
int main() {
  BT::BehaviorTreeFactory factory;
  factory.registerNodeType<RobotWait>("RobotWait");
  bool succeed = true;
  factory.registerSimpleCondition("RobotOutcome", [&](BT::TreeNode&) { return succeed ? BT::NodeStatus::SUCCESS : BT::NodeStatus::FAILURE; });
  auto tree = factory.createTreeFromText(R"(
    <root BTCPP_format="4" main_tree_to_execute="ExternalCpp">
      <BehaviorTree ID="ExternalCpp"><Sequence name="Robot mission">
        <SubTree ID="Phase" _autoremap="true" name="Approach"/>
        <SubTree ID="Phase" _autoremap="true" name="Inspect"/>
        <RobotOutcome name="Robot outcome"/>
      </Sequence></BehaviorTree>
      <BehaviorTree ID="Phase"><Sequence name="Phase"><RobotWait name="Robot wait" seconds="1.2"/><AlwaysSuccess/></Sequence></BehaviorTree>
    </root>)");
  BT::Groot2Publisher telemetry(tree, 1667);
  while (true) {
    auto status = tree.tickOnce();
    if (status != BT::NodeStatus::RUNNING) {
      std::this_thread::sleep_for(std::chrono::seconds(1));
      tree.haltTree();
      succeed = !succeed;
    }
    std::this_thread::sleep_for(std::chrono::milliseconds(100));
  }
}
