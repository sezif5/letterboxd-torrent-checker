// Content script для страниц Letterboxd

(function() {
  'use strict';

  const BADGE_CLASS = 'rutracker-badge';
  const PROCESSED_ATTR = 'data-rutracker-processed';

  // Определяем тип страницы
  const path = window.location.pathname;
  const isFilmPage = path.match(/^\/film\/[^/]+\/?$/);
  const isListPage = path.includes('/list/') || path.includes('/watchlist');

  // Ждем загрузки страницы
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  function init() {
    // Задержка для динамического контента
    setTimeout(() => {
      if (isFilmPage) {
        addBadgeToFilmPage();
      } else if (isListPage) {
        addBadgesToList();
        observeNewPosters();
      }
    }, 500);
  }

  // ========== Страница фильма ==========

  function addBadgeToFilmPage() {
    if (document.querySelector(`.${BADGE_CLASS}`)) return;

    const filmInfo = getFilmInfoFromPage();
    if (!filmInfo.title) return;

    const titleElement = document.querySelector('h1.headline-1, h1.filmtitle, section.film-header h1');
    if (!titleElement) return;

    const badge = createBadge();
    titleElement.parentNode.insertBefore(badge, titleElement.nextSibling);
    checkRutracker(filmInfo, badge);
  }

  function getFilmInfoFromPage() {
    let title = '';
    let year = '';

    const h1 = document.querySelector('h1.headline-1, h1.filmtitle, section.film-header h1');
    if (h1) title = h1.textContent.trim();

    if (!title) {
      const ogTitle = document.querySelector('meta[property="og:title"]');
      if (ogTitle) title = ogTitle.content.split('•')[0].trim();
    }

    const yearLink = document.querySelector('a[href*="/films/year/"]');
    if (yearLink) {
      const match = yearLink.href.match(/\/films\/year\/(\d{4})/);
      if (match) year = match[1];
    }

    return { title, year };
  }

  // ========== Списки и Watchlist ==========

  function addBadgesToList() {
    // Находим все постеры фильмов
    const posters = document.querySelectorAll('.film-poster, .poster-container, li.poster-container');

    posters.forEach(poster => {
      if (poster.hasAttribute(PROCESSED_ATTR)) return;
      poster.setAttribute(PROCESSED_ATTR, 'true');

      const filmInfo = getFilmInfoFromPoster(poster);
      if (!filmInfo.title && !filmInfo.slug) return;

      addBadgeToPoster(poster, filmInfo);
    });
  }

  function getFilmInfoFromPoster(poster) {
    let title = '';
    let year = '';
    let slug = '';

    // Ищем data-атрибуты
    const filmDiv = poster.querySelector('[data-film-slug]') || poster.closest('[data-film-slug]');
    if (filmDiv) {
      slug = filmDiv.getAttribute('data-film-slug');
    }

    // Ищем ссылку на фильм
    const link = poster.querySelector('a[href*="/film/"]');
    if (link) {
      const match = link.href.match(/\/film\/([^/]+)/);
      if (match) slug = match[1];
    }

    // Ищем название в alt изображения
    const img = poster.querySelector('img');
    if (img) {
      let altText = img.alt || img.title || '';

      // Убираем "Poster for " в начале
      altText = altText.replace(/^Poster for\s+/i, '');

      // Извлекаем год из alt (например "Harakiri 1962")
      const yearInAlt = altText.match(/\s+((?:19|20)\d{2})$/);
      if (yearInAlt) {
        year = yearInAlt[1];
        title = altText.replace(/\s+(?:19|20)\d{2}$/, '').trim();
      } else {
        title = altText.trim();
      }
    }

    // Ищем название в data-атрибутах (приоритет выше)
    const dataTitle = poster.getAttribute('data-film-name') ||
                      poster.querySelector('[data-film-name]')?.getAttribute('data-film-name');
    if (dataTitle) title = dataTitle;

    // Преобразуем slug в название если нет title
    if (!title && slug) {
      // Убираем год из slug если есть (например "harakiri-1962" -> "harakiri")
      let cleanSlug = slug.replace(/-\d{4}$/, '');
      title = cleanSlug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

      // Извлекаем год из slug
      const slugYear = slug.match(/-(\d{4})$/);
      if (slugYear && !year) year = slugYear[1];
    }

    return { title, year, slug };
  }

  function addBadgeToPoster(poster, filmInfo) {
    // Создаем контейнер для бейджа
    const badgeContainer = document.createElement('div');
    badgeContainer.className = 'rutracker-badge-container';

    const badge = createBadge(true); // compact mode
    badgeContainer.appendChild(badge);

    // Добавляем к постеру
    poster.style.position = 'relative';
    poster.appendChild(badgeContainer);

    // Если есть только slug, сначала получаем инфо о фильме
    if (!filmInfo.title && filmInfo.slug) {
      fetchFilmInfo(filmInfo.slug).then(info => {
        checkRutracker(info, badge);
      });
    } else {
      checkRutracker(filmInfo, badge);
    }
  }

  async function fetchFilmInfo(slug) {
    try {
      const response = await fetch(`https://letterboxd.com/film/${slug}/`);
      const html = await response.text();

      const titleMatch = html.match(/<meta property="og:title" content="([^"]+)"/);
      const yearMatch = html.match(/\/films\/year\/(\d{4})/);

      let title = titleMatch ? titleMatch[1].split('•')[0].trim() : slug.replace(/-/g, ' ');
      let year = yearMatch ? yearMatch[1] : '';

      return { title, year, slug };
    } catch (e) {
      return { title: slug.replace(/-/g, ' '), year: '', slug };
    }
  }

  // Наблюдатель за новыми постерами (infinite scroll)
  function observeNewPosters() {
    const observer = new MutationObserver((mutations) => {
      let hasNewPosters = false;
      mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
          if (node.nodeType === 1 && (node.classList?.contains('poster-container') || node.querySelector?.('.poster-container'))) {
            hasNewPosters = true;
          }
        });
      });
      if (hasNewPosters) {
        setTimeout(addBadgesToList, 100);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ========== Общие функции ==========

  function createBadge(compact = false) {
    const badge = document.createElement('a');
    badge.className = `${BADGE_CLASS} loading${compact ? ' compact' : ''}`;
    badge.textContent = 'RT';
    badge.title = 'Проверка Rutracker...';
    badge.target = '_blank';
    badge.rel = 'noopener noreferrer';
    return badge;
  }

  function checkRutracker(filmInfo, badge) {
    browser.runtime.sendMessage({
      action: 'checkRutracker',
      title: filmInfo.title,
      year: filmInfo.year
    }).then(result => {
      updateBadge(badge, result);
    }).catch(error => {
      updateBadge(badge, { error: error.message, searchUrl: '' });
    });
  }

  function updateBadge(badge, result) {
    badge.classList.remove('loading');
    badge.href = result.searchUrl || '#';

    if (result.error) {
      badge.classList.add('error');
      badge.textContent = 'RT?';
      badge.title = `Ошибка: ${result.error}`;
      return;
    }

    if (result.needsAuth) {
      badge.classList.add('auth');
      badge.textContent = 'RT';
      badge.title = 'Требуется авторизация на Rutracker';
      return;
    }

    if (result.found) {
      badge.classList.add('found');
      badge.textContent = badge.classList.contains('compact') ? result.count : `RT (${result.count})`;
      badge.title = `Найдено раздач: ${result.count}`;
    } else {
      badge.classList.add('not-found');
      badge.textContent = badge.classList.contains('compact') ? '0' : 'RT (0)';
      badge.title = 'Раздачи не найдены';
    }
  }
})();
