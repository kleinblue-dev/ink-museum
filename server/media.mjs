// 墨馆后端 · 图片 data URL 解码 / magic 校验
import crypto from 'node:crypto';
import { HttpError } from './http-util.mjs';

/** PNG 8 字节文件头 */
export const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const DATA_URL_RE = /^data:image\/(webp|png);base64,([A-Za-z0-9+/]*={0,2})$/;
const MIME_BY_TYPE = Object.freeze({ webp: 'image/webp', png: 'image/png' });

/** RIFF....WEBP */
export function isWebpMagic(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length >= 12
    && buffer.subarray(0, 4).toString('latin1') === 'RIFF'
    && buffer.subarray(8, 12).toString('latin1') === 'WEBP';
}

/** \x89PNG\r\n\x1a\n */
export function isPngMagic(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_MAGIC);
}

export function sha256Hex(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

/**
 * 解码 data URL 并校验大小与 magic。
 * 错误码：image_required / invalid_image / image_too_large / invalid_image_magic
 * @param {unknown} value
 * @param {{maxBytes: number}} options
 */
export function decodeImageDataUrl(value, { maxBytes }) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new HttpError(400, 'image_required', '缺少 image 字段（data:image/webp;base64,…）');
  }
  const match = DATA_URL_RE.exec(value);
  if (!match) {
    throw new HttpError(400, 'invalid_image', 'image 必须是 data:image/(webp|png);base64,<base64> 形式');
  }
  const [, type, base64] = match;
  if (base64.length === 0 || base64.length % 4 !== 0) {
    throw new HttpError(400, 'invalid_image', 'image base64 长度无效');
  }
  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length === 0) {
    throw new HttpError(400, 'invalid_image', 'image 解码后为空');
  }
  if (buffer.length > maxBytes) {
    throw new HttpError(413, 'image_too_large', `image 解码后 ${buffer.length} 字节，超过上限 ${maxBytes} 字节（2.5MB）`);
  }
  const magicOk = type === 'webp' ? isWebpMagic(buffer) : isPngMagic(buffer);
  if (!magicOk) {
    throw new HttpError(400, 'invalid_image_magic', `image 内容与声明的 ${type} 类型不符（magic 校验失败）`);
  }
  return {
    buffer,
    type,
    mime: MIME_BY_TYPE[type],
    bytes: buffer.length,
    sha256: sha256Hex(buffer)
  };
}