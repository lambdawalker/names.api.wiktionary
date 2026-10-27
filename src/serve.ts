#!/usr/bin/env node
import { createWiktionaryMcpServer } from './mcp.js';
import {startConfiguredService} from './local-service.js';
try {await startConfiguredService('wiktionary',(config,token)=>createWiktionaryMcpServer({clientOptions:{userAgent:config.userAgent}}));}catch{console.error('Service startup failed; check configuration, control token and port.');process.exitCode=1;}
