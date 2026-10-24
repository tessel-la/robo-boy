import unittest
from concurrent.futures import Future
from types import SimpleNamespace
from robot_work import RobotWork


class Handle:
    def __init__(self, accepted=True):
        self.accepted = accepted
        self.result = Future()
        self.cancelled = 0
    def get_result_async(self):
        return self.result
    def cancel_goal_async(self):
        self.cancelled += 1


class WorkTests(unittest.TestCase):
    def test_service_retained_after_local_timeout_until_actual_response(self):
        work, future, disposed = RobotWork(), Future(), []
        work.service(future, lambda: disposed.append(True))
        self.assertEqual(work.count, 1)
        # No completion from a UI/node timeout: future is still live.
        self.assertFalse(disposed)
        future.set_result({'success': True})
        self.assertEqual(work.count, 0)
        self.assertEqual(disposed, [True])

    def test_uncertain_service_failure_keeps_fence(self):
        work, future = RobotWork(), Future()
        work.service(future, lambda: None)
        future.set_exception(RuntimeError('transport lost'))
        self.assertEqual(work.count, 1)

    def test_late_accepted_goal_cancelled_but_retained_until_terminal(self):
        work, future, active, disposed = RobotWork(), Future(), [], []
        tracking = work.action(future, lambda: disposed.append(True), active.append, active.remove, lambda: True)
        handle = Handle()
        future.set_result(handle)
        self.assertEqual(handle.cancelled, 1)
        self.assertEqual(work.count, 1)
        self.assertEqual(tracking['result'], handle.result)
        self.assertEqual(active, [handle])
        handle.result.set_result(SimpleNamespace(status=5))
        self.assertEqual(work.count, 0)
        self.assertEqual(active, [])
        self.assertEqual(disposed, [True])

    def test_rejected_goal_is_safe_to_release(self):
        work, future, disposed = RobotWork(), Future(), []
        work.action(future, lambda: disposed.append(True), lambda _: None, lambda _: None, lambda: False)
        future.set_result(Handle(False))
        self.assertEqual(work.count, 0)
        self.assertEqual(disposed, [True])

    def test_unknown_result_keeps_fence(self):
        work, future = RobotWork(), Future()
        work.action(future, lambda: None, lambda _: None, lambda _: None, lambda: False)
        handle = Handle()
        future.set_result(handle)
        handle.result.set_result(SimpleNamespace(status=0))
        self.assertEqual(work.count, 1)

    def test_worker_token_not_released_until_worker_exits(self):
        work = RobotWork()
        token = work.begin()
        self.assertEqual(work.count, 1)
        work.finish(token)
        work.finish(token)
        self.assertEqual(work.count, 0)
