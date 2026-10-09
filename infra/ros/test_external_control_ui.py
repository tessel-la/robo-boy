"""Operator HTTP boundary; runs without ROS."""
import json
import unittest
from unittest.mock import Mock

from tornado.testing import AsyncHTTPTestCase

from external_control_ui import application


class OperatorUiTests(AsyncHTTPTestCase):
    def get_app(self):
        self.node = Mock()
        self.node.snapshot.return_value = dict(allowControl=False, requests=[], events=[], gatewayReady=True, owner=None)
        return application(self.node, 'test-operator-key')

    def command(self, path, command, **headers):
        return self.fetch(path, method='POST', body=json.dumps(command), headers={
            'Content-Type': 'application/json', 'Authorization': 'Bearer test-operator-key', **headers})

    def test_page_and_assets_never_expose_access_key(self):
        for path in ('/', '/operator.js', '/operator.css'):
            response = self.fetch(path)
            self.assertEqual(response.code, 200)
            self.assertNotIn(b'test-operator-key', response.body)
            self.assertEqual(response.headers['X-Frame-Options'], 'DENY')
            self.assertEqual(response.headers['Cache-Control'], 'no-store')

    def test_reads_and_writes_require_operator_key(self):
        self.assertEqual(self.fetch('/api/status').code, 403)
        for path, command in (('/api/access', dict(allowControl=True)), ('/api/decision', dict(requestId='r', approve=True))):
            self.assertEqual(self.command(path, command, Authorization='Bearer wrong').code, 403)
        self.node.set_access.assert_not_called()
        self.node.decide.assert_not_called()
        self.assertEqual(self.command('/api/access', dict(allowControl=True), Authorization='Bearer é').code, 403)

    def test_cross_origin_commands_rejected_even_with_key(self):
        response = self.command('/api/access', dict(allowControl=True), Origin='http://untrusted.example')
        self.assertEqual(response.code, 403)
        self.node.set_access.assert_not_called()

    def test_toggle_and_decisions_use_native_policy(self):
        self.assertEqual(self.command('/api/access', dict(allowControl=True)).code, 200)
        self.node.set_access.assert_called_once_with(True)
        for approve in (True, False):
            self.assertEqual(self.command('/api/decision', dict(requestId='exact-id', approve=approve)).code, 200)
            self.node.decide.assert_called_with('exact-id', approve)

    def test_expired_request_is_reported_without_success(self):
        self.node.decide.side_effect = ValueError('This request is no longer pending.')
        response = self.command('/api/decision', dict(requestId='expired', approve=True))
        self.assertEqual(response.code, 400)
        self.assertEqual(json.loads(response.body)['error'], 'This request is no longer pending.')

    def test_invalid_commands_and_unknown_paths(self):
        for body in ('{', '[]', 'null'):
            response = self.fetch('/api/access', method='POST', body=body, headers={
                'Content-Type': 'application/json', 'Authorization': 'Bearer test-operator-key'})
            self.assertEqual(response.code, 400)
        self.assertEqual(self.command('/api/unknown', {}).code, 404)
        self.assertEqual(self.fetch('/not-a-file').code, 404)
        self.node.set_access.assert_not_called()


if __name__ == '__main__':
    unittest.main()
