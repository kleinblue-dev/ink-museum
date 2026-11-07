// 墨馆后端 · 唯一内容源加载（import ../content/content.js）
// 修改 content/content.js 后重启后端即可生效；校验规则（场景/心情）也由此派生。
let contentModule;
try {
  contentModule = await import('../content/content.js');
} catch (error) {
  throw new Error(`无法加载 content/content.js：${error?.message ?? error}`);
}

/** @type {any} */
export const content = contentModule?.default ?? contentModule?.CONTENT ?? {};

if (!content || typeof content !== 'object' || Array.isArray(content)) {
  throw new Error('content/content.js 默认导出必须是对象');
}

export const contentVersion = typeof content.version === 'string' && content.version ? content.version : '0.0.0';
export const contentMajor = contentVersion.split('.')[0] || '0';

const scenes = Array.isArray(content.scenes) ? content.scenes : [];
export const sceneIds = Object.freeze(scenes.map((scene) => scene && scene.id).filter((id) => typeof id === 'string' && id.length > 0));
export const sceneIdSet = new Set(sceneIds);

const moods = content.post && Array.isArray(content.post.moods) ? content.post.moods : [];
export const moodKeys = Object.freeze(moods.map((mood) => mood && mood.key).filter((key) => typeof key === 'string' && key.length > 0));
export const moodKeySet = new Set(moodKeys);

/** pre/post 三个量表字段（顺序固定） */
export const SCALE_KEYS = Object.freeze(['tight', 'tired', 'scattered']);
/** post 允许的键：三量表 + mood */
export const POST_KEYS = Object.freeze([...SCALE_KEYS, 'mood']);

if (sceneIds.length === 0) throw new Error('content.scenes 至少需要一个场景');
if (moodKeys.length === 0) throw new Error('content.post.moods 至少需要一个心情');

/** 给 /api/content 与错误信息用的小摘要 */
export function contentSummary() {
  return { version: contentVersion, major: contentMajor, scenes: sceneIds.length, moods: moodKeys.length };
}