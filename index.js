const WebSocket = require('ws');
const { exec, spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
const fs = require('fs-extra');
const path = require('path');
require('dotenv').config();

const SERVER_URL = process.env.SERVER_URL || 'wss://arc.benge888.net/ws';
const AGENT_ID = process.env.AGENT_ID || 'local-pc-' + uuidv4().substring(0, 8);
const JWT_SECRET = process.env.JWT_SECRET || 'arc-production-secret-2024';
const WORKSPACE_DIR = process.env.WORKSPACE_DIR || process.cwd();

const sessions = new Map();
let globalWs = null;

function generateToken() {
  return jwt.sign(
    { type: 'agent', id: AGENT_ID },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function connect() {
  const token = generateToken();
  globalWs = new WebSocket(`${SERVER_URL}?token=${token}`);
  const ws = globalWs;
  
  ws.on('open', () => {
    console.log(`[Agent] Connected as ${AGENT_ID}`);
    console.log(`[Agent] Workspace: ${WORKSPACE_DIR}`);
  });
  
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      console.log(`[Agent] Received: ${data.type}/${data.action}`);
      handleMessage(ws, data);
    } catch (err) {
      console.error('[Agent] Invalid message:', err.message);
    }
  });
  
  ws.on('close', (code, reason) => {
    console.log(`[Agent] Disconnected: code=${code}, reason=${reason?.toString() || 'none'}`);
    console.log(`[Agent] ReadyState: ${ws.readyState}`);
    console.log(`[Agent] Reconnecting in 5s...`);
    setTimeout(connect, 5000);
  });
  
  ws.on('error', (err) => {
    console.error(`[Agent] Error: ${err.message}`);
  });
  
  // 保持连接活跃 - 应用层心跳
  const heartbeat = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'system', action: 'ping' }));
    }
  }, 25000);
  
  return ws;
}

function handleMessage(ws, data) {
  const { type, action, sessionId, payload } = data;
  
  switch (type) {
    case 'terminal':
      handleTerminal(ws, sessionId, action, payload);
      break;
    case 'file':
      handleFile(ws, sessionId, action, payload);
      break;
    case 'session':
      handleSession(ws, sessionId, action, payload);
      break;
  }
}

function handleTerminal(ws, sessionId, action, payload) {
  if (action === 'create') {
    const existing = sessions.get(sessionId);
    if (existing && !existing.exited) {
      ws.send(JSON.stringify({
        type: 'terminal',
        action: 'created',
        sessionId,
        payload: { sessionId }
      }));
      if (existing.outputBuffer && existing.outputBuffer.length > 0) {
        ws.send(JSON.stringify({
          type: 'terminal',
          action: 'output',
          sessionId,
          payload: { data: existing.outputBuffer.join('') }
        }));
      }
      return;
    }

    const cwd = payload?.cwd || WORKSPACE_DIR;
    const isWin = process.platform === 'win32';
    const shell = isWin ? 'pwsh.exe' : 'bash';
    const shellArgs = isWin ? ['-NoLogo', '-NoExit'] : [];
    
    const child = spawn(shell, shellArgs, {
      cwd,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    const session = {
      process: child,
      outputBuffer: [],
      bufferMax: 5000,
      exited: false
    };
    sessions.set(sessionId, session);
    
    child.stdout.on('data', (data) => {
      const str = data.toString();
      if (session.outputBuffer) {
        session.outputBuffer.push(str);
        if (session.outputBuffer.length > session.bufferMax) {
          session.outputBuffer = session.outputBuffer.slice(-session.bufferMax);
        }
      }
      ws.send(JSON.stringify({
        type: 'terminal',
        action: 'output',
        sessionId,
        payload: { data: str }
      }));
    });
    
    child.stderr.on('data', (data) => {
      const str = data.toString();
      if (session.outputBuffer) {
        session.outputBuffer.push(str);
      }
      ws.send(JSON.stringify({
        type: 'terminal',
        action: 'output',
        sessionId,
        payload: { data: str }
      }));
    });
    
    child.on('exit', (code) => {
      session.exited = true;
      ws.send(JSON.stringify({
        type: 'terminal',
        action: 'exit',
        sessionId,
        payload: { code }
      }));
      sessions.delete(sessionId);
    });
    
    ws.send(JSON.stringify({
      type: 'terminal',
      action: 'created',
      sessionId,
      payload: { sessionId }
    }));
    
    console.log(`[Terminal] Created: ${sessionId}`);
  } else if (action === 'input') {
    const session = sessions.get(sessionId);
    if (session) {
      session.process.stdin.write(payload.input);
    }
  } else if (action === 'close') {
    const session = sessions.get(sessionId);
    if (session) {
      session.process.kill('SIGTERM');
      sessions.delete(sessionId);
    }
  }
}

async function handleFile(ws, sessionId, action, payload) {
  try {
    const filePath = path.resolve(WORKSPACE_DIR, payload.path);
    
    if (!filePath.startsWith(WORKSPACE_DIR)) {
      ws.send(JSON.stringify({
        type: 'system',
        action: 'error',
        sessionId,
        payload: { message: 'Access denied' }
      }));
      return;
    }
    
    switch (action) {
      case 'read':
        const content = await fs.readFile(filePath, 'utf-8');
        ws.send(JSON.stringify({
          type: 'file',
          action: 'content',
          sessionId,
          payload: { path: payload.path, content }
        }));
        break;
        
      case 'write':
        await fs.writeFile(filePath, payload.content, 'utf-8');
        ws.send(JSON.stringify({
          type: 'file',
          action: 'written',
          sessionId,
          payload: { path: payload.path }
        }));
        break;
        
      case 'list':
        const stats = await fs.stat(filePath);
        if (stats.isDirectory()) {
          const files = await fs.readdir(filePath, { withFileTypes: true });
          const fileList = files.map(f => ({
            name: f.name,
            type: f.isDirectory() ? 'directory' : 'file',
            path: path.join(payload.path, f.name)
          }));
          ws.send(JSON.stringify({
            type: 'file',
            action: 'list',
            sessionId,
            payload: { path: payload.path, files: fileList }
          }));
        }
        break;
    }
  } catch (err) {
    ws.send(JSON.stringify({
      type: 'system',
      action: 'error',
      sessionId,
      payload: { message: `File error: ${err.message}` }
    }));
  }
}

function handleSession(ws, sessionId, action, payload) {
  if (action === 'close') {
    const session = sessions.get(sessionId);
    if (session) {
      session.process.kill('SIGTERM');
      sessions.delete(sessionId);
    }
  }
}

console.log(`[Agent] Starting: ${AGENT_ID}`);
console.log(`[Agent] Server: ${SERVER_URL}`);

process.on('uncaughtException', (err) => {
  console.error('[Agent] UNCAUGHT EXCEPTION', err.message, err.stack);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Agent] UNHANDLED REJECTION', reason);
});

const ws = connect();

process.on('SIGINT', () => {
  for (const [, session] of sessions) {
    session.process.kill('SIGTERM');
  }
  ws.close();
  process.exit(0);
});
