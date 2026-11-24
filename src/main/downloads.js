const path = require('path');
const { app, session, shell } = require('electron');

let nextId = 1;
const items = new Map();
let onChange = () => {};

function snapshot(item) {
  return {
    id: item.id,
    filename: item.filename,
    savePath: item.savePath,
    state: item.state,
    received: item.received,
    total: item.total,
    startTime: item.startTime
  };
}

function list() {
  return Array.from(items.values())
    .sort((a, b) => b.startTime - a.startTime)
    .map(snapshot);
}

function notify() {
  onChange(list());
}

function attach(ses) {
  if (ses.__chatboxDownloads) return;
  ses.__chatboxDownloads = true;
  ses.on('will-download', (_event, item) => {
    const id = nextId++;
    const filename = item.getFilename() || 'download';
    let savePath = path.join(app.getPath('downloads'), filename);
    let counter = 1;
    const fs = require('fs');
    while (fs.existsSync(savePath)) {
      const ext = path.extname(filename);
      const base = path.basename(filename, ext);
      savePath = path.join(app.getPath('downloads'), `${base} (${counter++})${ext}`);
    }
    item.setSavePath(savePath);
    const record = {
      id,
      item,
      filename: path.basename(savePath),
      savePath,
      state: 'progressing',
      received: 0,
      total: item.getTotalBytes(),
      startTime: Date.now()
    };
    items.set(id, record);
    notify();
    item.on('updated', (_e, state) => {
      record.received = item.getReceivedBytes();
      record.total = item.getTotalBytes();
      record.state = state === 'interrupted' ? 'interrupted' : 'progressing';
      notify();
    });
    item.once('done', (_e, state) => {
      record.received = item.getReceivedBytes();
      record.state = state;
      notify();
    });
  });
}

function init({ change }) {
  onChange = change || (() => {});
  attach(session.defaultSession);
}

function pause(id) {
  const record = items.get(id);
  if (record && record.state === 'progressing') record.item.pause();
}

function resume(id) {
  const record = items.get(id);
  if (record && record.item.canResume()) record.item.resume();
}

function cancel(id) {
  const record = items.get(id);
  if (record) record.item.cancel();
}

function openFile(id) {
  const record = items.get(id);
  if (record && record.state === 'completed') shell.openPath(record.savePath);
}

function showInFolder(id) {
  const record = items.get(id);
  if (record) shell.showItemInFolder(record.savePath);
}

function remove(id) {
  const record = items.get(id);
  if (!record) return;
  if (record.state === 'progressing') record.item.cancel();
  items.delete(id);
  notify();
}

module.exports = { init, attach, list, pause, resume, cancel, openFile, showInFolder, remove };
