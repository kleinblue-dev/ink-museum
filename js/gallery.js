// gallery.js — 馆藏墙浮层：合并服务端列表与本机列表（按 id 去重），
// 服务端优先；空态一行字；点开单幅进入查看器，关闭恢复原页。

import { CONTENT } from '../content/content.js';
import { listLocalScrolls, listScrolls } from './api.js';
import { formatDate } from './export.js';
import { announce, button, closeOverlay, el, focusNode, openOverlay } from './ui.js';

function sceneLabel(sceneId) {
  const scenes = CONTENT.scenes || [];
  for (let i = 0; i < scenes.length; i += 1) {
    if (scenes[i].id === sceneId) return scenes[i].name;
  }
  return '';
}

function moodLabel(moodKey) {
  const moods = (CONTENT.post && CONTENT.post.moods) || [];
  for (let i = 0; i < moods.length; i += 1) {
    if (moods[i].key === moodKey) return moods[i].label;
  }
  return '';
}

function localTagText() {
  return (CONTENT.gallery && CONTENT.gallery.localTag) || '';
}

function remoteTagText() {
  return (CONTENT.gallery && CONTENT.gallery.remoteTag) || '';
}

function closeText() {
  return (CONTENT.gallery && CONTENT.gallery.close) || '';
}

function openLightbox(item) {
  const image = typeof item.image === 'string' ? item.image : item.imageUrl || item.thumbUrl || '';
  if (!image) return;
  const figure = el('div', { class: 'lightbox' }, [
    el('img', { src: image, alt: sceneLabel(item.sceneId), decoding: 'async' }),
    button(closeText(), {
      class: 'lightbox-close',
      on: {
        click: () => {
          const wrapper = figure.closest('.overlay');
          if (wrapper) closeOverlay(wrapper);
        }
      }
    })
  ]);
  const wrapper = openOverlay(figure, { label: sceneLabel(item.sceneId) });
  const img = figure.querySelector('img');
  if (img) {
    const markReady = () => {
      if (wrapper) wrapper.classList.add('is-ready');
    };
    if (img.complete) markReady();
    else img.addEventListener('load', markReady, { once: true });
  }
  requestAnimationFrame(() => {
    const btn = figure.querySelector('.lightbox-close');
    focusNode(btn || figure);
  });
}

function makeCard(item) {
  const name = sceneLabel(item.sceneId);
  const local = item.source === 'local';
  const tags = [];
  if (name) tags.push(el('span', { class: 'tag', text: name }));
  if (item.mood) {
    const label = moodLabel(item.mood);
    if (label) tags.push(el('span', { class: 'tag', text: label }));
  }
  tags.push(el('span', { class: 'tag' + (local ? ' tag--local' : ''), text: local ? localTagText() : remoteTagText() }));

  const frame = el('span', { class: 'gallery-frame' });
  const src = local ? item.image : item.imageUrl || item.thumbUrl || '';
  if (src) {
    const img = el('img', { src, alt: '', loading: 'lazy', decoding: 'async' });
    img.addEventListener('error', () => {
      frame.classList.add('is-missing');
    });
    frame.appendChild(img);
  } else {
    frame.classList.add('is-missing');
  }

  const dateText = formatDate(item.createdAt);
  const card = el(
    'button',
    {
      class: 'gallery-card',
      type: 'button',
      'aria-label': [name, dateText, (CONTENT.gallery && CONTENT.gallery.cardHint) || '']
        .filter((part) => part && part.length)
        .join(' ')
    },
    [
      frame,
      el('span', { class: 'gallery-meta' }, [
        el('span', { class: 'gallery-name', text: name || '' }),
        el('span', { class: 'gallery-tags' }, tags)
      ]),
      el('span', { class: 'gallery-note', text: dateText })
    ]
  );
  card.addEventListener('click', () => openLightbox(item));
  return el('li', {}, [card]);
}

async function loadGalleryItems(storage) {
  const remoteResult = await listScrolls(24);
  const localItems = listLocalScrolls(storage).map((item) => {
    return {
      id: item.id,
      sceneId: item.sceneId,
      mood: item.mood,
      createdAt: item.createdAt,
      image: item.image,
      source: 'local'
    };
  });
  const merged = [];
  const seen = {};
  const remoteItems = remoteResult.items || [];
  for (let i = 0; i < remoteItems.length; i += 1) {
    const item = remoteItems[i];
    if (!item || !item.id || seen[item.id]) continue;
    seen[item.id] = true;
    merged.push(Object.assign({}, item, { source: 'remote' }));
  }
  for (let i = 0; i < localItems.length; i += 1) {
    const item = localItems[i];
    if (!item || !item.id || seen[item.id]) continue;
    seen[item.id] = true;
    merged.push(item);
  }
  return { items: merged, remoteError: Boolean(remoteResult.error) };
}

export function openGallery(storage, options) {
  const title = (CONTENT.gallery && CONTENT.gallery.title) || '';
  const subtitle = (CONTENT.gallery && CONTENT.gallery.subtitle) || '';
  const closeLabel = closeText();
  const body = el('div', { class: 'overlay-body' }, [el('div', { class: 'gallery-loading' })]);

  const panel = el('div', { class: 'overlay-panel' }, [
    el('header', { class: 'overlay-head' }, [
      el('div', { class: 'overlay-titles' }, [
        el('h2', { class: 'overlay-title', text: title }),
        subtitle ? el('p', { class: 'overlay-sub', text: subtitle }) : null
      ]),
      button(closeLabel, {
        class: 'overlay-close',
        'aria-label': closeLabel,
        on: { click: () => { const wrapper = panel.closest('.overlay'); if (wrapper) closeOverlay(wrapper); } }
      })
    ]),
    body
  ]);

  const wrapper = openOverlay(panel, { label: title, onClose: (options && options.onClose) || null });
  const render = (items, remoteError) => {
    if (!body) return;
    while (body.firstChild) body.removeChild(body.firstChild);
    if (!items.length) {
      const text = remoteError
        ? (CONTENT.gallery && CONTENT.gallery.loadError) || ''
        : (CONTENT.gallery && CONTENT.gallery.empty) || '';
      body.appendChild(el('p', { class: 'gallery-empty', text }));
      announce(text);
      return;
    }
    const grid = el('ul', { class: 'gallery-grid' });
    for (let i = 0; i < items.length; i += 1) grid.appendChild(makeCard(items[i]));
    body.appendChild(grid);
    announce(String(items.length));
  };

  loadGalleryItems(storage).then((result) => {
    if (!wrapper || !wrapper.isConnected) return;
    render(result.items, result.remoteError);
  });
  return wrapper;
}