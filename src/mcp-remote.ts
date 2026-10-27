#!/usr/bin/env node
import{serveStdio}from'@modelcontextprotocol/server/stdio';import{createRemoteMcp,loadServiceConfig}from'./local-service.js';
try{const config=await loadServiceConfig();await serveStdio(()=>createRemoteMcp(process.env.NAMES_SERVICE_URL??'http://127.0.0.1:'+config.port,process.env.NAMES_CONTROL_TOKEN??''));}catch{console.error('Remote MCP startup failed; check local service URL and control credential.');process.exitCode=1;}
