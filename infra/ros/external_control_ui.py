"""Optional local operator page. All policy mutations stay on the ROS node's thread."""
import json
from pathlib import Path
import secrets

import tornado.ioloop
import tornado.web


def application(node, token):
    class OperatorHandler(tornado.web.RequestHandler):
        def set_default_headers(self):
            self.set_header('Cache-Control', 'no-store')
            self.set_header('X-Frame-Options', 'DENY')
            self.set_header('X-Content-Type-Options', 'nosniff')
            self.set_header('Referrer-Policy', 'no-referrer')
            self.set_header('Content-Security-Policy', "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")

        def prepare(self):
            if self.request.path.startswith('/api/'):
                auth = self.request.headers.get('Authorization', '')
                if not secrets.compare_digest(auth.encode('utf-8'), ('Bearer ' + token).encode('utf-8')):
                    raise tornado.web.HTTPError(403, reason='Open the operator link from the robot logs.')
                origin = self.request.headers.get('Origin')
                if origin is not None and origin != 'http://' + self.request.host:
                    raise tornado.web.HTTPError(403, reason='Use the local operator page.')

        def get(self):
            if self.request.path == '/api/status':
                self.write(node.snapshot())
                return
            files = {'/': ('external_control_ui.html', 'text/html; charset=utf-8'),
                     '/operator.js': ('external_control_ui.js', 'text/javascript; charset=utf-8'),
                     '/operator.css': ('external_control_ui.css', 'text/css; charset=utf-8')}
            entry = files.get(self.request.path)
            if entry is None:
                raise tornado.web.HTTPError(404)
            self.set_header('Content-Type', entry[1])
            self.write(Path(__file__).with_name(entry[0]).read_text())

        def post(self):
            try:
                if self.request.headers.get('Content-Type', '').split(';')[0] != 'application/json':
                    raise ValueError('Send a JSON command.')
                command = json.loads(self.request.body)
                if not isinstance(command, dict):
                    raise ValueError('Send a JSON command.')
                if self.request.path == '/api/access':
                    node.set_access(command.get('allowControl'))
                elif self.request.path == '/api/decision':
                    node.decide(command.get('requestId'), command.get('approve'))
                else:
                    raise tornado.web.HTTPError(404)
                self.write(node.snapshot())
            except (ValueError, TypeError) as error:
                self.set_status(400)
                self.write(dict(error=str(error)))

    return tornado.web.Application([(r'/.*', OperatorHandler)])


def run(node, port):
    import rclpy
    token = secrets.token_urlsafe(32)
    server = application(node, token).listen(port, address='127.0.0.1', max_body_size=4096)
    loop = tornado.ioloop.IOLoop.current()

    def spin():
        if rclpy.ok():
            rclpy.spin_once(node, timeout_sec=0)
        else:
            loop.stop()

    timer = tornado.ioloop.PeriodicCallback(spin, 20)
    timer.start()
    node.get_logger().info(f'Robot operator UI: http://127.0.0.1:{port}/#key={token}')
    try:
        loop.start()
    finally:
        timer.stop()
        server.stop()
