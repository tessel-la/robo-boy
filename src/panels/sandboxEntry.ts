import { panelSandboxBootstrap } from './sandboxRuntime';

// The sandbox is served from its own URL so that it does not inherit the host page's Content
// Security Policy. That also means the host cannot bake its origin into the document, so it
// passes the origin the sandbox must trust on the query string instead.
const parentOrigin = new URLSearchParams(window.location.search).get('parentOrigin') ?? '';

panelSandboxBootstrap(parentOrigin);
