// Test-only: preload in both baseline and after runs to prohibit Node networking.
// Fixtures replace fetch in their own VM/global contexts. Never load in the app.
const net = require('node:net');
const denied = () => { throw new Error('OFFLINE_TEST_NETWORK_DISABLED'); };
net.Socket.prototype.connect = denied;
globalThis.fetch = async () => { throw new Error('OFFLINE_TEST_NETWORK_DISABLED'); };
require('node:tls').connect = denied;
