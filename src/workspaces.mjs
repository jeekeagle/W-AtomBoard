import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { readConfig } from './config.mjs';

/** 工作区根目录：可在系统配置里改 */
export function baseDir(root) {
  const cfg = readConfig(root);
  return cfg.workspaces?.baseDir || path.join(root, 'workspaces');
}

/** 项目文件夹：显式设置优先，否则 <baseDir>/<project.key> */
export function projectFolder(root, project, cfg) {
  if (project?.folder) return project.folder;
  const base = cfg?.workspaces?.baseDir || baseDir(root);
  return path.join(base, project?.key || 'project');
}

/** 原子文件夹：显式设置优先，否则 <项目文件夹>/<AT-N 标题片段> */
export function atomFolder(root, atom, project, cfg) {
  if (atom?.folder) return atom.folder;
  return path.join(projectFolder(root, project, cfg), folderName(atom));
}

/** AT-13-标题片段 —— Windows 文件名安全 */
export function folderName(atom) {
  const title = String(atom?.title || '').trim();
  const safe = title
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[. ]+$/g, '')
    .slice(0, 28);
  return atom?.id ? (safe ? `${atom.id}-${safe}` : atom.id) : 'atom';
}

export function ensureDir(p) {
  if (!p) return null;
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
  return p;
}

/**
 * 新建 Atom 时立刻在本地建好工作目录，并把路径回写到 atom。
 * 目录结构：<工作区根>/<项目key>/<AT-N-标题片段>/
 * 这样「打开目录」按钮永远有东西可开，Codex 产出的文件也天然落在这里。
 */
export function prepareAtomFolder(root, atom, project, cfg) {
  const folder = atom?.folder || atomFolder(root, atom, project, cfg);
  ensureDir(folder);
  // 素材区默认建好：写作时参考资料放这里，不混进正文
  ensureDir(path.join(folder, '素材'));
  return folder;
}

/** 用系统文件管理器打开目录 */
export function openFolder(p) {
  if (!p) return { ok: false, error: '路径为空' };
  ensureDir(p);
  try {
    if (process.platform === 'win32') {
      const child = spawn('explorer.exe', [p], { detached: true, stdio: 'ignore', windowsHide: true });
      child.unref();
    } else if (process.platform === 'darwin') {
      const child = spawn('open', [p], { detached: true, stdio: 'ignore' });
      child.unref();
    } else {
      const child = spawn('xdg-open', [p], { detached: true, stdio: 'ignore' });
      child.unref();
    }
    return { ok: true, path: p };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** 用系统默认程序打开文件（找不到关联程序时，资源管理器会给出提示） */
export function openFile(p) {
  if (!p) return { ok: false, error: '路径为空' };
  try {
    if (process.platform === 'win32') {
      const child = spawn('explorer.exe', [p], { detached: true, stdio: 'ignore', windowsHide: true });
      child.unref();
    } else if (process.platform === 'darwin') {
      const child = spawn('open', [p], { detached: true, stdio: 'ignore' });
      child.unref();
    } else {
      const child = spawn('xdg-open', [p], { detached: true, stdio: 'ignore' });
      child.unref();
    }
    return { ok: true, path: p };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** 在资源管理器中定位文件（Windows 选中该文件，其他平台打开所在目录） */
export function revealFile(p) {
  if (!p) return { ok: false, error: '路径为空' };
  try {
    if (process.platform === 'win32') {
      const child = spawn('explorer.exe', [`/select,${p}`], { detached: true, stdio: 'ignore', windowsHide: true });
      child.unref();
    } else {
      return openFolder(path.dirname(p));
    }
    return { ok: true, path: p };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
