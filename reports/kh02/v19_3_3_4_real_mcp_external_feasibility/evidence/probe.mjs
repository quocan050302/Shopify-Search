import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
const out=path.resolve('reports/kh02/v19_3_3_4_real_mcp_external_feasibility');
const codeSha='f2ab3e34e080ac5558176109f99f0c6bd9e817b8';
const specs=[{id:'meta',command:path.resolve('services/meta-ads-collector/.venv/bin/python'),args:['-m','meta_ads_collector_mcp','serve','--data-dir',path.join(out,'evidence','isolated-meta-runtime'),'--concurrency','1'],call:{name:'discover',arguments:{}}},{id:'google',command:path.resolve('services/google-transparency/.venv/bin/python'),args:[path.resolve('scripts/googleTransparencyServer.py')],call:{name:'search_advertiser',arguments:{query:''}}}];
const results=await Promise.allSettled(specs.map(async s=>{
 const result={codeSha,taskId:`protocol-${s.id}`,dependencies:['official-access-and-server-inspection'],startedAt:new Date().toISOString(),command:s.command,args:s.args,stages:{},upstreamQueryAttempted:false,providerContentObserved:false,businessEligible:false};
 const t=new StdioClientTransport({command:s.command,args:s.args,stderr:'pipe',env:{...process.env,GOOGLE_ADS_TRANSPARENCY_PROXY:'direct',PYTHONUTF8:'1'}});
 let logs='';t.stderr?.on('data',d=>{logs=(logs+d).slice(-32000)});
 const c=new Client({name:'kh02-external-feasibility-audit',version:'19.3.3.4'});
 try{
  await c.connect(t,{timeout:15000});result.stages.MCP_STARTUP_PASS=true;result.stages.MCP_HANDSHAKE_PASS=true;result.serverVersion=c.getServerVersion();result.serverCapabilities=c.getServerCapabilities();
  result.tools=await c.listTools({}, {timeout:15000});result.stages.MCP_TOOL_DISCOVERY_PASS=true;
  result.arguments=s.call;result.toolResponse=await c.callTool(s.call,undefined,{timeout:15000});result.stages.MCP_TOOL_CALL_EXECUTED=true;result.stages.MCP_TOOL_RESULT_RECEIVED=true;
  result.responseSha256=crypto.createHash('sha256').update(JSON.stringify(result.toolResponse)).digest('hex');result.status='LOCAL_PROTOCOL_ONLY';
 }catch(e){result.status='FAILED';result.error=String(e)}finally{try{await c.close();await t.close();result.cleanup='CLOSED'}catch(e){result.cleanup=String(e)}}
 result.endedAt=new Date().toISOString();fs.writeFileSync(path.join(out,`evidence/${s.id}-protocol.json`),JSON.stringify(result,null,2)+'\n');fs.writeFileSync(path.join(out,`logs/${s.id}-protocol.log`),logs);return {source:s.id,status:result.status,stages:result.stages};
}));
console.log(JSON.stringify(results,null,2));
