const WebSocket = require('ws');
const pty = require('node-pty');
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
const fs = require('fs-extra');
const path = require('path');
require('dotenv').config();

const SERVER_URL = process.env.SERVER_URL || 'ws://localhost:3000';
const AGENT_ID = process.env.AGENT_ID || 'agent-' + uuidv4();
const JWT_SECRET = process.env.JWT_SECRET || 'default-secret';
const WORKSPACE_DIR = process.env.WORKSPACE_DIR || process.cwd();
const SHELL = process.platform === 'win32' ? 'pwsh.exe' : (process.env.SHELL || 'bash');

const sessions = new Map();
let ws = null;
let reconnectDelay = 1000;
let reconnectTimer = null;

function generateToken() {
  return jwt.sign(
    { type: 'agent', id: AGENT_ID },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function connect() {
  clearTimeout(reconnectTimer);
  const token = generateToken();
  ws = new WebSocket(`${SERVER_URL}?token=${token}`);

  ws.on('open', () => {
    console.log(`[Agent] Connected to server as ${AGENT_ID}`);
    reconnectDelay = 1000;
  });

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      handleMessage(ws, data);
    } catch (err) {
      console.error('[Agent] Invalid message:', err.message);
    }
  });

  ws.on('close', () => {
    console.log('[Agent] Disconnected from server, reconnecting in ' + reconnectDelay + 'ms');
    reconnectDelay = Math.min(reconnectDelay * 2, 30000);
    reconnectTimer = setTimeout(connect, reconnectDelay);
  });

  ws.on('error', (err) => {
    console.error('[Agent] WebSocket error:', err.message);
  });
}

function safeSend(data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify(data));
    } catch (e) {}
  }
}

function handleMessage(ws, data) {
  const { type, action, sessionId, payload } = data;

  switch (type) {
    case 'terminal':
      handleTerminal(ws, sessionId, action, payload);
      break;
    case 'file':
      handleFile(sessionId, action, payload);
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
      console.log(`[Terminal] Reattaching existing session: ${sessionId}`);
      existing.lastAttached = Date.now();
      safeSend({
        type: 'terminal',
        action: 'created',
        sessionId,
        payload: { sessionId }
      });
      if (existing.outputBuffer && existing.outputBuffer.length > 0) {
        const history = existing.outputBuffer.join('');
        safeSend({
          type: 'terminal',
          action: 'output',
          sessionId,
          payload: { data: history }
        });
      }
      if (payload?.cols && payload?.rows && existing.pty) {
        try { existing.pty.resize(payload.cols, payload.rows); } catch(e) {}
      }
      return;
    }

    if (existing && existing.exited) {
      sessions.delete(sessionId);
    }

    const shell = payload?.shell || SHELL;
    const cwd = payload?.cwd || WORKSPACE_DIR;
    const cols = payload?.cols || 80;
    const rows = payload?.rows || 24;
    const isWin = process.platform === 'win32';

    try {
      const shellArgs = isWin ? ['-NoLogo'] : [];
      const ptyOptions = {
        name: 'xterm-color',
        cols: cols,
        rows: rows,
        cwd: cwd,
        env: { ...process.env }
      };
      const ptyProcess = pty.spawn(shell, shellArgs, ptyOptions);

      const session = {
        pty: ptyProcess,
        config: payload,
        created: Date.now(),
        lastAttached: Date.now(),
        exited: false,
        outputBuffer: [],
        bufferMax: 5000
      };

      ptyProcess.on('data', (data) => {
        if (session.outputBuffer !== null) {
          session.outputBuffer.push(data);
          if (session.outputBuffer.length > session.bufferMax) {
            session.outputBuffer = session.outputBuffer.slice(-session.bufferMax);
          }
        }
        safeSend({
          type: 'terminal',
          action: 'output',
          sessionId,
          payload: { data }
        });
      });

      ptyProcess.on('exit', (code) => {
        session.exited = true;
        safeSend({
          type: 'terminal',
          action: 'exit',
          sessionId,
          payload: { code }
        });
        sessions.delete(sessionId);
        console.log(`[Terminal] Session exited: ${sessionId} (code: ${code})`);
      });

      sessions.set(sessionId, session);

      safeSend({
        type: 'terminal',
        action: 'created',
        sessionId,
        payload: { sessionId }
      });

      console.log(`[Terminal] Session created: ${sessionId} (shell: ${shell})`);
    } catch (err) {
      safeSend({
        type: 'system',
        action: 'error',
        sessionId,
        payload: { message: `Failed to create terminal: ${err.message}` }
      });
    }
  } else if (action === 'input') {
    const session = sessions.get(sessionId);
    if (session && session.pty && !session.exited) {
      try {
        session.pty.write(payload.input);
      } catch (e) {
        console.error(`[Terminal] Write error for ${sessionId}:`, e.message);
      }
    }
  } else if (action === 'resize') {
    const session = sessions.get(sessionId);
    if (session && session.pty && !session.exited) {
      try {
        session.pty.resize(payload.cols, payload.rows);
      } catch (e) {}
    }
  } else if (action === 'close') {
    const session = sessions.get(sessionId);
    if (session && session.pty && !session.exited) {
      try {
        session.pty.kill();
      } catch (e) {}
    }
    sessions.delete(sessionId);
    console.log(`[Terminal] Session closed: ${sessionId}`);
  }
}

function handleSession(ws, sessionId, action, payload) {
  switch (action) {
    case 'new':
      console.log(`[Session] New session: ${sessionId} for client ${payload?.clientId}`);
      break;

    case 'close':
      const session = sessions.get(sessionId);
      if (session && session.pty && !session.exited) {
        session.pty.kill();
      }
      sessions.delete(sessionId);
      console.log(`[Session] Closed: ${sessionId}`);
      break;
  }
}

function handleFile(sessionId, action, payload) {
  const filePath = payload.path ? path.resolve(WORKSPACE_DIR, payload.path.replace(/^[/\\]+/, '')) : null;

  if (action === 'list') {
    const dir = filePath || WORKSPACE_DIR;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const files = entries.map(e => ({
        name: e.name,
        type: e.isDirectory() ? 'directory' : 'file',
        size: e.isFile() ? fs.statSync(path.join(dir, e.name)).size : 0,
      }));
      safeSend({ type: 'file', action: 'list', sessionId, payload: { path: payload.path || '/', files } });
    } catch (err) {
      safeSend({ type: 'system', action: 'error', sessionId, payload: { message: 'List failed: ' + err.message } });
    }

  } else if (action === 'read') {
    if (!filePath) return;
    try {
      const stat = fs.statSync(filePath);
      const buf = fs.readFileSync(filePath);
      safeSend({
        type: 'file', action: 'content', sessionId,
        payload: { path: payload.path, content: buf.toString('base64'), size: stat.size, name: path.basename(filePath) }
      });
    } catch (err) {
      safeSend({ type: 'system', action: 'error', sessionId, payload: { message: 'Read failed: ' + err.message } });
    }

  } else if (action === 'write') {
    if (!filePath) return;
    const targetDir = path.dirname(filePath);
    try {
      if (!fs.existsSync(targetDir)) fs.mkdirpSync(targetDir);
      const buf = Buffer.from(payload.content || '', 'base64');
      fs.writeFileSync(filePath, buf);
      safeSend({ type: 'file', action: 'written', sessionId, payload: { path: payload.path, size: buf.length } });
    } catch (err) {
      safeSend({ type: 'system', action: 'error', sessionId, payload: { message: 'Write failed: ' + err.message } });
    }

  } else if (action === 'stat') {
    try {
      const s = filePath ? fs.statSync(filePath) : null;
      safeSend({
        type: 'file', action: 'stat', sessionId,
        payload: { path: payload.path, size: s?.size || 0, isDir: s?.isDirectory() || true }
      });
    } catch (err) {
      safeSend({ type: 'file', action: 'stat', sessionId, payload: { path: payload.path, size: 0, isDir: true } });
    }
  }
}

console.log(`[Agent] Starting agent: ${AGENT_ID}`);
console.log(`[Agent] Workspace: ${WORKSPACE_DIR}`);
console.log(`[Agent] Shell: ${SHELL}`);

connect();

process.on('SIGINT', () => {
  console.log('[Agent] Shutting down...');
  for (const [sessionId, session] of sessions) {
    if (session.pty && !session.exited) {
      try { session.pty.kill(); } catch (e) {}
    }
  }
  sessions.clear();
  if (ws) ws.close();
  process.exit(0);
});