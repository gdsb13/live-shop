const fs = require('fs');
const p = '/opt/gb/live-shop/apps/api/src/mcp/createCommerceMcpServer.js';
let b = fs.readFileSync(p);
if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) b = b.slice(3);
fs.writeFileSync(p, b);
