// main.js — 启动：读 content → 探测 api.mode → 恢复 session → 渲染当前 step；
// 再加全局角标（馆藏 / 关于）、#gallery #about 深链、?fresh=1 重开、刷新恢复提示。

import { CONTENT } from '../content/content.js';
import { ensureApiMode } from './api.js';
import { createBackdrop } from './scenes.js';
import { createJourney } from './journey.js';
import { openGallery } from './gallery.js';
import { clearAll, clearSession, loadRawSession, migrateSession, resolveStorage, saveSession } from './state.js';
import { announce, button, closeTopOverlay, el, hasOverlay, openOverlay, qs, toast } from './ui.js';

const storage = resolveStorage();
const pageParams = new URLSearchParams(window.location.search);

const migrateEnv = {
  sceneIds: (CONTENT.scenes || []).map((scene) => scene.id),
  moodKeys: ((CONTENT.post && CONTENT.post.moods) || []).map((mood) => mood.key),
  answerKeys: ((CONTENT.line && CONTENT.line.replies) || []).map((reply) => reply.key)
};

// ?fresh=1：只清会话，重开一程；保留本机馆藏。
if (pageParams.get('fresh') === '1') {
  clearSession(storage);
  pageParams.delete('fresh');
  const search = pageParams.toString();
  try {
    window.history.replaceState(
      null,
      '',
      window.location.pathname + (search ? '?' + search : '') + (window.location.hash || '')
    );
  } catch (err) {
    /* ignore */
  }
}

const rawSession = loadRawSession(storage);
const restored = migrateSession(rawSession, migrateEnv);
const session = restored.session;
if (restored.note === 'reset' && rawSession) clearSession(storage);

// 静态 title/meta 已写死中文；运行时再与 content 对齐。
document.title = [CONTENT.museum.title, CONTENT.museum.subtitle]
  .filter((part) => part && part.length)
  .join(' · ');
const descriptionMeta = qs('meta[name="description"]');
if (descriptionMeta) {
  const description = [CONTENT.museum.subtitle, CONTENT.ethics.short]
    .filter((part) => part && part.length)
    .join(' ');
  if (description) descriptionMeta.setAttribute('content', description);
}

const backdrop = createBackdrop(qs('#backdrop'));
const journey = createJourney({
  stage: qs('#stage'),
  backdrop,
  session,
  onChange(next) {
    saveSession(storage, next);
  }
});

// ---------- 浮层：馆藏 / 关于 ----------

function clearHash(kind) {
  if (window.location.hash === '#' + kind) {
    try {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    } catch (err) {
      /* ignore */
    }
  }
}

function openGalleryView() {
  if (hasOverlay()) return;
  openGallery(storage, {
    onClose() {
      clearHash('gallery');
    }
  });
}

function addAboutSection(parent, title, text) {
  if (!text) return;
  const section = el('div', { class: 'about-section' });
  if (title) section.appendChild(el('h3', { class: 'about-section-title', text: title }));
  section.appendChild(el('p', { class: 'about-text', text }));
  parent.appendChild(section);
}

function buildAboutBody() {
  const about = CONTENT.about || {};
  const ethics = CONTENT.ethics || {};
  const body = el('div', { class: 'overlay-body' });
  const wrap = el('div', { class: 'about-body' });

  addAboutSection(wrap, '', ethics.long || '');
  addAboutSection(wrap, CONTENT.museum.title || '', about.what || '');
  addAboutSection(wrap, about.how ? about.prevTitle || '' : '', '');

  const prevItems = Array.isArray(about.prev) ? about.prev : [];
  if (prevItems.length) {
    const prevSection = el('div', { class: 'about-section' });
    if (about.prevTitle) {
      prevSection.appendChild(el('h3', { class: 'about-section-title', text: about.prevTitle }));
    }
    const list = el('ul', { class: 'about-links' });
    for (let i = 0; i < prevItems.length; i += 1) {
      const item = prevItems[i];
      list.appendChild(
        el('li', {}, [
          el('a', {
            href: item.url || '#',
            target: '_blank',
            rel: 'noopener noreferrer',
            text: item.name || item.url || ''
          })
        ])
      );
    }
    prevSection.appendChild(list);
    wrap.appendChild(prevSection);
  }

  addAboutSection(wrap, '', about.privacy || ethics.privacy || '');
  addAboutSection(wrap, '', about.credits || ethics.credits || '');

  if (about.repo) {
    const sourceSection = el('div', { class: 'about-section' });
    if (about.sourceTitle) {
      sourceSection.appendChild(el('h3', { class: 'about-section-title', text: about.sourceTitle }));
    }
    sourceSection.appendChild(
      el('p', { class: 'about-text' }, [
        el('a', {
          href: about.repo,
          target: '_blank',
          rel: 'noopener noreferrer',
          text: about.repo
        })
      ])
    );
    wrap.appendChild(sourceSection);
  }

  body.appendChild(wrap);

  const foot = el('div', { class: 'about-foot' });
  const footGroup = el('div', { class: 'about-foot-group' });
  const clearButton = button(about.clearLabel || '', { class: 'about-clear' });
  clearButton.addEventListener('click', () => {
    clearAll(storage);
    journey.resetAllState();
    const clearedText = about.cleared || '';
    toast(clearedText);
    announce(clearedText);
    closeTopOverlay();
  });
  footGroup.appendChild(clearButton);
  footGroup.appendChild(el('span', { class: 'about-version', text: about.version || CONTENT.version || '' }));
  foot.appendChild(footGroup);
  body.appendChild(foot);
  return body;
}

function openAboutView() {
  if (hasOverlay()) return;
  const about = CONTENT.about || {};
  const panel = el('div', { class: 'overlay-panel about-panel' });
  const head = el('header', { class: 'overlay-head' }, [
    el('div', { class: 'overlay-titles' }, [
      el('h2', { class: 'overlay-title', text: about.title || '' }),
      el('p', { class: 'overlay-sub', text: CONTENT.ethics.short || '' })
    ]),
    button(about.close || '', { class: 'overlay-close' })
  ]);
  const closeButton = head.querySelector('.overlay-close');
  if (closeButton) closeButton.addEventListener('click', () => closeTopOverlay());
  panel.appendChild(head);
  panel.appendChild(buildAboutBody());
  openOverlay(panel, {
    label: about.title || '',
    onClose() {
      clearHash('about');
    }
  });
}

// ---------- 角标导航 ----------

const chromeNav = qs('#chrome-nav');
if (chromeNav) {
  const galleryButton = button(CONTENT.museum.museumLabel || '', { class: 'corner-btn' });
  galleryButton.addEventListener('click', openGalleryView);
  const aboutButton = button(CONTENT.museum.aboutLabel || '', { class: 'corner-btn' });
  aboutButton.addEventListener('click', openAboutView);
  chromeNav.appendChild(galleryButton);
  chromeNav.appendChild(aboutButton);
}

// ---------- 启动 ----------

journey.start({ immediate: true });

if (restored.note === 'dryInk') {
  window.setTimeout(() => {
    toast(CONTENT.scroll.restored || '');
  }, 900);
}

ensureApiMode().then((mode) => {
  document.body.dataset.api = mode;
});

function handleHashChange() {
  const hash = (window.location.hash || '').replace('#', '');
  if (hash === 'gallery') {
    if (!hasOverlay()) openGalleryView();
  } else if (hash === 'about') {
    if (!hasOverlay()) openAboutView();
  } else if (hasOverlay()) {
    closeTopOverlay();
  }
}

const initialHash = (window.location.hash || '').replace('#', '');
if (initialHash === 'gallery' || initialHash === 'about') {
  window.setTimeout(() => {
    if (initialHash === 'gallery') openGalleryView();
    else openAboutView();
  }, 80);
}
window.addEventListener('hashchange', handleHashChange);

window.addEventListener('pagehide', () => {
  saveSession(storage, journey.getSession());
});