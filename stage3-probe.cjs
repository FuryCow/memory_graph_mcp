
const { spawn } = require("child_process");
const proc = spawn("node", ["dist/src/index.js"], { cwd: process.cwd() });
const t = (ms) => new Promise(r => setTimeout(r, ms));
const fs = require("fs");
const send = (o) => proc.stdin.write(JSON.stringify(o) + "\n");
let buf = "";
proc.stdout.on("data", d => { buf += d; if (buf.includes("\"id\":3")) { console.log("STATS2:", buf.split("\n").find(l => l.includes("\"id\":3"))); proc.kill(); process.exit(0); } });
(async () => {
  await t(500);
  send({jsonrpc:"2.0",id:1,method:"initialize",params:{protocolVersion:"2024-11-05",capabilities:{},clientInfo:{name:"t",version:"0"}}});
  await t(300);
  send({jsonrpc:"2.0",method:"notifications/initialized"});
  send({jsonrpc:"2.0",id:2,method:"tools/call",params:{name:"graph_stats",arguments:{} }});
  await t(2500);
  fs.writeFileSync("stage3-probe.ts", "export function stage3Probe() { return db.query(\"SELECT * FROM probe_table\"); }\n");
  await t(3000);
  send({jsonrpc:"2.0",id:3,method:"tools/call",params:{name:"graph_stats",arguments:{} }});
  await t(5000);
  console.log("TIMEOUT");
  proc.kill();
  process.exit(1);
})();

