// 墨馆后端 · 存储层
// - scrolls.jsonl：逐行 append + fsync（每行一条记录）
// - images/<id>.<webp|png>：先写临时文件 + fsync，再 rename（原子）
// - 启动时重建内存索引；坏行跳过并记数
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';

/** 记录必须有的最小字段（重建索引时用于识别坏行） */
function isValidRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return false;
  if (typeof record.id !== 'string' || record.id.length === 0 || record.id.length > 128) return false;
  if (!/^[A-Za-z0-9-]+$/.test(record.id)) return false;
  if (typeof record.sceneId !== 'string' || record.sceneId.length === 0) return false;
  if (typeof record.createdAt !== 'string' || record.createdAt.length === 0) return false;
  if (!record.image || typeof record.image !== 'object') return false;
  if (record.image.type !== 'webp' && record.image.type !== 'png') return false;
  if (typeof record.image.file === 'string' && path.basename(record.image.file) !== record.image.file) return false;
  return true;
}

/** 图片实际类型（webp|png）——文件扩展名 / URL 扩展名都以此为准 */
export function imageTypeOf(record) {
  return record?.image?.type === 'png' ? 'png' : 'webp';
}

/** 单套语义：imageUrl 扩展名 = 图片实际字节类型（webp 正常路径即 SPEC 的 /image.webp） */
export function imageUrlFor(record) {
  return `/api/scrolls/${encodeURIComponent(record.id)}/image.${imageTypeOf(record)}`;
}

/** 列表项：只暴露公开字段（clientId 只给哈希） */
export function toPublicRecord(record) {
  const imageUrl = imageUrlFor(record);
  return {
    id: record.id,
    sceneId: record.sceneId,
    mood: record.mood ?? null,
    createdAt: record.createdAt,
    imageUrl,
    thumbUrl: imageUrl, // 零依赖后端不生成缩略图；缩略图 URL 暂等于原图 URL
    clientIdHash: record.clientIdHash ?? null
  };
}

/** 详情：在公开字段之外附带量表与统计（不含原始 clientId） */
export function toDetailRecord(record) {
  return {
    ...toPublicRecord(record),
    schemaVersion: record.schemaVersion ?? null,
    contentVersion: record.contentVersion ?? null,
    pre: record.pre ?? null,
    post: record.post ?? null,
    ink: record.ink ?? null
  };
}

async function writeFileAtomic(targetPath, buffer) {
  const directory = path.dirname(targetPath);
  const tempPath = path.join(directory, `.tmp-${process.pid}-${crypto.randomBytes(8).toString('hex')}`);
  const handle = await fsp.open(tempPath, 'wx');
  try {
    await handle.writeFile(buffer);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await fsp.rename(tempPath, targetPath);
  } catch (error) {
    await fsp.rm(tempPath, { force: true });
    throw error;
  }
}

/**
 * 打开/初始化数据目录并重建内存索引。
 * @param {{dataDir: string, logger?: Console, now?: () => number}} options
 */
export async function openStore({ dataDir, logger = console, now = Date.now }) {
  void now;
  const jsonlPath = path.join(dataDir, 'scrolls.jsonl');
  const imagesDir = path.join(dataDir, 'images');
  await fsp.mkdir(imagesDir, { recursive: true });

  const byId = new Map();
  const order = [];
  const idemToId = new Map();
  let badLines = 0;
  let loadedLines = 0;

  function warn(message) {
    logger?.warn?.(`[ink-museum] ${message}`);
  }

  function indexRecord(record) {
    order.push(record.id);
    byId.set(record.id, record);
    if (typeof record.idemHash === 'string' && record.idemHash.length > 0 && !idemToId.has(record.idemHash)) {
      idemToId.set(record.idemHash, record.id);
    }
  }

  async function rebuild() {
    let input;
    try {
      input = createReadStream(jsonlPath, { encoding: 'utf8' });
    } catch {
      return;
    }
    const lines = createInterface({ input, crlfDelay: Infinity });
    try {
      for await (const line of lines) {
        loadedLines += 1;
        const trimmed = line.trim();
        if (trimmed.length === 0) continue;
        let record;
        try {
          record = JSON.parse(trimmed);
        } catch {
          badLines += 1;
          warn(`scrolls.jsonl 第 ${loadedLines} 行不是合法 JSON，已跳过`);
          continue;
        }
        if (!isValidRecord(record)) {
          badLines += 1;
          warn(`scrolls.jsonl 第 ${loadedLines} 行字段不完整，已跳过`);
          continue;
        }
        if (byId.has(record.id)) {
          badLines += 1;
          warn(`scrolls.jsonl 第 ${loadedLines} 行 id 重复（${record.id}），已跳过`);
          continue;
        }
        indexRecord(record);
      }
    } catch (error) {
      if (error && error.code === 'ENOENT') return;
      throw error;
    } finally {
      lines.close();
    }
  }

  /** 若上次崩溃留下没有换行的半行，补一个换行，避免下一条 append 粘在坏行上 */
  async function ensureTrailingNewline() {
    let stat;
    try {
      stat = await fsp.stat(jsonlPath);
    } catch {
      return;
    }
    if (!stat.isFile() || stat.size === 0) return;
    const handle = await fsp.open(jsonlPath, 'r');
    try {
      const buffer = Buffer.alloc(1);
      await handle.read(buffer, 0, 1, stat.size - 1);
      if (buffer[0] !== 0x0a) await fsp.appendFile(jsonlPath, '\n', 'utf8');
    } finally {
      await handle.close();
    }
  }

  await rebuild();
  await ensureTrailingNewline();

  /** 串行化 append，保证 jsonl 行不交错 */
  let writeChain = Promise.resolve();
  function appendLine(record) {
    const line = `${JSON.stringify(record)}\n`;
    const run = async () => {
      const handle = await fsp.open(jsonlPath, 'a');
      try {
        await handle.writeFile(line, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
    };
    const task = writeChain.then(run, run);
    writeChain = task.catch(() => {});
    return task;
  }

  /**
   * 保存一条画卷：先原子写图片，再 append jsonl（失败则回滚图片）。
   * @param {{record: any, imageBuffer: Buffer}} input
   */
  async function save({ record, imageBuffer }) {
    if (!record || typeof record.id !== 'string' || record.id.length === 0) throw new Error('save: record.id 缺失');
    if (!Buffer.isBuffer(imageBuffer) || imageBuffer.length === 0) throw new Error('save: imageBuffer 缺失');
    if (byId.has(record.id)) throw new Error(`save: id 已存在 ${record.id}`);
    const fallbackFile = `${record.id}.${imageTypeOf(record)}`;
    const imageFile = typeof record.image?.file === 'string' && record.image.file.length > 0 ? record.image.file : fallbackFile;
    if (path.basename(imageFile) !== imageFile) throw new Error('save: image.file 非法');
    const imagePath = path.join(imagesDir, imageFile);
    await writeFileAtomic(imagePath, imageBuffer);
    try {
      await appendLine(record);
    } catch (error) {
      await fsp.rm(imagePath, { force: true });
      throw error;
    }
    indexRecord(record);
    return record;
  }

  function findByIdem(idemHash) {
    const id = idemToId.get(idemHash);
    return id === undefined ? undefined : byId.get(id);
  }

  function get(id) {
    return byId.get(id);
  }

  async function readImage(id) {
    const record = byId.get(id);
    if (!record) return null;
    const file = typeof record.image?.file === 'string' && record.image.file.length > 0
      ? record.image.file
      : `${id}.${imageTypeOf(record)}`;
    const imagePath = path.join(imagesDir, path.basename(file));
    try {
      return await fsp.readFile(imagePath);
    } catch (error) {
      if (error && error.code === 'ENOENT') return null;
      throw error;
    }
  }

  /** 按保存时间倒序（同毫秒按写入顺序倒序） */
  function list({ limit = 24, sceneId = null, offset = 0 } = {}) {
    const matched = [];
    for (let index = order.length - 1; index >= 0; index -= 1) {
      const record = byId.get(order[index]);
      if (!record) continue;
      if (sceneId !== null && record.sceneId !== sceneId) continue;
      matched.push(record);
    }
    const total = matched.length;
    const start = Math.min(Math.max(0, offset), total);
    const items = matched.slice(start, start + limit);
    const nextOffset = start + items.length < total ? start + items.length : null;
    return { items, total, nextOffset };
  }

  function stats() {
    const byScene = {};
    const byMood = {};
    let firstTime = null;
    let lastTime = null;
    for (const id of order) {
      const record = byId.get(id);
      if (!record) continue;
      byScene[record.sceneId] = (byScene[record.sceneId] ?? 0) + 1;
      if (typeof record.mood === 'string' && record.mood) byMood[record.mood] = (byMood[record.mood] ?? 0) + 1;
      const time = Date.parse(record.createdAt);
      if (Number.isFinite(time)) {
        if (firstTime === null || time < firstTime) firstTime = time;
        if (lastTime === null || time > lastTime) lastTime = time;
      }
    }
    return {
      total: byId.size,
      byScene,
      byMood,
      firstCreatedAt: firstTime === null ? null : new Date(firstTime).toISOString(),
      lastCreatedAt: lastTime === null ? null : new Date(lastTime).toISOString(),
      badLines
    };
  }

  async function flush() {
    await writeChain.catch(() => {});
  }

  async function close() {
    await flush();
  }

  return {
    dataDir,
    jsonlPath,
    imagesDir,
    save,
    get,
    readImage,
    findByIdem,
    list,
    stats,
    flush,
    close,
    size: () => byId.size,
    badLines: () => badLines,
    loadedLines: () => loadedLines
  };
}