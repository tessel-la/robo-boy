"""Track ROS work until the robot confirms completion, independently of UI timeouts."""
import threading


class RobotWork:
    def __init__(self):
        self._lock = threading.RLock()
        self._pending = set()

    @property
    def count(self):
        with self._lock:
            return len(self._pending)

    def begin(self):
        token = object()
        with self._lock:
            self._pending.add(token)
        return token

    def finish(self, token):
        with self._lock:
            self._pending.discard(token)

    def service(self, future, dispose):
        token = self.begin()

        def done(completed):
            try:
                completed.result()
            except Exception:
                # Transport/client failure does not prove that a service stopped.
                return
            self.finish(token)
            dispose()
        future.add_done_callback(done)

    def action(self, future, dispose, on_accept, on_terminal, should_cancel):
        token = self.begin()
        tracking = {'ready': threading.Event()}

        def terminal(completed, handle):
            try:
                response = completed.result()
                if response.status not in (4, 5, 6):
                    return
            except Exception:
                return
            on_terminal(handle)
            self.finish(token)
            dispose()

        def accepted(completed):
            try:
                handle = completed.result()
                tracking['handle'] = handle
                if not handle.accepted:
                    self.finish(token)
                    dispose()
                    return
                on_accept(handle)
                tracking['result'] = handle.get_result_async()
                tracking['result'].add_done_callback(lambda result: terminal(result, handle))
                if should_cancel():
                    handle.cancel_goal_async()
            except Exception:
                # Keep the fence on any uncertain outcome.
                return
            finally:
                # rclpy schedules done callbacks independently. Signal only after
                # the result future exists, rather than relying on callback order.
                tracking['ready'].set()
        future.add_done_callback(accepted)
        return tracking
